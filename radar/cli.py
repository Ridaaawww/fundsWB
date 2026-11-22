"""radar update | radar discover | radar publish"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from . import llm, store
from .fetch import content_hash, fetch_text

# Pages we can scrape are checked every run (cheap: only a hash unless the page changed).
# Pages we can't scrape need a web-research call, so we refresh those less often.
RESEARCH_EVERY = timedelta(days=3)


def now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def check(source: dict, record: dict | None, force: bool) -> tuple[dict | None, list[str], str]:
    """Check one program. Returns (new record or None if unchanged-and-untouched, changes, log line)."""
    name, url, t = source["name"], source["url"], now()
    today = t.date().isoformat()
    base = {"source": source, "last_checked": t.isoformat(), "error": None}
    try:
        text = fetch_text(url)
    except Exception:  # blocked, JS-only, 4xx/5xx... -> Claude researches it on the web instead
        text = None

    try:
        if text:
            mode, h = "page", content_hash(text)
            if record and record.get("content_hash") == h and not force:
                return {**record, **base}, [], f"  same      {name}"
            program = llm.extract(name, url, text, today)
        else:
            if record and record.get("mode") == "research" and not force:
                last = datetime.fromisoformat(record["last_checked"])
                if t - last < RESEARCH_EVERY:
                    return None, [], f"  skip      {name} (researched {last.date()})"
            mode, h = "research", None
            program = llm.research_program(name, url, today)
    except Exception as e:
        return {**(record or {}), **base, "error": str(e)}, [], f"  ERROR     {name}: {e}"

    if program is None:
        return {**(record or {}), **base, "error": "extraction failed"}, [], f"  ERROR     {name}: no result"
    new = program.model_dump()
    old = (record or {}).get("program")
    changes = store.diff(old, new)
    h = h or content_hash(str(new))
    rec = {**base, "mode": mode, "content_hash": h, "program": new,
           "last_changed": t.isoformat() if changes or not record else record.get("last_changed")}
    return rec, changes, f"  {'CHANGED' if changes else 'refreshed'} {name} [{mode}] {'; '.join(changes)}"


def update(force: bool, only: str | None, workers: int) -> None:
    db, sources = store.load_db(), store.load_sources()
    if only:
        sources = [s for s in sources if only.lower() in s["name"].lower()]
    print(f"Checking {len(sources)} programs...")
    with ThreadPoolExecutor(workers) as pool:
        results = list(pool.map(lambda s: (s, *check(s, db.get(store.slug(s["name"])), force)), sources))

    changes = {}
    for source, rec, diff, line in results:
        print(line)
        if rec is not None:
            db[store.slug(source["name"])] = rec
        if diff:
            changes[source["name"]] = diff
    store.save_db(db)
    store.log_changes(now().strftime("%Y-%m-%d %H:%M UTC"), changes)
    print(f"{len(changes)} changed. Published {store.publish(db)} programs.")


def discover(count: int) -> None:
    known = [s["name"] for s in store.load_sources()]
    found = llm.discover(known, count, now().date().isoformat())
    added = store.add_sources(found)
    print(f"Found {len(found)}, added {len(added)} new:")
    for c in added:
        print(f"  + {c['name']}  {c['url']}")
    if added:
        print("Run `radar update` to pull their details.")


def main() -> None:
    p = argparse.ArgumentParser(prog="radar", description="Track startup funding programs.")
    sub = p.add_subparsers(dest="cmd", required=True)
    u = sub.add_parser("update", help="check every program and refresh what changed")
    u.add_argument("--force", action="store_true", help="re-extract even if the page is unchanged")
    u.add_argument("--only", help="only programs whose name contains this text")
    u.add_argument("--workers", type=int, default=6)
    d = sub.add_parser("discover", help="search the web for programs we don't track yet")
    d.add_argument("--count", type=int, default=15)
    sub.add_parser("publish", help="rebuild PROGRAMS.md and docs/programs.json from data")
    a = p.parse_args()

    if a.cmd == "update":
        update(a.force, a.only, a.workers)
    elif a.cmd == "discover":
        discover(a.count)
    else:
        print(f"Published {store.publish(store.load_db())} programs.")


if __name__ == "__main__":
    main()
