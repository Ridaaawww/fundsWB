// The shape of one program in the repository. Claude fills this in via structured outputs.
import { z } from "zod";

export const REGIONS = [
  "Global",
  "North America",
  "Latin America",
  "Europe",
  "Middle East & North Africa",
  "Sub-Saharan Africa",
  "South Asia",
  "Southeast Asia",
  "East Asia",
  "Oceania",
] as const;
export type Region = (typeof REGIONS)[number];

export const TYPES = ["accelerator", "incubator", "fellowship", "grant", "fund", "debt", "credits", "other"] as const;
export const STAGES = ["idea", "early", "growth"] as const;

export const ProgramSchema = z.object({
  name: z.string().describe("Program name, e.g. 'YC Winter batch' or 'Thiel Fellowship'"),
  organization: z.string().describe("Who runs it, e.g. 'Y Combinator'"),
  type: z
    .enum(TYPES)
    .describe("fund = equity investor program (VC/angel/pre-seed fund); debt = venture debt or revenue-based financing"),
  region: z
    .enum(REGIONS)
    .describe("Where founders must be based or where it runs. 'Global' only if open to founders anywhere."),
  country: z.string().nullable().describe("The single country it is limited to, e.g. 'India'. Null if multi-country."),
  stages: z
    .array(z.enum(STAGES))
    .describe("Who it serves: idea = pre-product/pre-incorporation; early = pre-seed/seed, first customers; growth = post-revenue scaling, Series A+"),
  funding_summary: z
    .string()
    .describe("One line on the money: amount, instrument and terms. 'None' if no cash is given."),
  max_funding_usd: z
    .number()
    .int()
    .nullable()
    .describe("Largest cash amount a founder/startup can get, in USD. Null if no cash or not stated."),
  equity_taken: z.string().describe("Equity taken, e.g. '7%', 'none', 'via SAFE', or 'not stated'"),
  benefits: z
    .array(z.string())
    .describe("Non-cash benefits: credits (with $ value), mentorship, office space, demo day, network, visas..."),
  eligibility: z.string().describe("Who can apply: stage, age, sector, geography"),
  location: z.string().describe("Where it runs: city/country, or 'Remote'"),
  application_status: z.enum(["open", "rolling", "closed", "unknown"]),
  deadline: z.string().nullable().describe("Next application deadline as YYYY-MM-DD, null if none stated"),
  apply_url: z.string().nullable().describe("Direct application link if shown"),
});
export type Program = z.infer<typeof ProgramSchema>;

export const DiscoverySchema = z.object({
  programs: z.array(
    z.object({
      name: z.string(),
      url: z.string().describe("Official page describing the program's funding and benefits"),
    }),
  ),
});

export type Source = { name: string; url: string };

/** What we store per program in data/programs.json. */
export type ProgramRecord = {
  source: Source;
  mode?: "page" | "research";
  /** Which reader got the page: a direct request or Firecrawl. */
  reader?: "direct" | "firecrawl";
  content_hash?: string;
  last_checked: string;
  last_changed?: string;
  error: string | null;
  program?: Program;
};
export type Db = Record<string, ProgramRecord>;

/** One row on the website / in PROGRAMS.md. Records saved before `country`/`stages` existed may lack them. */
export type PublicProgram = Omit<Program, "country" | "stages"> &
  Partial<Pick<Program, "country" | "stages">> & { source_url: string; last_checked: string; last_changed?: string };
