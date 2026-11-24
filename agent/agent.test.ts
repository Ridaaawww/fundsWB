import { describe, expect, it, vi, beforeEach } from "vitest";
import { contentHash, htmlToText } from "./fetch";
import { diff, newSources, toPublic } from "./store";
import type { Program, ProgramRecord } from "./schema";

// Claude and the network are stubbed: these tests cost nothing and run offline.
vi.mock("./llm", () => ({ extract: vi.fn(), researchProgram: vi.fn() }));
vi.mock("./fetch", async (orig) => ({ ...(await orig<typeof import("./fetch")>()), fetchPage: vi.fn() }));
const llm = await import("./llm");
const { fetchPage } = await import("./fetch");
const { check } = await import("./cli");

const program = (over: Partial<Program> = {}): Program => ({
  name: "YC",
  organization: "Y Combinator",
  type: "accelerator",
  region: "North America",
  country: "United States",
  stages: ["early"],
  funding_summary: "$500k",
  max_funding_usd: 500000,
  equity_taken: "7%",
  benefits: ["Demo Day"],
  eligibility: "any",
  location: "SF",
  application_status: "open",
  deadline: null,
  apply_url: null,
  ...over,
});
const src = { name: "Y Combinator", url: "https://www.ycombinator.com/deal" };

describe("fetch", () => {
  it("keeps visible text and drops scripts and styles", () => {
    const text = htmlToText("<html><body><h1>Deal</h1><script>x()</script><style>p{}</style><p>$500k   for 7%</p></body></html>");
    expect(text).toBe("Deal\n$500k for 7%");
  });

  it("ignores random ids when hashing, but not real edits", () => {
    expect(contentHash("Trace Id: f6ead608b04ea1865b7ddbb264fdde09\n$500k")).toBe(
      contentHash("Trace Id: 85e0307abbef92da7c8ff99420cb923e\n$500k"),
    );
    expect(contentHash("$500k")).not.toBe(contentHash("$600k"));
  });
});

describe("store", () => {
  it("reports only the fields founders care about", () => {
    expect(diff(undefined, program())).toEqual(["added"]);
    expect(diff(program(), program({ funding_summary: "reworded" }))).toEqual([]);
    expect(diff(program(), program({ application_status: "closed" }))).toEqual(["application_status: open → closed"]);
  });

  it("skips discovered programs we already track by name or page", () => {
    const found = [
      { name: "Y Combinator", url: "https://other.com" },
      { name: "YC Deal", url: "http://ycombinator.com/deal/" },
      { name: "Antler India", url: "https://www.antler.co/location/india" },
      { name: "Antler US", url: "https://www.antler.co/location/us" },
      { name: "Antler India", url: "https://antler.co/dup" },
    ];
    expect(newSources([src], found).map((s) => s.name)).toEqual(["Antler India", "Antler US"]);
  });

  it("keeps distinct schemes that share one official page when asked to", () => {
    const portal = { name: "Kerala Innovation Grants", url: "https://startupmission.kerala.gov.in/schemes" };
    const loan = { name: "Kerala Seed Loan", url: "https://startupmission.kerala.gov.in/schemes" };
    expect(newSources([portal], [loan])).toEqual([]);
    expect(newSources([portal], [loan], { samePageOk: true })).toEqual([loan]);
  });

  it("publishes extracted programs only, most money first", () => {
    const rec = (p?: Program): ProgramRecord => ({ source: src, last_checked: "2026-11-24", error: null, program: p });
    const rows = toPublic({ a: rec(program({ name: "Small", max_funding_usd: 10 })), b: rec(program()), c: rec() });
    expect(rows.map((r) => r.name)).toEqual(["YC", "Small"]);
  });
});

describe("check", () => {
  beforeEach(() => vi.resetAllMocks());

  it("extracts a new page", async () => {
    vi.mocked(fetchPage).mockResolvedValue({ text: "page text", reader: "direct" });
    vi.mocked(llm.extract).mockResolvedValue(program());
    const r = await check(src, undefined, false);
    expect(r.changes).toEqual(["added"]);
    expect(r.record?.mode).toBe("page");
  });

  it("does not call Claude when the page is unchanged", async () => {
    vi.mocked(fetchPage).mockResolvedValue({ text: "page text", reader: "direct" });
    const prev: ProgramRecord = { source: src, last_checked: "x", error: null, content_hash: contentHash("page text"), program: program() };
    const r = await check(src, prev, false);
    expect(llm.extract).not.toHaveBeenCalled();
    expect(r.line).toContain("same");
  });

  it("logs a real change", async () => {
    vi.mocked(fetchPage).mockResolvedValue({ text: "new page text", reader: "direct" });
    vi.mocked(llm.extract).mockResolvedValue(program({ application_status: "closed" }));
    const prev: ProgramRecord = { source: src, last_checked: "x", error: null, content_hash: "old", program: program() };
    expect((await check(src, prev, false)).changes).toEqual(["application_status: open → closed"]);
  });

  it("falls back to web research when the page can't be read, then waits 3 days", async () => {
    vi.mocked(fetchPage).mockRejectedValue(new Error("HTTP 403"));
    vi.mocked(llm.researchProgram).mockResolvedValue(program());
    const first = await check(src, undefined, false);
    expect(first.record?.mode).toBe("research");
    const second = await check(src, first.record!, false);
    expect(second.line).toContain("skip");
    expect(llm.researchProgram).toHaveBeenCalledTimes(1);
  });

  it("re-reads a Firecrawl-only page at most once a day", async () => {
    const recent: ProgramRecord = { source: src, last_checked: new Date().toISOString(), error: null, reader: "firecrawl", content_hash: "x", program: program() };
    expect((await check(src, recent, false)).line).toContain("Firecrawl page");
    expect(fetchPage).not.toHaveBeenCalled();
    const dayOld = { ...recent, last_checked: new Date(Date.now() - 25 * 3600e3).toISOString() };
    vi.mocked(fetchPage).mockResolvedValue({ text: "page text", reader: "firecrawl" });
    vi.mocked(llm.extract).mockResolvedValue(program());
    await check(src, dayOld, false);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("hides a program whose official page looks hacked, without calling Claude", async () => {
    const spam = "Startup grants. live casino here. best casino bonus. casino slots. Apply now.";
    vi.mocked(fetchPage).mockResolvedValue({ text: spam, reader: "firecrawl" });
    const prev: ProgramRecord = { source: src, last_checked: "x", error: null, program: program() };
    const r = await check(src, prev, false);
    expect(r.line).toContain("UNSAFE");
    expect(llm.extract).not.toHaveBeenCalled();
    expect(toPublic({ a: r.record! })).toEqual([]);
    expect(r.record?.program).toEqual(program()); // last good data kept for when the site is cleaned
  });

  it("records API errors instead of crashing the run", async () => {
    vi.mocked(fetchPage).mockResolvedValue({ text: "page text", reader: "direct" });
    vi.mocked(llm.extract).mockRejectedValue(new Error("401 unauthorized"));
    const r = await check(src, undefined, false);
    expect(r.record?.error).toBe("401 unauthorized");
    expect(llm.researchProgram).not.toHaveBeenCalled();
  });
});
