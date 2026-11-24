// npm run update | npm run discover | npm run agent publish | npm run agent import
import { readFileSync } from "node:fs";
import { contentHash, fetchPage, firecrawlEnabled, looksCompromised, type Page } from "./fetch";
import * as llm from "./llm";
import * as store from "./store";
import * as x from "./x-signals";
import { ProgramSchema, type Program, type ProgramRecord, type Source } from "./schema";

// Pages we can scrape are checked every run (cheap: only a hash unless the page changed).
// Pages we can't scrape need a web-research call, so we refresh those less often.
const RESEARCH_EVERY_MS = 3 * 24 * 60 * 60 * 1000;
const UNSAFE = store.UNSAFE;
const FIRECRAWL_EVERY_MS = Number(process.env.RADAR_FIRECRAWL_HOURS ?? 24) * 60 * 60 * 1000;

type Result = { record: ProgramRecord | null; changes: string[]; line: string };

export async function check(src: Source, record: ProgramRecord | undefined, force: boolean): Promise<Result> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const base = { source: src, last_checked: now.toISOString(), error: null };

  // Pages only Firecrawl can read cost a credit per read, so check those once a day, not every run.
  if (record?.reader === "firecrawl" && !force && now.getTime() - new Date(record.last_checked).getTime() < FIRECRAWL_EVERY_MS) {
    return { record: null, changes: [], line: `  skip      ${src.name} (Firecrawl page, read ${record.last_checked.slice(0, 16)})` };
  }

  let page: Page | null = null;
  try {
    page = await fetchPage(src.url);
  } catch {
    // neither a direct read nor Firecrawl got the page -> Claude researches it on the web instead
  }

  let mode: "page" | "research";
  let hash: string | undefined;
  let program: Program | null;
  try {
    if (page && looksCompromised(page.text)) {
      // Keep the last good data but hide the program from the site until its page is clean.
      return { record: { ...record, ...base, error: UNSAFE }, changes: [], line: `  UNSAFE    ${src.name}: page shows spam injection; hidden` };
    }
    if (page) {
      mode = "page";
      hash = contentHash(page.text);
      if (record?.content_hash === hash && !force) {
        return { record: { ...record, ...base, reader: page.reader }, changes: [], line: `  same      ${src.name}` };
      }
      program = await llm.extract(src, page.text, today);
    } else {
      if (record?.mode === "research" && !force) {
        const last = new Date(record.last_checked);
        if (now.getTime() - last.getTime() < RESEARCH_EVERY_MS) {
          return { record: null, changes: [], line: `  skip      ${src.name} (researched ${record.last_checked.slice(0, 10)})` };
        }
      }
      mode = "research";
      program = await llm.researchProgram(src, today);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { record: { ...record, ...base, error: msg }, changes: [], line: `  ERROR     ${src.name}: ${msg}` };
  }

  if (!program) {
    return { record: { ...record, ...base, error: "extraction failed" }, changes: [], line: `  ERROR     ${src.name}: no result` };
  }
  const changes = store.diff(record?.program, program);
  const rec: ProgramRecord = {
    ...base,
    mode,
    reader: page?.reader,
    content_hash: hash ?? contentHash(JSON.stringify(program)),
    program,
    last_changed: changes.length || !record ? now.toISOString() : record.last_changed,
  };
  const how = page ? `page via ${page.reader}` : "web research";
  return { record: rec, changes, line: `  ${changes.length ? "CHANGED  " : "refreshed"} ${src.name} [${how}] ${changes.join("; ")}` };
}

/** Run `fn` over `items` with at most `limit` in flight, keeping order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function update(force: boolean, only?: string, workers = 6) {
  const db = store.loadDb();
  let sources = store.loadSources();
  if (only) sources = sources.filter((s) => s.name.toLowerCase().includes(only.toLowerCase()));
  const fc = !firecrawlEnabled() ? "off" : process.env.RADAR_FIRECRAWL === "always" ? "every page" : "fallback for blocked/JS pages";
  // Programs Grok spotted news about on X get a fresh read even if their last read looks recent or unchanged.
  const flagged = x.pendingPrograms();
  console.log(`Checking ${sources.length} programs... (Firecrawl: ${fc}; flagged by X: ${flagged.size})`);
  const results = await pool(sources, workers, (s) => check(s, db[store.slug(s.name)], force || flagged.has(store.slug(s.name))));
  x.markHandled(new Set(sources.map((s) => store.slug(s.name)).filter((k, i) => flagged.has(k) && results[i].record && !results[i].record!.error)));

  const changes: Record<string, string[]> = {};
  results.forEach(({ record, changes: diff, line }, i) => {
    console.log(line);
    const src = sources[i];
    if (record) db[store.slug(src.name)] = record;
    if (diff.length) changes[src.name] = diff;
  });
  store.saveDb(db);
  store.logChanges(new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", changes);
  console.log(`${Object.keys(changes).length} changed. ${store.writeTable(db)} programs in the repository.`);
}

async function xSignals(days: number) {
  const known = store.loadSources().map((s) => s.name);
  const { signals, postsFetched } = await x.searchX(known, days);
  const { fresh, newSources } = x.recordSignals(signals);
  console.log(`Grok read ${postsFetched} X posts (~$${((postsFetched * 5) / 1000).toFixed(2)} in X Search fees) and found ${signals.length} signals, ${fresh.length} new:`);
  for (const s of fresh) console.log(`  ${s.tracked_as ? "TRACKED" : "NEW    "} ${s.posted_on} ${s.program}: ${s.summary}\n            ${s.post_url}`);
  if (newSources.length) console.log(`Added ${newSources.length} new programs to sources.yaml.`);
  console.log("Run `npm run update` to re-read flagged programs from their official pages.");
}

async function discover(count: number) {
  const known = store.loadSources().map((s) => s.name);
  const found = await llm.discover(known, count, new Date().toISOString().slice(0, 10));
  const added = store.addSources(found);
  console.log(`Found ${found.length}, added ${added.length} new:`);
  added.forEach((c) => console.log(`  + ${c.name}  ${c.url}`));
  if (added.length) console.log("Run `npm run update` to pull their details.");
}

/** Load hand-researched records ({ source, program }[] JSON files) into the repository. */
/** A researched record. `read` says how its page was read, so the agent's change detection starts from it. */
type ImportItem = { source: Source; program: unknown; read?: { reader: "direct" | "firecrawl"; text: string } };

function importFiles(files: string[]) {
  const db = store.loadDb();
  const sources = store.loadSources();
  const now = new Date().toISOString();
  const added: Source[] = [];
  const changes: Record<string, string[]> = {};
  let imported = 0;
  for (const file of files) {
    for (const item of JSON.parse(readFileSync(file, "utf8")) as ImportItem[]) {
      const parsed = ProgramSchema.safeParse(item.program);
      if (!parsed.success) {
        console.log(`  REJECTED  ${item.source?.name}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
        continue;
      }
      // Reuse the existing sources.yaml entry for a program we already track, so the agent updates the same record.
      // Match by name; match by page only for a placeholder that has no record yet, because one official page
      // often describes several schemes (e.g. a state portal listing a grant and a seed loan).
      const existing =
        sources.find((s) => store.slug(s.name) === store.slug(item.source.name)) ??
        sources.find((s) => store.pageKey(s.url) === store.pageKey(item.source.url) && !db[store.slug(s.name)]);
      const src = existing ?? item.source;
      if (!existing) {
        sources.push(src);
        added.push(src);
      }
      const key = store.slug(src.name);
      const before = db[key];
      const diff = store.diff(before?.program, parsed.data);
      if (diff.length) changes[src.name] = diff;
      db[key] = {
        source: src,
        mode: item.read ? "page" : "research",
        reader: item.read?.reader,
        content_hash: item.read ? contentHash(item.read.text) : undefined,
        last_checked: now,
        last_changed: diff.length || !before?.last_changed ? now : before.last_changed,
        error: null,
        program: parsed.data,
      };
      imported++;
    }
  }
  store.addSources(added, { samePageOk: true });
  store.saveDb(db);
  store.logChanges(now.slice(0, 16).replace("T", " ") + " UTC", changes);
  const changed = Object.keys(changes).length;
  console.log(`Imported ${imported} programs (${added.length} new sources, ${changed} changed). ${store.writeTable(db)} programs in the repository.`);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const HELP = `Usage:
  npm run update [-- --force] [-- --only "Y Comb"]   check every program, refresh what changed
  npm run discover [-- --count 20]                   search the web for programs we don't track
  npm run agent publish                              rebuild PROGRAMS.md from data
  npm run agent import <file.json...>                load researched { source, program } records
  npm run x-signals [-- --days 3]                    have Grok scan X for funding news (needs XAI_API_KEY)`;

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "update") await update(args.includes("--force"), flag(args, "--only"), Number(flag(args, "--workers") ?? 6));
  else if (cmd === "discover") await discover(Number(flag(args, "--count") ?? 15));
  else if (cmd === "publish") console.log(`${store.writeTable(store.loadDb())} programs in PROGRAMS.md`);
  else if (cmd === "import") importFiles(args);
  else if (cmd === "x-signals") await xSignals(Number(flag(args, "--days") ?? 3));
  else console.log(HELP);
}

if (process.argv[1]?.endsWith("cli.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
