// The repository on disk: data/programs.json is the state; the website and PROGRAMS.md are built from it.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { REGIONS, type Db, type Program, type PublicProgram, type Source } from "./schema";

const ROOT = process.env.RADAR_ROOT ?? process.cwd();
const SOURCES = path.join(ROOT, "sources.yaml");
const DB = path.join(ROOT, "data", "programs.json");
const CHANGELOG = path.join(ROOT, "data", "CHANGELOG.md");
const TABLE = path.join(ROOT, "PROGRAMS.md");

// Fields worth announcing in the changelog. Free-text fields get reworded on every
// re-extraction, so they're updated silently instead.
const TRACKED = ["max_funding_usd", "equity_taken", "application_status", "deadline", "type", "region"] as const;

export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Same page regardless of protocol, "www." or trailing slash. Different pages on one site
// (e.g. Antler India vs Antler US) stay distinct.
export const pageKey = (url: string) =>
  url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

export function loadSources(): Source[] {
  return YAML.parse(readFileSync(SOURCES, "utf8")).programs;
}

/**
 * Programs from `found` we don't already track. By default a known page counts as known (web discovery
 * often re-finds a tracked program under another name); `samePageOk` allows distinct schemes on one page.
 */
export function newSources(current: Source[], found: Source[], { samePageOk = false } = {}): Source[] {
  const names = new Set(current.map((s) => slug(s.name)));
  const pages = new Set(current.map((s) => pageKey(s.url)));
  return found.filter((c) => {
    if (names.has(slug(c.name)) || (!samePageOk && pages.has(pageKey(c.url)))) return false;
    names.add(slug(c.name));
    pages.add(pageKey(c.url));
    return true;
  });
}

export function addSources(found: Source[], opts: { samePageOk?: boolean } = {}): Source[] {
  const added = newSources(loadSources(), found, opts);
  if (added.length) {
    let text = readFileSync(SOURCES, "utf8");
    if (!text.includes("Found by")) text += "\n  # --- Found by `npm run discover` ---\n";
    text += added.map((c) => `  - { name: ${JSON.stringify(c.name)}, url: ${JSON.stringify(c.url)} }\n`).join("");
    writeFileSync(SOURCES, text);
  }
  return added;
}

export function loadDb(): Db {
  return existsSync(DB) ? JSON.parse(readFileSync(DB, "utf8")) : {};
}

export function saveDb(db: Db): void {
  mkdirSync(path.dirname(DB), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(db).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(DB, JSON.stringify(sorted, null, 2) + "\n");
}

export function diff(old: Program | undefined, next: Program): string[] {
  if (!old) return ["added"];
  return TRACKED.filter((k) => old[k] !== next[k]).map((k) => `${k}: ${old[k]} → ${next[k]}`);
}

export function logChanges(stamp: string, changes: Record<string, string[]>): void {
  const names = Object.keys(changes).sort();
  if (!names.length) return;
  const entry = `## ${stamp}\n\n` + names.map((n) => `- **${n}**: ${changes[n].join("; ")}\n`).join("");
  const previous = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8").replace(/^# Changelog\n\n/, "") : "";
  writeFileSync(CHANGELOG, `# Changelog\n\n${entry}\n${previous}`);
}

/** The public view of the data: one row per successfully extracted program, most money first. */
/** Error marker for a program whose official page looks hacked; it stays in the data but off the site. */
export const UNSAFE = "unsafe: official page shows spam injection (likely hacked)";

export function toPublic(db: Db): PublicProgram[] {
  return Object.values(db)
    .filter((r) => r.program && r.error !== UNSAFE)
    .map((r) => ({ ...r.program!, source_url: r.source.url, last_checked: r.last_checked, last_changed: r.last_changed }))
    .sort((a, b) => (b.max_funding_usd ?? 0) - (a.max_funding_usd ?? 0) || a.name.localeCompare(b.name));
}

/** PROGRAMS.md: the table people see when browsing the repo on GitHub. */
export function writeTable(db: Db): number {
  const rows = toPublic(db);
  const cell = (v: unknown) => String(v ?? "—").replaceAll("|", "/").replaceAll("\n", " ") || "—";
  const lines = [
    "# Startup funding programs\n",
    `${rows.length} programs by region, sorted by max cash. Auto-updated; see [data/CHANGELOG.md](data/CHANGELOG.md).\n`,
  ];
  for (const region of REGIONS) {
    const inRegion = rows.filter((p) => p.region === region);
    if (!inRegion.length) continue;
    lines.push(
      `\n## ${region} (${inRegion.length})\n`,
      "| Program | Type | Money | Equity | Status | Deadline | Where | Top benefits |",
      "|---|---|---|---|---|---|---|---|",
      ...inRegion.map(
        (p) =>
          "| " +
          [
            `[${p.name}](${p.apply_url || p.source_url})`,
            p.type,
            p.funding_summary,
            p.equity_taken,
            p.application_status,
            p.deadline,
            p.location,
            p.benefits.slice(0, 3).join("; "),
          ]
            .map(cell)
            .join(" | ") +
          " |",
      ),
    );
  }
  writeFileSync(TABLE, lines.join("\n") + "\n");
  return rows.length;
}
