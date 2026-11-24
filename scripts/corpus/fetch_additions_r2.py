#!/usr/bin/env python3
"""Round 2 for the pending additions: alternate sources/queries."""
import json, subprocess, urllib.parse
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
from fetch_additions import fetch, ia_search, save, LOG, OUT

# Chrysostom Homilies on Acts/Romans -> NPNF XI from CCEL (same translation family)
t = fetch("https://ccel.org/ccel/schaff/npnf111/cache/npnf111.txt")
if t: save("additions", "chrysostom-homilies-acts-romans-npnf11", t, {"from": "ccel npnf111"})
else: LOG.append({"slug": "chrysostom-homilies-acts-romans-npnf11", "status": "pending", "reason": "ccel npnf111 failed"})

# Spurgeon Morning and Evening via IA
u = ia_search('title:(morning and evening) AND creator:(spurgeon)')
t = fetch(u) if u else None
if t: save("additions", "spurgeon-morning-and-evening", t, {"from": u})
else: LOG.append({"slug": "spurgeon-morning-and-evening", "status": "pending", "reason": "IA unresolved r2"})

# Eckhart sermons (Field) via IA, looser queries
for q in ['creator:(field, claud) AND title:(eckhart)', 'title:(eckhart) AND date:[1900 TO 1928]', 'creator:(eckhart) AND mediatype:(texts)']:
    u = ia_search(q)
    t = fetch(u) if u else None
    if t:
        save("additions", "eckhart-sermons-field-1909", t, {"from": u}); break
else:
    LOG.append({"slug": "eckhart-sermons-field-1909", "status": "pending", "reason": "IA unresolved r2"})

# Theologia Germanica via Gutendex -> pglaf mirror
raw = fetch("https://gutendex.com/books/?search=theologia%20germanica")
gid = None
if raw:
    try:
        for b in json.loads(raw)["results"]:
            if "theologia" in b["title"].lower():
                gid = b["id"]; break
    except Exception: pass
t = fetch(f"https://gutenberg.pglaf.org/cache/epub/{gid}/pg{gid}.txt") if gid else None
if t: save("additions", "theologia-germanica-winkworth", t, {"from": f"PG {gid} via pglaf"})
else: LOG.append({"slug": "theologia-germanica-winkworth", "status": "pending", "reason": "gutendex/pglaf unresolved"})

# Fenelon + Guyon via IA creator searches
for slug, q in [("fenelon-spiritual-letters", 'creator:(fenelon) AND date:[1600 TO 1928]'),
                ("guyon-method-of-prayer", 'creator:(guyon) AND date:[1600 TO 1928]'),
                ("desert-fathers-wisdom-hannay", 'creator:(hannay) AND title:(desert)')]:
    u = ia_search(q)
    t = fetch(u) if u else None
    if t: save("additions", slug, t, {"from": u})
    else: LOG.append({"slug": slug, "status": "pending", "reason": "IA unresolved r2"})

(OUT / "meta/additions-log-r2.json").write_text(json.dumps(LOG, indent=1))
ok = sum(1 for e in LOG if e["status"] == "ok")
print(f"round2: {ok} ok, {len(LOG)-ok} pending of {len(LOG)}")
