"""Download a page and reduce it to the visible text, so we can hash it and hand it to Claude."""

import hashlib
import re

import httpx
from bs4 import BeautifulSoup

USER_AGENT = "Mozilla/5.0 (compatible; funds-radar/0.1)"
MIN_USEFUL_CHARS = 800  # less than this usually means a JS-only page or a bot wall


class ThinPage(Exception):
    """The page loaded but had too little text to be useful."""


def fetch_text(url: str) -> str:
    resp = httpx.get(url, follow_redirects=True, timeout=30, headers={"User-Agent": USER_AGENT})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()
    lines = (re.sub(r"\s+", " ", line).strip() for line in soup.get_text("\n").splitlines())
    text = "\n".join(line for line in lines if line)
    if len(text) < MIN_USEFUL_CHARS:
        raise ThinPage(f"only {len(text)} chars of text")
    return text


def content_hash(text: str) -> str:
    # Ignore per-request noise (trace ids, cache-busters) so only real edits count as changes.
    stable = re.sub(r"\b[0-9a-fA-F-]{16,}\b", "", text)
    return hashlib.sha256(stable.encode()).hexdigest()[:16]
