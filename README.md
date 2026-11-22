# Funds Radar

A research agent that tracks what accelerators, incubators, fellowships and grant programs around the world give founders: cash, equity terms, perks, eligibility and deadlines. It keeps everything in one repository and updates itself when a program changes its page.

- **[PROGRAMS.md](PROGRAMS.md)**: the full table, readable on GitHub
- **[docs/](docs/index.html)**: a searchable website (GitHub Pages)
- **[data/CHANGELOG.md](data/CHANGELOG.md)**: what changed and when

## How it works

```
sources.yaml ──► fetch page ──► page text changed? ──no──► skip (free)
  (33 programs)      │                    │
                     │                   yes
          blocked / JS-only page          ▼
                     │           Claude extracts ──► data/programs.json ──► PROGRAMS.md
                     ▼            structured fields        │                docs/programs.json
          Claude researches it                             ▼
          on the web (every 3 days)              diff ──► data/CHANGELOG.md

every Monday: Claude searches the web for new programs ──► appends to sources.yaml
```

1. **Watch.** Every 6 hours, each program's page is downloaded and reduced to its visible text. A hash of that text tells us whether anything changed. Unchanged pages cost nothing.
2. **Extract.** When a page changes, Claude (`claude-opus-5-5`, structured outputs) turns it into a fixed record: funding, max cash in USD, equity, benefits, eligibility, location, status, deadline, apply link. Claude uses only facts the page states.
3. **Fallback.** Some sites block bots or only render with JavaScript. For those, Claude searches and reads the web itself, at most every 3 days.
4. **Discover.** Once a week Claude searches globally for programs we don't track yet and adds them to `sources.yaml`.
5. **Log.** Changes to funding, equity, status, deadline or type go into the changelog. Git history keeps every past version.

## Run it locally

```bash
export ANTHROPIC_API_KEY=sk-ant-...
uv run radar update               # check every program (first run extracts all of them)
uv run radar update --only "Y Comb" --force   # re-extract one program
uv run radar discover --count 20  # find new programs
open docs/index.html              # or: cd docs && python3 -m http.server
```

Add a program by hand: append `- { name: ..., url: ... }` to `sources.yaml`, using the page that describes the deal.

## Put it on autopilot (GitHub)

1. Push this folder to a GitHub repo.
2. **Settings → Secrets and variables → Actions**: add `ANTHROPIC_API_KEY`.
3. **Settings → Pages**: deploy from branch `main`, folder `/docs`.
4. **Actions → Update programs → Run workflow** for the first fill. After that it runs by itself every 6 hours ([.github/workflows/update.yml](.github/workflows/update.yml)).

## Cost

Rough estimate: the first full run is about 33 Claude calls. After that, only changed pages and the few research-mode programs call Claude, so most runs make 0–6 calls.

## Files

| File | What it does |
|---|---|
| `sources.yaml` | The list of programs to watch |
| `radar/fetch.py` | Downloads a page, strips it to text, hashes it |
| `radar/llm.py` | All Claude calls: extract, web research, discover |
| `radar/models.py` | The `Program` schema Claude fills in |
| `radar/store.py` | Saves data, writes the changelog, publishes outputs |
| `radar/cli.py` | `radar update / discover / publish` |
