# Funds Radar

A research agent that tracks what accelerators, incubators, fellowships and grant programs around the world give founders: cash, equity terms, perks, eligibility and deadlines. It keeps everything in one repository, updates itself when a program changes its page, and publishes a searchable site.

**Live site:** https://ridaaawww.github.io/fundsWB/ (worldwide, by region) and [/india](https://ridaaawww.github.io/fundsWB/india/) (central and state schemes, incubators, investors and venture debt, by stage)

- **[PROGRAMS.md](PROGRAMS.md)**: the full table, readable on GitHub
- **[data/CHANGELOG.md](data/CHANGELOG.md)**: what changed and when

Built with Next.js, TypeScript and the Claude API. Tests run on Vitest.

## How it works

```
sources.yaml ──► fetch page ──► page text changed? ──no──► skip (free)
  (33 programs)      │                    │
                     │                   yes
          blocked / JS-only page          ▼
                     │           Claude extracts ──► data/programs.json ──► Next.js site
                     ▼            structured fields        │                PROGRAMS.md
          Claude researches it                             ▼
          on the web (every 3 days)              diff ──► data/CHANGELOG.md

every Monday: Claude searches the web for new programs ──► appends to sources.yaml
```

1. **Watch.** Every 6 hours, each program's page is downloaded and reduced to its visible text. A hash of that text tells us whether anything changed. Unchanged pages cost nothing. Pages that block bots or need JavaScript (about 38 of ~200, mostly Indian government portals) are read through [Firecrawl](https://firecrawl.dev) instead, once a day each (~1,150 scrapes a month). Set `RADAR_FIRECRAWL=always` to read every page through Firecrawl.
2. **Extract.** When a page changes, Claude (`claude-opus-5-5`, structured outputs with a Zod schema) turns it into a fixed record: funding, max cash in USD, equity, benefits, eligibility, location, status, deadline, apply link. Claude uses only facts the page states.
3. **Fallback.** Some sites block bots or only render with JavaScript. For those, Claude searches and reads the web itself, at most every 3 days.
4. **Discover.** Once a week Claude searches globally for programs we don't track yet and adds them to `sources.yaml`.
5. **Watch X.** Once a day Grok (xAI, `x_search`) scans X for funding news: cohorts opening, deadlines moving, new grant schemes. Posts are leads, not facts: a post about a tracked program makes the agent re-read its official page; a new program with an official page is added to `sources.yaml`. The newest signals show as "Latest from X" on the site (`data/x-signals.json`).
5. **Publish.** The Next.js site is a static export built from `data/programs.json`, deployed to GitHub Pages after every update.

## Run it locally

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
export FIRECRAWL_API_KEY=fc-...         # optional: reads bot-blocked and JavaScript-only pages
export XAI_API_KEY=xai-...              # optional: Grok scans X for funding news

npm run update                          # check every program (first run extracts all of them)
npm run update -- --only "Y Comb" --force   # re-extract one program
npm run discover -- --count 20          # find new programs
npm run x-signals -- --days 3           # Grok scans X for funding news from the last 3 days
npm run dev                             # site at http://localhost:3000
npm test                                # agent tests (offline, no API calls)
npm run agent import -- research.json   # load hand-researched { source, program } records
```

Add a program by hand: append `- { name: ..., url: ... }` to `sources.yaml`, using the page that describes the deal.

## Automation

[.github/workflows/update.yml](.github/workflows/update.yml) runs every 6 hours (and on Mondays also discovers new programs). It runs the agent, commits any changes, then tests, builds and deploys the site. Pushing code to `main` rebuilds the site without running the agent.

It needs the repository secret `ANTHROPIC_API_KEY`; without it the agent step is skipped and the site still deploys. Add `FIRECRAWL_API_KEY` too so pages that block bots are read directly instead of through slower web research.

## Project layout

| Path | What it is |
|---|---|
| `sources.yaml` | The list of programs to watch |
| `agent/fetch.ts` | Reads a page (direct request, Firecrawl fallback), strips it to text, hashes it |
| `agent/llm.ts` | All Claude calls: extract, web research, discover |
| `agent/x-signals.ts` | Grok scans X for funding news and flags programs for a re-check |
| `agent/schema.ts` | The `Program` Zod schema Claude fills in |
| `agent/store.ts` | Saves data, writes the changelog and PROGRAMS.md |
| `agent/cli.ts` | `update` / `discover` / `publish` commands |
| `agent/agent.test.ts` | Vitest tests with Claude and the network stubbed |
| `app/` | The Next.js site (reads `data/programs.json` at build time) |
