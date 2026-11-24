import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Run against a throwaway copy of the repository data; xAI is stubbed, so no API calls or fees.
const root = mkdtempSync(path.join(tmpdir(), "radar-x-"));
mkdirSync(path.join(root, "data"));
writeFileSync(
  path.join(root, "sources.yaml"),
  'programs:\n  - { name: "Y Combinator", url: "https://www.ycombinator.com/deal" }\n',
);
vi.stubEnv("RADAR_ROOT", root);
const x = await import("./x-signals");

const signal = (over = {}) => ({
  program: "Y Combinator",
  organization: "Y Combinator",
  kind: "applications_open" as const,
  summary: "Spring 2027 applications are open until 2027-01-10.",
  official_url: "https://www.ycombinator.com/apply",
  post_url: "https://x.com/ycombinator/status/1",
  posted_on: new Date().toISOString().slice(0, 10),
  country: null,
  ...over,
});
const xaiReply = (signals: unknown[], posts = 40) =>
  new Response(
    JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ signals }) }] }],
      usage: { server_side_tool_usage_details: { x_posts_fetched: posts } },
    }),
    { status: 200 },
  );

afterEach(() => vi.unstubAllGlobals());

describe("searchX", () => {
  it("sends an X-search request limited to recent days and returns validated signals", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test");
    const fetchMock = vi.fn().mockResolvedValue(xaiReply([signal()]));
    vi.stubGlobal("fetch", fetchMock);
    const { signals, postsFetched } = await x.searchX(["Y Combinator"], 3);
    expect(signals).toHaveLength(1);
    expect(postsFetched).toBe(40);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools[0]).toMatchObject({ type: "x_search", from_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true });
  });

  it("rejects a reply that doesn't match the schema", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(xaiReply([{ program: "half a record" }])));
    await expect(x.searchX([], 3)).rejects.toThrow("failed validation");
  });

  it("refuses to run without an API key", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    await expect(x.searchX([], 3)).rejects.toThrow("XAI_API_KEY");
  });
});

describe("recordSignals", () => {
  it("flags tracked programs, adds new ones as sources, and ignores repeat posts", () => {
    const tracked = signal();
    const brandNew = signal({ program: "Acme Climate Fellowship", official_url: "https://acme.org/fellowship", post_url: "https://x.com/acme/status/2" });
    const noPage = signal({ program: "Rumoured Fund", official_url: null, post_url: "https://x.com/someone/status/3" });

    const first = x.recordSignals([tracked, brandNew, noPage]);
    expect(first.fresh.map((s) => s.tracked_as)).toEqual(["y-combinator", null, null]);
    expect(first.newSources).toEqual([{ name: "Acme Climate Fellowship", url: "https://acme.org/fellowship" }]);
    expect(readFileSync(path.join(root, "sources.yaml"), "utf8")).toContain("Acme Climate Fellowship");
    expect([...x.pendingPrograms()]).toEqual(["y-combinator"]);

    expect(x.recordSignals([tracked]).fresh).toEqual([]); // same post again: nothing new

    x.markHandled(new Set(["y-combinator"]));
    expect(x.pendingPrograms().size).toBe(0);
  });
});
