"""The repository on disk: data/programs.json is the state, docs/ and PROGRAMS.md are what people read."""

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "sources.yaml"
DB = ROOT / "data" / "programs.json"
CHANGELOG = ROOT / "data" / "CHANGELOG.md"
SITE_JSON = ROOT / "docs" / "programs.json"
TABLE = ROOT / "PROGRAMS.md"

# Fields worth announcing in the changelog. Free-text fields get reworded on every
# re-extraction, so they're updated silently instead.
TRACKED = ["max_funding_usd", "equity_taken", "application_status", "deadline", "type"]


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def load_sources() -> list[dict]:
    return yaml.safe_load(SOURCES.read_text())["programs"]


def add_sources(new: list[dict]) -> list[dict]:
    """Append programs to sources.yaml, skipping names or domains we already have."""
    current = load_sources()
    seen_names = {slug(s["name"]) for s in current}
    seen_domains = {_domain(s["url"]) for s in current}
    added = []
    for c in new:
        if slug(c["name"]) in seen_names or _domain(c["url"]) in seen_domains:
            continue
        seen_names.add(slug(c["name"]))
        seen_domains.add(_domain(c["url"]))
        added.append(c)
    if added:
        header = "" if "Found by" in SOURCES.read_text() else "\n  # --- Found by `radar discover` ---\n"
        with SOURCES.open("a") as f:
            f.write(header)
            for c in added:
                f.write(f"  - {{ name: {json.dumps(c['name'])}, url: {json.dumps(c['url'])} }}\n")
    return added


def _domain(url: str) -> str:
    return re.sub(r"^www\.", "", url.split("//")[-1].split("/")[0].lower())


def load_db() -> dict:
    return json.loads(DB.read_text()) if DB.exists() else {}


def save_db(db: dict) -> None:
    DB.parent.mkdir(exist_ok=True)
    DB.write_text(json.dumps(db, indent=2, sort_keys=True, ensure_ascii=False) + "\n")


def diff(old: dict | None, new: dict) -> list[str]:
    if old is None:
        return ["added"]
    return [f"{k}: {old.get(k)} → {new.get(k)}" for k in TRACKED if old.get(k) != new.get(k)]


def log_changes(stamp: str, changes: dict[str, list[str]]) -> None:
    if not changes:
        return
    entry = f"## {stamp}\n\n" + "".join(
        f"- **{name}**: {'; '.join(items)}\n" for name, items in sorted(changes.items())
    )
    previous = CHANGELOG.read_text().removeprefix("# Changelog\n\n") if CHANGELOG.exists() else ""
    CHANGELOG.write_text(f"# Changelog\n\n{entry}\n{previous}")


def publish(db: dict) -> int:
    """Write the public outputs: docs/programs.json (for the site) and PROGRAMS.md (for GitHub)."""
    rows = [
        {**r["program"], "source_url": r["source"]["url"], "last_checked": r["last_checked"],
         "last_changed": r["last_changed"]}
        for r in db.values() if r.get("program")
    ]
    rows.sort(key=lambda p: (-(p["max_funding_usd"] or 0), p["name"].lower()))
    SITE_JSON.parent.mkdir(exist_ok=True)
    SITE_JSON.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")

    cell = lambda v: str(v if v not in (None, "") else "—").replace("|", "/").replace("\n", " ")
    lines = [
        "# Startup funding programs\n",
        f"{len(rows)} programs, sorted by max cash. Auto-updated; see [data/CHANGELOG.md](data/CHANGELOG.md).\n",
        "| Program | Type | Money | Equity | Status | Deadline | Where | Top benefits |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for p in rows:
        lines.append("| " + " | ".join(cell(v) for v in [
            f"[{p['name']}]({p['apply_url'] or p['source_url']})", p["type"], p["funding_summary"],
            p["equity_taken"], p["application_status"], p["deadline"], p["location"],
            "; ".join(p["benefits"][:3]),
        ]) + " |")
    TABLE.write_text("\n".join(lines) + "\n")
    return len(rows)
