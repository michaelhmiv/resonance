#!/usr/bin/env python3
"""Health audit of staging_v3 texts before cleaning/embedding.

Flags per file: stubs (tiny), Gutenberg/CCEL boilerplate present, OCR-garbage
ratio (symbol soup), page-number line density, ALL-CAPS header runs.
Writes corpus/staging_v3/meta/audit.json and prints the worst offenders.
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / "corpus/staging_v3"
CHUNKS = {}
for line in (ROOT / "corpus/chunks_v1.jsonl").open():
    d = json.loads(line)
    CHUNKS[d["work_id"]] = CHUNKS.get(d["work_id"], 0) + 1

def audit(path: Path) -> dict:
    t = path.read_text(errors="replace")
    words = len(t.split())
    lines = t.splitlines()
    nonempty = [l for l in lines if l.strip()]
    letters = sum(c.isalpha() for c in t)
    symbols = sum(1 for c in t if not c.isalnum() and not c.isspace())
    pgnum = sum(1 for l in nonempty if re.fullmatch(r"\s*\d{1,4}\s*", l))
    flags = []
    if words < 400: flags.append("STUB")
    if "end of the project gutenberg" in t.lower() or "*** end of" in t.lower(): flags.append("PG_BOILERPLATE")
    if "ccel" in t[:2000].lower() and "christian classics ethereal library" in t[:4000].lower(): flags.append("CCEL_HEADER")
    if letters and symbols / max(letters, 1) > 0.06: flags.append("SYMBOL_SOUP")
    if nonempty and pgnum / len(nonempty) > 0.02: flags.append("PAGE_NUMBERS")
    if re.search(r"(?m)^[IVXLC]{1,6}\.\s*$", t) and t.count("CONTENTS") > 2: flags.append("TOC_HEAVY")
    return {"file": str(path.relative_to(STAGING)), "words": words,
            "chunks": CHUNKS.get(path.stem, 0), "flags": flags}

rows = []
for sub in ["ccel", "ia", "gutenberg", "additions"]:
    d = STAGING / sub
    if d.exists():
        rows += [audit(p) for p in sorted(d.glob("*.txt"))]
flagged = [r for r in rows if r["flags"]]
from collections import Counter
print(f"files: {len(rows)}  flagged: {len(flagged)}  flag counts: {dict(Counter(f for r in flagged for f in r['flags']))}")
print("stubs:", sum(1 for r in rows if 'STUB' in r['flags']), "| smallest real works:")
for r in sorted((r for r in rows if 'STUB' not in r['flags']), key=lambda r: r['words'])[:5]:
    print(f"  {r['words']:>7}w {r['chunks']:>4}ch {r['file']} {r['flags']}")
(STAGING / "meta/audit.json").write_text(json.dumps(rows, indent=1))
print("audit -> corpus/staging_v3/meta/audit.json")
