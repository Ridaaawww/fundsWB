// Grok watches X for funding news: cohorts opening, deadlines moving, new grant schemes, changed terms.
//
// X posts are leads, not facts. A signal about a program we track makes the agent re-read that
// program's official page on its next run; a signal about a new program adds it to sources.yaml.
// The record itself is always built from the official page.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import * as store from "./store";
import type { Source } from "./schema";

const XAI_URL = "https://api.x.ai/v1/responses";
const MODEL = "grok-4.7";
const SIGNALS = path.join(process.env.RADAR_ROOT ?? process.cwd(), "data", "x-signals.json");
const KEEP_DAYS = 30;

export const SignalSchema = z.object({
  program: z.string().describe("Program name as announced, e.g. 'Y Combinator Spring 2027 batch'"),
  organization: z.string().describe("Who runs it"),
  kind: z.enum(["applications_open", "deadline", "new_program", "terms_changed", "closed", "other"]),
  summary: z.string().describe("One factual sentence: what the post says changed or opened, with any amount or date"),
  official_url: z.string().nullable().describe("The program's official page if the post links to one or you can see it, else null"),
  post_url: z.string().describe("Link to the X post, https://x.com/<handle>/status/<id>"),
  posted_on: z.string().describe("Date of the post, YYYY-MM-DD"),
  country: z.string().nullable().describe("Single country it is limited to, or null if global / multi-country"),
});
const ResultSchema = z.object({ signals: z.array(SignalSchema) });

export type Signal = z.infer<typeof SignalSchema> & { tracked_as: string | null; seen_at: string; handled: boolean };

const PROMPT = (known: string[], from: string) => `Search X for posts since ${from} that announce news about funding for startup founders:
accelerator or incubator cohorts opening applications, application deadlines (new, extended or closing soon),
new grant schemes or government startup funds, fellowships, changed investment terms, or programs closing.

Prefer posts by the programs themselves, the investors or government bodies running them, and established startup
media. Skip giveaways, crypto airdrops, paid "pitch to 100 VCs" schemes, rumours, and posts that only celebrate past
portfolio wins. Cover all regions, including India, Europe, Africa, the Middle East, Latin America and Southeast Asia.

Return each distinct announcement once, using the most official post. If it concerns one of these tracked programs,
use the tracked name exactly as written:
${known.map((k) => `- ${k}`).join("\n")}`;

/** Ask Grok to search X. Returns validated signals and how many posts it read (X Search bills per post). */
export async function searchX(known: string[], days: number): Promise<{ signals: z.infer<typeof SignalSchema>[]; postsFetched: number }> {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not set");
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const from = day(-days);
  const { $schema: _drop, ...schema } = z.toJSONSchema(ResultSchema) as Record<string, unknown>;

  const res = await fetch(XAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10 * 60_000),
    body: JSON.stringify({
      model: MODEL,
      input: PROMPT(known, from),
      tools: [{ type: "x_search", from_date: from, to_date: day(1) }],
      max_turns: Number(process.env.RADAR_X_TURNS ?? 4), // caps how many search rounds Grok runs, and so the cost
      text: { format: { type: "json_schema", name: "x_funding_signals", schema, strict: true } },
    }),
  });
  if (!res.ok) throw new Error(`xAI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    output?: { type: string; content?: { type: string; text?: string }[] }[];
    usage?: { server_side_tool_usage_details?: { x_posts_fetched?: number } };
  };
  const text = body.output?.find((o) => o.type === "message")?.content?.find((c) => c.type === "output_text")?.text;
  if (!text) throw new Error("xAI returned no message text");
  const parsed = ResultSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`xAI result failed validation: ${parsed.error.issues[0]?.message}`);
  return { signals: parsed.data.signals, postsFetched: body.usage?.server_side_tool_usage_details?.x_posts_fetched ?? 0 };
}

export function loadSignals(): Signal[] {
  return existsSync(SIGNALS) ? JSON.parse(readFileSync(SIGNALS, "utf8")) : [];
}

export function saveSignals(signals: Signal[]): void {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const kept = signals.filter((s) => s.posted_on >= cutoff).sort((a, b) => b.posted_on.localeCompare(a.posted_on));
  writeFileSync(SIGNALS, JSON.stringify(kept, null, 2) + "\n");
}

/** Which tracked program a signal is about: same name, or same official page. */
export function matchTracked(s: { program: string; official_url: string | null }, sources: Source[]): Source | undefined {
  return (
    sources.find((src) => store.slug(src.name) === store.slug(s.program)) ??
    (s.official_url ? sources.find((src) => store.pageKey(src.url) === store.pageKey(s.official_url!)) : undefined)
  );
}

/** Merge fresh signals into data/x-signals.json; returns what was new. */
export function recordSignals(found: z.infer<typeof SignalSchema>[]): { fresh: Signal[]; newSources: Source[] } {
  const sources = store.loadSources();
  const existing = loadSignals();
  const seen = new Set(existing.map((s) => s.post_url));
  const now = new Date().toISOString();
  const fresh: Signal[] = [];
  for (const s of found) {
    if (seen.has(s.post_url)) continue;
    seen.add(s.post_url);
    const tracked = matchTracked(s, sources);
    fresh.push({ ...s, tracked_as: tracked ? store.slug(tracked.name) : null, seen_at: now, handled: false });
  }
  // A new program with an official page becomes a tracked source; the agent extracts it from that page.
  const candidates = fresh.filter((s) => !s.tracked_as && s.kind !== "closed" && s.official_url).map((s) => ({ name: s.program, url: s.official_url! }));
  const newSources = store.addSources(candidates);
  saveSignals([...fresh, ...existing]);
  return { fresh, newSources };
}

/** Programs an unhandled X signal points at; `update` re-reads these even if their page hash looks unchanged. */
export function pendingPrograms(): Set<string> {
  return new Set(loadSignals().filter((s) => !s.handled && s.tracked_as).map((s) => s.tracked_as!));
}

export function markHandled(keys: Set<string>): void {
  if (!keys.size) return;
  saveSignals(loadSignals().map((s) => (s.tracked_as && keys.has(s.tracked_as) ? { ...s, handled: true } : s)));
}
