// Build-time data helpers shared by the pages.
import { loadDb, toPublic } from "@/agent/store";
import type { PublicProgram } from "@/agent/schema";

export const loadPrograms = (): PublicProgram[] => toPublic(loadDb());
export { loadSignals } from "@/agent/x-signals";
export type { Signal } from "@/agent/x-signals";

// Older records predate the `country` field, so fall back to where the program says it runs.
const INDIA_TEXT = /\bindia\b|bangalore|bengaluru|mumbai|delhi|hyderabad|chennai|pune|ahmedabad|kolkata/i;
export const isIndia = (p: PublicProgram) =>
  p.country === "India" || (!p.country && p.region === "South Asia" && INDIA_TEXT.test(`${p.location} ${p.eligibility}`));

/** A program plus the "where" bucket its location pill filters on (a region, or an Indian state). */
export type Located = PublicProgram & { where: string };

export const PAN_INDIA = "Pan-India";

// First match wins, so cities listed under a state never fall through to another one.
const STATES: [string, RegExp][] = [
  ["Karnataka", /karnataka|bengaluru|bangalore|mysuru|hubballi/i],
  ["Maharashtra", /maharashtra|mumbai|pune|nagpur/i],
  ["Telangana", /telangana|hyderabad/i],
  ["Tamil Nadu", /tamil nadu|chennai|coimbatore/i],
  ["Kerala", /kerala|kochi|thiruvananthapuram|trivandrum/i],
  ["Gujarat", /gujarat|ahmedabad|gandhinagar|surat/i],
  ["Uttar Pradesh", /uttar pradesh|lucknow|kanpur|noida/i],
  ["Delhi NCR", /delhi|gurugram|gurgaon/i],
  ["Rajasthan", /rajasthan|jaipur/i],
  ["Odisha", /odisha|bhubaneswar/i],
  ["West Bengal", /west bengal|kolkata/i],
  ["Andhra Pradesh", /andhra|visakhapatnam|amaravati/i],
  ["Haryana", /haryana/i],
  ["Punjab", /punjab|mohali/i],
  ["Madhya Pradesh", /madhya pradesh|indore|bhopal/i],
  ["Goa", /\bgoa\b/i],
];

// Only these are tied to where a founder is based. Investors, debt providers, accelerators and
// credit programs back startups anywhere in India, whichever city their office is in.
const PLACE_BOUND = new Set(["grant", "other", "incubator"]);

/** Indian programs bucketed by state; national, online and multi-state programs are Pan-India. */
export function byState(programs: PublicProgram[]): { programs: Located[]; order: string[] } {
  const located = programs.map((p) => {
    // A state scheme names the state itself ("Kerala, India"), whatever its type (grant, seed loan, fund...).
    const stateScheme = STATES.find(([name]) => p.location.toLowerCase().startsWith(name.toLowerCase()));
    const states = stateScheme ? [stateScheme] : PLACE_BOUND.has(p.type) ? STATES.filter(([, re]) => re.test(p.location)) : [];
    return { ...p, where: states.length === 1 ? states[0][0] : PAN_INDIA };
  });
  const counts = new Map<string, number>();
  for (const p of located) counts.set(p.where, (counts.get(p.where) ?? 0) + 1);
  const states = [...counts.keys()].filter((s) => s !== PAN_INDIA).sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
  return { programs: located, order: [PAN_INDIA, ...states] };
}

export const isOpen = (p: PublicProgram) => p.application_status === "open" || p.application_status === "rolling";
export const takesNoEquity = (p: PublicProgram) => /^(none|no\b|0%)/i.test(p.equity_taken);
