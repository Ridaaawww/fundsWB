"use client";

import { useEffect, useMemo, useState } from "react";
import { STAGES, type PublicProgram } from "@/agent/schema";
import type { Located } from "./data";

type Sort = "open" | "money" | "deadline" | "changed" | "name";
type Stage = (typeof STAGES)[number];

// Open now first, then unknown, then closed: what a founder can act on today.
const STATUS_RANK: Record<string, number> = { open: 0, rolling: 0, unknown: 1, closed: 2 };
const byMoney = (a: PublicProgram, b: PublicProgram) => (b.max_funding_usd ?? 0) - (a.max_funding_usd ?? 0);

const SORTS: Record<Sort, (a: PublicProgram, b: PublicProgram) => number> = {
  open: (a, b) => STATUS_RANK[a.application_status] - STATUS_RANK[b.application_status] || byMoney(a, b),
  money: byMoney,
  deadline: (a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"),
  changed: (a, b) => (b.last_changed ?? "").localeCompare(a.last_changed ?? ""),
  name: (a, b) => a.name.localeCompare(b.name),
};

const CATEGORIES: { label: string; types: string[] }[] = [
  { label: "Government grants & schemes", types: ["grant", "other"] },
  { label: "Pre-seed & seed investors", types: ["fund"] },
  { label: "Accelerators & fellowships", types: ["accelerator", "fellowship"] },
  { label: "Incubators", types: ["incubator"] },
  { label: "Venture debt & revenue-based financing", types: ["debt"] },
  { label: "Credits & perks", types: ["credits"] },
];
const categoryOf = (p: PublicProgram) => CATEGORIES.find((c) => c.types.includes(p.type))?.label ?? "Other";

const TYPE_LABEL: Record<string, string> = { fund: "investor", debt: "debt / RBF" };
const STAGE_LABEL: Record<Stage, string> = { idea: "Idea stage", early: "Early stage", growth: "Mid / growth stage" };

const isOpen = (p: PublicProgram) => p.application_status === "open" || p.application_status === "rolling";
const money = (n: number) => (n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : `$${Math.max(1, Math.round(n / 1e3))}k`);
const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
const MULTI = "__multi";

type Props = {
  programs: Located[];
  /** Location pills, in display order (regions, or Pan-India + states). */
  places: string[];
  /** Label for the "everything" option, e.g. "All locations" / "All of India". */
  allPlaces: string;
  /** Sections: by location (worldwide page) or by kind of support (India page). */
  groupBy: "place" | "category";
};

// The one Location dropdown encodes either a whole place ("p:Europe") or a country inside it
// ("c:Europe|Germany"; MULTI for programs open across several countries).
const placeValue = (place: string) => `p:${place}`;
const countryValue = (place: string, country: string) => `c:${place}|${country}`;
function parseLocation(v: string): { place: string; country: string } {
  if (v.startsWith("p:")) return { place: v.slice(2), country: "" };
  if (v.startsWith("c:")) {
    const [place, country] = v.slice(2).split("|");
    return { place, country };
  }
  return { place: "", country: "" };
}

export function ProgramBrowser({ programs, places, allPlaces, groupBy }: Props) {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const { place, country } = parseLocation(location);
  // The page arrives as static HTML and becomes interactive a moment later. Until then the filters are
  // disabled, so a pick made in that moment can't be silently dropped when the script takes over.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [stage, setStage] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<Sort>("open");

  const types = useMemo(() => [...new Set(programs.map((p) => p.type))].sort(), [programs]);

  // Every filter except location, so each Location option's count shows what picking it would give.
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return programs
      .filter((p) => !stage || p.stages?.includes(stage as Stage))
      .filter((p) => !type || p.type === type)
      .filter((p) => !status || (status === "open" ? isOpen(p) : !isOpen(p)))
      .filter((p) => !q || JSON.stringify(p).toLowerCase().includes(q))
      .sort(SORTS[sort]);
  }, [programs, query, stage, type, status, sort]);

  const countryOf = (p: PublicProgram) => p.country ?? MULTI;
  const visible = matching.filter((p) => (!place || p.where === place) && (!country || countryOf(p) === country));

  // Dropdown contents: each place, and (worldwide only) the countries inside it, with live counts.
  const withCountries = new Set(programs.map(countryOf)).size > 1;
  const locationGroups = places.map((pl) => {
    const here = matching.filter((p) => p.where === pl);
    const counts = new Map<string, number>();
    for (const p of programs) if (p.where === pl) counts.set(countryOf(p), 0);
    for (const p of here) counts.set(countryOf(p), (counts.get(countryOf(p)) ?? 0) + 1);
    const countries = [...counts].sort(([a], [b]) => (a === MULTI ? 1 : b === MULTI ? -1 : a.localeCompare(b)));
    // A place whose programs all span several countries (e.g. "Global") needs no country rows.
    const split = withCountries && !(countries.length === 1 && countries[0][0] === MULTI);
    return { place: pl, total: here.length, countries: split ? countries : [] };
  });
  const sectionOf = (p: Located) => (groupBy === "place" ? p.where : categoryOf(p));
  const sections = groupBy === "place" ? places : [...CATEGORIES.map((c) => c.label), "Other"];
  const groups = sections.map((s) => ({ name: s, rows: visible.filter((p) => sectionOf(p) === s) })).filter((g) => g.rows.length);

  if (!programs.length) {
    return (
      <div className="empty">
        <b>First run in progress</b>
        The agent hasn&apos;t filled the directory yet. Check back shortly.
      </div>
    );
  }

  return (
    <>
      <fieldset className="controls" disabled={!ready} aria-label="Filters">
        <label className="search">
          <input
            type="search"
            placeholder="Search by name, sector, city or perk"
            aria-label="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          className="location"
          aria-label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        >
          <option value="">
            {allPlaces} ({matching.length})
          </option>
          {locationGroups.map((g) =>
            g.countries.length ? (
              <optgroup key={g.place} label={g.place}>
                <option value={placeValue(g.place)}>
                  All of {g.place} ({g.total})
                </option>
                {g.countries.map(([c, n]) => (
                  <option key={c} value={countryValue(g.place, c)}>
                    {c === MULTI ? `Multi-country in ${g.place}` : c} ({n})
                  </option>
                ))}
              </optgroup>
            ) : (
              <option key={g.place} value={placeValue(g.place)}>
                {g.place} ({g.total})
              </option>
            ),
          )}
        </select>
        <select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">Any stage</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {capitalize(TYPE_LABEL[t] ?? t)}
            </option>
          ))}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="open">Open now</option>
          <option value="closed">Closed</option>
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="open">Open first</option>
          <option value="money">Most money</option>
          <option value="deadline">Soonest deadline</option>
          <option value="changed">Recently changed</option>
          <option value="name">A–Z</option>
        </select>
      </fieldset>

      <p className="count">
        {visible.length} of {programs.length} programs{place && ` · ${place}`}
        {country && ` · ${country === MULTI ? "multi-country" : country}`}
        {location && (
          <button className="clear" onClick={() => setLocation("")}>
            Clear location
          </button>
        )}
      </p>

      {groups.length ? (
        groups.map((g) => (
          <section key={g.name} className="section" aria-label={g.name}>
            <div className="section-head">
              <h2>{g.name}</h2>
              <span>
                {g.rows.length} {g.rows.length === 1 ? "program" : "programs"}, {g.rows.filter(isOpen).length} open
              </span>
            </div>
            <ul className="list">
              {g.rows.map((p) => (
                <ProgramItem key={p.source_url + p.name} p={p} />
              ))}
            </ul>
          </section>
        ))
      ) : (
        <div className="empty">
          <b>Nothing matches</b>Try a different search or filter.
        </div>
      )}
    </>
  );
}

/** One program, as a few lines of text: name, the money, the terms, then small details. */
function ProgramItem({ p }: { p: PublicProgram }) {
  const terms = [/^none\b/i.test(p.funding_summary) ? "" : p.funding_summary, p.equity_taken && !/not stated/i.test(p.equity_taken) && `Equity: ${p.equity_taken}.`]
    .filter(Boolean)
    .join(". ")
    .replace(/\.\./g, ".")
    .replace(/([^.!?])$/, "$1.");
  const stages = p.stages?.map((s) => (s === "growth" ? "mid-stage" : s)).join(", ");
  const status = { open: "Open now", rolling: "Rolling applications", closed: "Closed", unknown: "Dates not announced" }[p.application_status];
  return (
    <li className="item">
      <h3>
        <a href={p.apply_url || p.source_url} target="_blank" rel="noopener noreferrer">
          {p.name}
        </a>
      </h3>
      <p className="money">{p.max_funding_usd ? `Up to ${money(p.max_funding_usd)}` : "No direct cash; support and perks"}</p>
      <p className="terms" title={terms}>
        {terms}
      </p>
      <div className="meta">
        <span className={isOpen(p) ? "open" : undefined}>{status}</span>
        {p.deadline && <span className="deadline"> · due {p.deadline}</span>}
        {" · "}
        {capitalize(TYPE_LABEL[p.type] ?? p.type)}
        {stages && ` · ${stages}`}
        {` · ${p.location}`}
      </div>
    </li>
  );
}
