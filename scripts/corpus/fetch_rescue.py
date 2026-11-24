#!/usr/bin/env python3
"""Rescue round v2: golden-set-critical works missing or soup-rejected.

Fixes from the v1 failure (0/11): use gutendex's own text/plain format URL
instead of guessing pglaf paths, and walk several IA identifiers via the
metadata API to find a real *_djvu.txt instead of assuming the first hit.
Self-contained (no fetch_additions import — that re-ran the whole pass).
"""
import json, subprocess, urllib.parse
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "corpus/staging_v3/rescue"
OUT.mkdir(parents=True, exist_ok=True)
LOG = []

def fetch(url: str):
    if not url: return None
    r = subprocess.run(["curl", "-sL", "--fail", "-A", "Mozilla/5.0",
                        "--max-time", "120", url], capture_output=True)
    if r.returncode != 0: return None
    try: return r.stdout.decode("utf-8", errors="replace")
    except Exception: return None

def pg_get(query: str, title_hint: str):
    raw = fetch(f"https://gutendex.com/books/?search={urllib.parse.quote(query)}")
    if not raw: return None, None
    try: books = json.loads(raw)["results"]
    except Exception: return None, None
    books.sort(key=lambda b: 0 if title_hint.lower() in b["title"].lower() else 1)
    for b in books[:4]:
        for k, v in b["formats"].items():
            if k.startswith("text/plain") and "readme" not in v:
                t = fetch(v)
                if t and len(t) > 20000: return t, f"PG {b['id']} ({b['title'][:40]})"
        t = fetch(f"https://gutenberg.pglaf.org/cache/epub/{b['id']}/pg{b['id']}.txt")
        if t and len(t) > 20000: return t, f"PG {b['id']} via pglaf"
    return None, None

def ia_get(query: str):
    raw = fetch("https://archive.org/advancedsearch.php?q=" + urllib.parse.quote(query)
                + "&fl[]=identifier&rows=6&output=json")
    if not raw: return None, None
    try: ids = [d["identifier"] for d in json.loads(raw)["response"]["docs"]]
    except Exception: return None, None
    for ident in ids:
        meta = fetch(f"https://archive.org/metadata/{ident}")
        if not meta: continue
        try: files = json.loads(meta)["files"]
        except Exception: continue
        txts = [f for f in files if f["name"].endswith("_djvu.txt")]
        if not txts:
            txts = [f for f in files if f["name"].endswith(".txt") and "meta" not in f["name"]]
        if not txts: continue
        name = max(txts, key=lambda f: int(f.get("size", 0)))["name"]
        t = fetch(f"https://archive.org/download/{ident}/{name}")
        if t and len(t) > 20000: return t, f"IA {ident}/{name}"
    return None, None

def get(slug, pg_query, title_hint, ia_query):
    t, origin = (None, None)
    if pg_query: t, origin = pg_get(pg_query, title_hint)
    if not t and ia_query: t, origin = ia_get(ia_query)
    if t:
        (OUT / f"{slug}.txt").write_text(t)
        LOG.append({"slug": slug, "status": "ok", "origin": origin, "chars": len(t)})
        print(f"OK   {slug} <- {origin} ({len(t)} ch)", flush=True)
    else:
        LOG.append({"slug": slug, "status": "pending"})
        print(f"PEND {slug}", flush=True)

get("kempis-imitation-of-christ", "Imitation of Christ Kempis", "Imitation of Christ", 'title:(imitation of christ) AND date:[1500 TO 1928]')
get("brother-lawrence-practice", "Practice of the Presence of God", "Practice of the Presence", 'title:(practice of the presence of god) AND date:[1600 TO 1928]')
get("john-of-the-cross-dark-night", "Dark Night of the Soul", "Dark Night", 'title:(dark night of the soul) AND date:[1800 TO 1928]')
get("teresa-interior-castle", "Interior Castle Teresa", "Interior Castle", 'title:(interior castle) AND date:[1800 TO 1928]')
get("julian-revelations", "Revelations of Divine Love Julian", "Revelations of Divine Love", 'title:(revelations of divine love) AND date:[1800 TO 1928]')
get("pascal-pensees", "Pensees Pascal", "Pensées", 'title:(pensees) AND creator:(pascal)')
get("ignatius-spiritual-exercises", "Spiritual Exercises Loyola", "Spiritual Exercises", 'title:(spiritual exercises) AND creator:(ignatius)')
get("bunyan-pilgrims-progress", "Pilgrim's Progress Bunyan", "Pilgrim's Progress", 'title:(pilgrims progress) AND creator:(bunyan)')
get("herbert-the-temple", "The Temple Herbert poems", "Temple", 'title:(the temple) AND creator:(herbert, george)')
get("cassian-conferences", None, "", 'title:(conferences) AND creator:(cassian)')
get("origen-first-principles-ia", None, "", 'title:(first principles) AND creator:(origen)')

(OUT / "rescue-log.json").write_text(json.dumps(LOG, indent=1))
ok = sum(1 for e in LOG if e["status"] == "ok")
print(f"rescue v2: {ok} ok, {len(LOG)-ok} pending of {len(LOG)}")
