// Every Claude call lives here: extract a page, research a program on the web, discover new programs.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { DiscoverySchema, ProgramSchema, type Program, type Source } from "./schema";

const MODEL = "claude-opus-5-5";
// If a request is declined by a safety classifier, the API retries it on a fallback model.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

let client: Anthropic | undefined;
const claude = () => (client ??= new Anthropic());

const EXTRACT_SYSTEM = `You extract facts about startup funding programs (accelerators, incubators, \
fellowships, grants, credit programs) for a public directory founders rely on.
Use only what the source states. If something isn't stated, say 'not stated' or use null. \
Never guess amounts or deadlines. Convert non-USD amounts to approximate USD in max_funding_usd \
and keep the original currency in funding_summary.`;

/** Turn page text (or research notes) into a structured Program. */
export async function extract(src: Source, sourceText: string, today: string): Promise<Program | null> {
  const res = await claude().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: EXTRACT_SYSTEM,
    output_config: { effort: "low", format: betaZodOutputFormat(ProgramSchema) },
    messages: [
      {
        role: "user",
        content: `Today is ${today}. Program: ${src.name}\nSource: ${src.url}\n\n<source>\n${sourceText}\n</source>`,
      },
    ],
    ...FALLBACK,
  });
  return res.stop_reason === "end_turn" ? res.parsed_output : null;
}

/** Let Claude search and read the web, and return its written findings. */
export async function webResearch(prompt: string): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  let res: Anthropic.Beta.BetaMessage | undefined;
  for (let i = 0; i < 5; i++) {
    res = await claude().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 8 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 },
      ],
      messages,
      ...FALLBACK,
    });
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content }); // server resumes the paused turn
  }
  return (res?.content ?? []).flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
}

/** Fallback for pages we can't scrape (bot walls, JS-only sites). */
export async function researchProgram(src: Source, today: string): Promise<Program | null> {
  const notes = await webResearch(
    `Today is ${today}. Find the current funding, equity terms, benefits, eligibility, location, ` +
      `application status and next deadline for the startup program '${src.name}' (official site: ${src.url}). ` +
      "Prefer the official site; note the source of each fact. Write plain notes.",
  );
  return notes.trim() ? extract(src, notes, today) : null;
}

/** Search the web for good programs we don't track yet. */
export async function discover(known: string[], count: number, today: string): Promise<Source[]> {
  const notes = await webResearch(
    `Today is ${today}. Find up to ${count} notable startup accelerators, incubators, fellowships, ` +
      "grants or startup credit programs anywhere in the world that give founders money or substantial " +
      "benefits and are currently active. Cover different regions (US, Europe, India, Africa, LatAm, " +
      "Asia, Middle East). For each, give its name and the official page that describes the funding.\n\n" +
      "Skip these, we already track them:\n" +
      known.map((k) => `- ${k}`).join("\n"),
  );
  const res = await claude().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: betaZodOutputFormat(DiscoverySchema) },
    messages: [{ role: "user", content: `List every program in these notes with its official URL.\n\n${notes}` }],
    ...FALLBACK,
  });
  return res.stop_reason === "end_turn" ? (res.parsed_output?.programs ?? []) : [];
}
