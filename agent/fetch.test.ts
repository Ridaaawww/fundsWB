import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Firecrawl and the network are stubbed: these tests run offline and spend no credits.
const scrape = vi.fn();
vi.mock("@mendable/firecrawl-js", () => ({
  default: class {
    scrape = scrape;
  },
}));
const { fetchPage } = await import("./fetch");

const longText = "Seed funding of $500k for 7% equity. ".repeat(40); // comfortably over the 800-char minimum
const html = (body: string) => new Response(`<html><body><p>${body}</p></body></html>`, { status: 200 });

beforeEach(() => {
  scrape.mockReset();
  vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
  vi.stubEnv("RADAR_FIRECRAWL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchPage", () => {
  it("reads directly when the page is fine, without spending a Firecrawl credit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(html(longText)));
    expect((await fetchPage("https://a.com")).reader).toBe("direct");
    expect(scrape).not.toHaveBeenCalled();
  });

  it("falls back to Firecrawl when the site blocks the direct read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("blocked", { status: 403 })));
    scrape.mockResolvedValue({ markdown: longText, metadata: { statusCode: 200 } });
    const page = await fetchPage("https://a.com");
    expect(page.reader).toBe("firecrawl");
    expect(scrape).toHaveBeenCalledWith("https://a.com", expect.objectContaining({ formats: ["markdown"], proxy: "auto" }));
  });

  it("falls back to Firecrawl when the page is a near-empty JavaScript shell", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(html("Loading…")));
    scrape.mockResolvedValue({ markdown: longText, metadata: { statusCode: 200 } });
    expect((await fetchPage("https://a.com")).reader).toBe("firecrawl");
  });

  it("uses Firecrawl for every page when RADAR_FIRECRAWL=always", async () => {
    vi.stubEnv("RADAR_FIRECRAWL", "always");
    const direct = vi.fn();
    vi.stubGlobal("fetch", direct);
    scrape.mockResolvedValue({ markdown: longText, metadata: { statusCode: 200 } });
    expect((await fetchPage("https://a.com")).reader).toBe("firecrawl");
    expect(direct).not.toHaveBeenCalled();
  });

  it("never calls Firecrawl without an API key", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("blocked", { status: 403 })));
    await expect(fetchPage("https://a.com")).rejects.toThrow("direct: HTTP 403");
    expect(scrape).not.toHaveBeenCalled();
  });

  it("reports both failures when neither reader gets the page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("blocked", { status: 403 })));
    scrape.mockResolvedValue({ markdown: "", metadata: { statusCode: 404 } });
    await expect(fetchPage("https://a.com")).rejects.toThrow(/direct: HTTP 403; firecrawl: HTTP 404/);
  });
});
