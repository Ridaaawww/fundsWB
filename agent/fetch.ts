// Read a program's page as plain text, so we can hash it and hand it to Claude.
//
// Two readers:
//   - direct: a plain HTTP request. Free, and enough for most sites.
//   - Firecrawl: renders JavaScript and gets past most bot walls, returning clean markdown.
//     Used when FIRECRAWL_API_KEY is set. By default only when the direct read fails or comes back
//     nearly empty (each Firecrawl scrape costs a credit); set RADAR_FIRECRAWL=always to use it for every page.
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import Firecrawl from "@mendable/firecrawl-js";

const USER_AGENT = "Mozilla/5.0 (compatible; funds-radar/0.2)";
const MIN_USEFUL_CHARS = 800; // less than this usually means a JS-only page or a bot wall

export type Reader = "direct" | "firecrawl";
export type Page = { text: string; reader: Reader };

export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe").remove();
  // Put block elements on their own lines so the text stays readable.
  $("p, div, li, h1, h2, h3, h4, h5, h6, br, tr, section, article").after("\n");
  return $("body")
    .text()
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function useful(text: string, how: string): string {
  if (text.length < MIN_USEFUL_CHARS) throw new Error(`${how}: only ${text.length} chars of text`);
  return text;
}

async function readDirect(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`direct: HTTP ${res.status}`);
  return useful(htmlToText(await res.text()), "direct");
}

let firecrawl: Firecrawl | undefined;
async function readFirecrawl(url: string): Promise<string> {
  firecrawl ??= new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY, timeoutMs: 90_000 });
  const doc = await firecrawl.scrape(url, {
    formats: ["markdown"],
    onlyMainContent: true, // drop nav, footers and cookie banners
    proxy: "auto", // retries with a stealth proxy if the site blocks the basic one
    maxAge: 60 * 60 * 1000, // reuse a copy under 1h old; runs are 6h apart, so changes are still caught
  });
  const status = doc.metadata?.statusCode;
  if (status && status >= 400) throw new Error(`firecrawl: HTTP ${status}`);
  return useful((doc.markdown ?? "").trim(), "firecrawl");
}

export const firecrawlEnabled = () => Boolean(process.env.FIRECRAWL_API_KEY);

/** Read a page with the cheapest reader that works. Throws if no reader gets useful text. */
export async function fetchPage(url: string): Promise<Page> {
  if (firecrawlEnabled() && process.env.RADAR_FIRECRAWL === "always") {
    return { text: await readFirecrawl(url), reader: "firecrawl" };
  }
  try {
    return { text: await readDirect(url), reader: "direct" };
  } catch (direct) {
    if (!firecrawlEnabled()) throw direct;
    try {
      return { text: await readFirecrawl(url), reader: "firecrawl" };
    } catch (fc) {
      throw new Error(`${(direct as Error).message}; ${(fc as Error).message}`);
    }
  }
}

// Hacked sites (often government portals) get stuffed with gambling spam. Three or more hits means
// we shouldn't send founders to the page until it's cleaned up.
const SPAM = /\b(casino|slot gacor|judi online|togel|sbobet|online betting|betting site)\b/gi;
export function looksCompromised(text: string): boolean {
  return (text.match(SPAM) ?? []).length >= 3;
}

/** Hash of the page text, ignoring per-request noise (trace ids, cache-busters). */
export function contentHash(text: string): string {
  const stable = text.replace(/\b[0-9a-fA-F-]{16,}\b/g, "");
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}
