#!/usr/bin/env python3
"""Recovery + additions for the Resonance corpus download pass.

1. Retries the main stager's failed items: Gutenberg via the pglaf mirror,
   IA items once more as-is.
2. Fetches the approved additions (Desert Fathers, Eckhart/Field 1909,
   Origen's On First Principles via ANF IV, creeds + catechisms via Schaff,
   Spurgeon's Morning and Evening, Fenelon, Guyon, Theologia Germanica),
   preferring pre-1928 editions. Anything unresolved is logged 'pending'.
Writes texts to corpus/staging_v3/{gutenberg,ia,ccel,additions}/ and a
results log to corpus/staging_v3/meta/additions-log.json.
"""
import json, re, subprocess, sys, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "corpus/staging_v3"
LOG = []

def fetch(url: str) -> str | None:
    p = subprocess.run(["curl", "-sL", "--fail", "-A", "Mozilla/5.0", "--max-time", "120", url],
                       capture_output=True)
    if p.returncode != 0 or len(p.stdout) < 2000:
        return None
    return p.stdout.decode("utf-8", errors="replace")

def save(kind: str, slug: str, text: str, meta: dict):
    d = OUT / kind; d.mkdir(parents=True, exist_ok=True)
    (d / f"{slug}.txt").write_text(text)
    LOG.append({"slug": slug, "kind": kind, "chars": len(text), "status": "ok", **meta})
    print("OK  ", kind, slug, len(text))

def ia_search(query: str, max_year: int = 1928) -> str | None:
    """Return a _djvu.txt URL for the best pre-max_year IA match, or None."""
    q = urllib.parse.quote(query)
    url = (f"https://archive.org/advancedsearch.php?q={q}"
           f"&fl[]=identifier&fl[]=year&fl[]=title&rows=8&output=json")
    raw = fetch(url)
    if not raw:
        return None
    try:
        docs = json.loads(raw)["response"]["docs"]
    except Exception:
        return None
    for d in docs:
        year = d.get("year") or 9999
        if year > max_year:
            continue
        ident = d["identifier"]
        meta_raw = fetch(f"https://archive.org/metadata/{ident}")
        if not meta_raw:
            continue
        try:
            files = json.loads(meta_raw)["files"]
        except Exception:
            continue
        for f in files:
            if f["name"].endswith("_djvu.txt"):
                return f"https://archive.org/download/{ident}/{f['name']}"
    return None

def slugify(s: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")

# ---------- 1. recovery ----------
idx = json.loads((OUT / "meta/run-index.json").read_text())
for w in idx.get("warnings", []):
    title, kind = w["title"], w["source_kind"]
    m = re.search(r"\['(https://[^']+)'", w.get("error", ""))
    if not m:
        LOG.append({"slug": slugify(title), "status": "pending", "reason": "no url in warning"}); continue
    url = m.group(1)
    if kind == "gutenberg":
        url = url.replace("www.gutenberg.org", "gutenberg.pglaf.org")
    text = fetch(url)
    if text:
        save(kind, slugify(title), text, {"recovered": True, "from": url})
    else:
        LOG.append({"slug": slugify(title), "kind": kind, "status": "pending", "reason": f"retry failed: {url}"})
        print("PEND", kind, title)

# ---------- 2. additions ----------
CCEL = [
    ("origen-first-principles-anf04", "https://ccel.org/ccel/schaff/anf04/cache/anf04.txt",
     "Origen, On First Principles (ANF IV translation, public domain)"),
    ("spurgeon-morning-and-evening", "https://ccel.org/ccel/spurgeon/morning/cache/morning.txt",
     "Spurgeon, Morning and Evening (CCEL)"),
    ("schaff-creeds-vol1", "https://ccel.org/ccel/schaff/creeds1/cache/creeds1.txt",
     "Schaff, Creeds of Christendom vol 1 (ecumenical creeds)"),
    ("schaff-creeds-vol3", "https://ccel.org/ccel/schaff/creeds3/cache/creeds3.txt",
     "Schaff, Creeds of Christendom vol 3 (Heidelberg, Westminster)"),
]
for slug, url, note in CCEL:
    text = fetch(url)
    if text:
        save("additions", slug, text, {"from": url, "note": note})
    else:
        LOG.append({"slug": slug, "status": "pending", "reason": f"CCEL fetch failed: {url}"})
        print("PEND", slug)

IA_ADDITIONS = [
    ("desert-fathers-paradise-budge", 'title:(paradise of the holy fathers) AND creator:(budge)'),
    ("desert-fathers-wisdom-hannay", 'title:(wisdom of the desert) AND creator:(hannay)'),
    ("eckhart-sermons-field-1909", 'title:(meister eckhart) AND (sermons) AND date:[1900 TO 1928]'),
    ("theologia-germanica-winkworth", 'title:(theologia germanica) AND date:[1850 TO 1928]'),
    ("fenelon-spiritual-letters", 'title:(fenelon) AND (letters OR counsel) AND date:[1700 TO 1928]'),
    ("guyon-method-of-prayer", 'title:(guyon) AND (prayer) AND date:[1700 TO 1928]'),
]
for slug, query in IA_ADDITIONS:
    if any(e.get("slug") == slug and e.get("status") == "ok" for e in LOG):
        continue
    url = ia_search(query)
    text = fetch(url) if url else None
    if text:
        save("additions", slug, text, {"from": url, "note": "IA pre-1928 edition"})
    else:
        LOG.append({"slug": slug, "status": "pending", "reason": f"IA search unresolved: {query}"})
        print("PEND", slug)

(OUT / "meta/additions-log.json").write_text(json.dumps(LOG, indent=1))
ok = sum(1 for e in LOG if e["status"] == "ok")
print(f"\nadditions/recovery: {ok} ok, {len(LOG) - ok} pending of {len(LOG)}")
