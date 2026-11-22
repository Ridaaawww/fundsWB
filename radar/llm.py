"""Every Claude call lives here: extract a page, research a program on the web, discover new programs."""

from typing import Optional

import anthropic

from .models import Discovery, Program

MODEL = "claude-opus-5-5"
# If a request is declined by a safety classifier, the API retries it on a fallback model.
FALLBACK = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
WEB_TOOLS = [
    {"type": "web_search_20260209", "name": "web_search", "max_uses": 8},
    {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 8},
]

client = anthropic.Anthropic()

EXTRACT_SYSTEM = """You extract facts about startup funding programs (accelerators, incubators, \
fellowships, grants, credit programs) for a public directory founders rely on.
Use only what the source states. If something isn't stated, say 'not stated' or use null. \
Never guess amounts or deadlines. Convert non-USD amounts to approximate USD in max_funding_usd \
and keep the original currency in funding_summary."""


def extract(name: str, url: str, source_text: str, today: str) -> Optional[Program]:
    """Turn page text (or research notes) into a structured Program."""
    resp = client.beta.messages.parse(
        model=MODEL,
        max_tokens=16000,
        system=EXTRACT_SYSTEM,
        output_config={"effort": "low"},
        output_format=Program,
        messages=[{
            "role": "user",
            "content": f"Today is {today}. Program: {name}\nSource: {url}\n\n<source>\n{source_text}\n</source>",
        }],
        **FALLBACK,
    )
    if resp.stop_reason != "end_turn":
        return None
    return resp.parsed_output


def web_research(prompt: str) -> str:
    """Let Claude search and read the web, and return its written findings."""
    messages = [{"role": "user", "content": prompt}]
    for _ in range(5):  # resume server-side tool loops that pause
        resp = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            output_config={"effort": "medium"},
            tools=WEB_TOOLS,
            messages=messages,
            **FALLBACK,
        )
        if resp.stop_reason != "pause_turn":
            break
        messages = [messages[0], {"role": "assistant", "content": resp.content}]
    return "\n".join(b.text for b in resp.content if b.type == "text")


def research_program(name: str, url: str, today: str) -> Optional[Program]:
    """Fallback for pages we can't scrape (bot walls, JS-only sites)."""
    notes = web_research(
        f"Today is {today}. Find the current funding, equity terms, benefits, eligibility, location, "
        f"application status and next deadline for the startup program '{name}' (official site: {url}). "
        "Prefer the official site; note the source of each fact. Write plain notes."
    )
    return extract(name, url, notes, today) if notes.strip() else None


def discover(known: list[str], count: int, today: str) -> list[dict]:
    """Search the web for good programs we don't track yet."""
    notes = web_research(
        f"Today is {today}. Find up to {count} notable startup accelerators, incubators, fellowships, "
        "grants or startup credit programs anywhere in the world that give founders money or substantial "
        "benefits and are currently active. Cover different regions (US, Europe, India, Africa, LatAm, "
        "Asia, Middle East). For each, give its name and the official page that describes the funding.\n\n"
        "Skip these, we already track them:\n" + "\n".join(f"- {k}" for k in known)
    )
    resp = client.beta.messages.parse(
        model=MODEL,
        max_tokens=16000,
        output_config={"effort": "low"},
        output_format=Discovery,
        messages=[{"role": "user", "content": f"List every program in these notes with its official URL.\n\n{notes}"}],
        **FALLBACK,
    )
    if resp.stop_reason != "end_turn" or resp.parsed_output is None:
        return []
    return [c.model_dump() for c in resp.parsed_output.programs]
