#!/usr/bin/env python3
"""Build canonical units (chunking-spec SS2-SS4) from the cleaned corpus.

Authors: corpus/staging_v4_clean/<source>/*.txt -> corpus/units/<work_id>.jsonl
Bible:   corpus/bible/web.json -> verse-group units in corpus/units/web.jsonl

Cleaning: furniture strip, de-hyphenation, corpus-vocabulary long-s repair,
heading->division capture, paragraph/stanza unit splitting, quality gates
(quarantine logged to corpus/units/meta-log.json, never deleted silently).
"""
import json, re, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / "corpus/staging_v4_clean"
OUT = ROOT / "corpus/units"
SOURCES = ["ccel", "ia", "gutenberg", "additions", "rescue"]
TOKEN = re.compile(r"[A-Za-z']+")

def words(s): return len(s.split())

# ---------- vocabulary + long-s repair ----------
def build_vocab() -> Counter:
    vocab = Counter()
    for src in SOURCES:
        d = STAGING / src
        if not d.exists(): continue
        for f in sorted(d.glob("*.txt")):
            vocab.update(t.lower() for t in TOKEN.findall(f.read_text(errors="replace")))
    return vocab

def longs_repair(text: str, vocab: Counter) -> tuple[str, int]:
    fixes = 0
    def repl(m):
        nonlocal fixes
        tok = m.group(0)
        low = tok.lower()
        if len(low) < 3 or "f" not in low:
            return tok
        # Systematic OCR errors are themselves frequent, so judge by ratio:
        # repair only when the s-variant is common AND >=20x the f-form.
        best, best_n = None, max(199, 20 * vocab[low])
        cands = {low[:i] + "s" + low[i + 1:] for i, ch in enumerate(low) if ch == "f"}
        cands.add(low.replace("f", "s"))  # double long-s: "fweetnefs" -> "sweetness"
        for cand in cands:
            if vocab[cand] > best_n:
                best, best_n = cand, vocab[cand]
        if best is None: return tok
        fixes += 1
        return best.capitalize() if tok[:1].isupper() else best
    return TOKEN.sub(repl, text), fixes

# ---------- unit splitting ----------
HEAD_RE = re.compile(r"^(CHAPTER|BOOK|PART|SERMON|LETTER|PSALM|SECTION|DISCOURSE|HOMILY)\b", re.I)
def is_heading(p: str) -> bool:
    p = p.strip()
    if not p or len(p) > 70 or words(p) > 9: return False
    if p[-1] in ".!?;:," : return False
    if HEAD_RE.match(p): return True
    letters = [c for c in p if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.8: return True
    if p == p.title() and words(p) >= 2: return True
    return False

INDEX_LINE_RE = re.compile(r"(?:,\s*|\s+)\d{1,4}\.?$")
def is_furniture(p: str) -> bool:
    s = p.strip()
    if re.fullmatch(r"(page\s+)?\d{1,4}", s, re.I): return True
    if s and sum(c.isdigit() or not c.isalnum() for c in s) / len(s) > 0.6 and words(s) < 6: return True
    lines = [l.strip() for l in s.split("\n") if l.strip()]
    if len(lines) >= 4 and sum(1 for l in lines if INDEX_LINE_RE.search(l)) / len(lines) >= 0.6:
        return True
    return False

def split_units(text: str):
    """Yield (division, kind, text) units from a cleaned work text."""
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"([a-z])-\n([a-z])", r"\1\2", text)          # de-hyphenate
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text)]
    from collections import Counter as _C
    _freq = _C(" ".join(b.split()).lower() for b in blocks)
    def _running_head(b):
        s = " ".join(b.split())
        letters = [c for c in s if c.isalpha()]
        return (words(s) <= 10 and letters and
                sum(c.isupper() for c in letters) / len(letters) > 0.75 and
                (_freq[s.lower()] >= 3 or any(c.isdigit() for c in s)))
    blocks = [re.sub(r"^\d{1,4}\s+(?=[A-Z])", "", b) if _running_head(b) else b for b in blocks]
    blocks = [b for b in blocks if not _running_head(b)]
    division, pending = None, ""
    for b in blocks:
        if not b or is_furniture(b): continue
        if is_heading(b):
            if pending: yield division, "prose", pending; pending = ""
            division = " ".join(b.split()); continue
        lines = [l for l in b.split("\n") if l.strip()]
        kind = "prose"
        if len(lines) >= 4 and sum(words(l) for l in lines) / len(lines) < 8:
            kind = "poetry"
            unit = "\n".join(" ".join(l.split()) for l in lines)
        else:
            unit = " ".join(" ".join(l.split()) for l in lines)
        if kind == "prose" and words(unit) < 12:
            pending = f"{pending} {unit}".strip(); continue
        if pending:
            unit = f"{pending} {unit}".strip() if kind == "prose" else unit
            if kind == "prose": pending = ""
            else: yield division, "prose", pending; pending = ""
        yield division, kind, unit
    if pending: yield division, "prose", pending

def gates(text: str, vocab: Counter) -> str | None:
    if not text: return "empty"
    sym = sum(1 for c in text if not c.isalnum() and not c.isspace() and c not in ".,;:!?()'\"-—–") / max(len(text), 1)
    if sym > 0.05: return f"symbol-ratio {sym:.2f}"
    toks = [t.lower() for t in TOKEN.findall(text)]
    if toks:
        known = sum(1 for t in toks if vocab[t] >= 5) / len(toks)
        if known < 0.6: return f"known-word {known:.2f}"
    return None

# ---------- bible verse groups ----------
def bible_units():
    data = json.loads((ROOT / "corpus/bible/web.json").read_text())
    verses = data["verses"]
    units, i = [], 0
    while i < len(verses):
        book, ch = verses[i]["book_name"], verses[i]["chapter"]
        group = []
        while i < len(verses) and verses[i]["book_name"] == book and verses[i]["chapter"] == ch and len(group) < 5:
            group.append(verses[i]); i += 1
        if len(group) < 3 and units and units[-1]["division"] == book and units[-1]["_ch"] == ch:
            prev = units[-1]
            allv = prev["_verses"] + group
            prev["_verses"] = allv
            prev["text"] = " ".join(v["text"] for v in allv)
            prev["words"] = words(prev["text"])
            prev["_ref"] = f"{book} {ch}:{allv[0]['verse']}-{allv[-1]['verse']}"
            continue
        units.append({"division": book, "_ch": ch, "_verses": group,
                      "text": " ".join(v["text"] for v in group),
                      "_ref": f"{book} {ch}:{group[0]['verse']}" + (f"-{group[-1]['verse']}" if len(group) > 1 else "")})
    for u in units:
        u["words"] = words(u["text"])
    return units

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    vocab = build_vocab()
    log = {"works": {}, "quarantine": [], "longs_fixes": 0}
    total_units = 0
    for src in SOURCES:
        d = STAGING / src
        if not d.exists(): continue
        for f in sorted(d.glob("*.txt")):
            wid = f.stem
            raw = f.read_text(errors="replace")
            fixed, nfix = longs_repair(raw, vocab)
            log["longs_fixes"] += nfix
            units, quar = [], 0
            for division, kind, text in split_units(fixed):
                why = gates(text, vocab)
                if why:
                    quar += 1
                    if len(log["quarantine"]) < 40: log["quarantine"].append({"work": wid, "why": why, "text": text[:80]})
                    continue
                units.append({"work_id": wid, "author": None, "source": src,
                              "division": division, "kind": kind, "seq": len(units),
                              "text": text, "words": words(text)})
            with (OUT / f"{wid}.jsonl").open("w") as fh:
                for u in units: fh.write(json.dumps(u) + "\n")
            log["works"][wid] = {"units": len(units), "quarantined": quar}
            total_units += len(units)
    bu = bible_units()
    with (OUT / "web.jsonl").open("w") as fh:
        for n, u in enumerate(bu):
            fh.write(json.dumps({"work_id": "web", "author": None, "source": "bible",
                                 "division": u["division"], "kind": "scripture", "seq": n,
                                 "text": u["text"], "words": u["words"], "ref": u["_ref"]}) + "\n")
    log["works"]["web"] = {"units": len(bu), "quarantined": 0}
    total_units += len(bu)
    (OUT / "meta-log.json").write_text(json.dumps(log, indent=1))
    print(f"units: {total_units:,} across {len(log['works'])} works | long-s fixes: {log['longs_fixes']:,} | bible groups: {len(bu):,}")

if __name__ == "__main__":
    main()
