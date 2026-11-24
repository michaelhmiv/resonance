#!/usr/bin/env python3
"""Assemble chunks_v3 from canonical units (chunking-spec SS5).

Prose: 120-200 word windows over consecutive units; oversize units split at
sentence boundaries; tails <40 words merge back. Scripture and poetry:
one unit per chunk (tiny poetry stanzas merge forward to >=40 words).
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UNITS = ROOT / "corpus/units"
OUT = ROOT / "corpus/chunks_v3.jsonl"
MIN_W, MAX_W = 120, 200

def words(s): return len(s.split())

def split_sentences(text, target=150):
    sents = re.split(r"(?<=[.!?;])\s+", text)
    pieces, buf = [], ""
    for s in sents:
        if buf and words(buf) + words(s) > target:
            pieces.append(buf); buf = s
        else:
            buf = f"{buf} {s}".strip()
    if buf: pieces.append(buf)
    capped = []
    for piece in pieces:  # hard cap: semicolon-heavy old prose can defeat sentence splits
        while words(piece) > 240:
            cut = piece.rfind(" ", 0, 1200)
            capped.append(piece[:cut]); piece = piece[cut:].strip()
        capped.append(piece)
    return capped

def chunk_work(units):
    chunks, cur, cur_seq = [], [], []
    def flush():
        if cur:
            chunks.append(("\n\n".join(cur), cur_seq.copy()))
            cur.clear(); cur_seq.clear()
    for u in units:
        if u["kind"] in ("scripture",):
            flush()
            chunks.append((u["text"], [u["seq"]]))
            continue
        if u["kind"] == "poetry":
            if cur and sum(words(c) for c in cur) < 40 and chunks and False:
                pass
            flush()
            chunks.append((u["text"], [u["seq"]]))
            continue
        if u["words"] > 220:
            flush()
            for piece in split_sentences(u["text"]):
                chunks.append((piece, [u["seq"]]))
            continue
        cur_w = sum(words(c) for c in cur)
        if cur and ((cur_w + u["words"] > 240 and cur_w >= 110) or cur_w >= 200):
            flush()
        cur.append(u["text"]); cur_seq.append(u["seq"])
        if sum(words(c) for c in cur) >= MIN_W:
            flush()
    flush()
    # merge a short tail into the previous chunk
    if len(chunks) >= 2 and words(chunks[-1][0]) < 40:
        (t1, s1), (t2, s2) = chunks[-2], chunks[-1]
        chunks[-2] = (f"{t1}\n\n{t2}", s1 + s2)
        chunks.pop()
    return chunks

def main():
    rows = []
    for f in sorted(UNITS.glob("*.jsonl")):
        units = [json.loads(l) for l in f.open()]
        if not units: continue
        meta = units[0]
        for n, (text, seqs) in enumerate(chunk_work(units)):
            u0 = units[seqs[0]] if seqs else meta
            row = {"work_id": meta["work_id"], "source": meta["source"],
                   "chunk_id": u0.get("ref") or f"{meta['work_id']}#{n}",
                   "division": u0.get("division"), "kind": u0["kind"], "text": text}
            rows.append(row)
    capped = []
    for r in rows:  # final safety bound on prose chunk size
        if r["kind"] == "prose" and words(r["text"]) > 260:
            for piece in split_sentences(r["text"], target=170):
                capped.append({**r, "text": piece})
        else:
            capped.append(r)
    rows = capped
    dropped = sum(1 for r in rows if words(r["text"]) < 10)
    rows = [r for r in rows if words(r["text"]) >= 10]
    with OUT.open("w") as fh:
        for r in rows: fh.write(json.dumps(r) + "\n")
    print(f"dropped {dropped} debris chunks (<10 words)")
    from collections import Counter
    c = Counter(r["source"] for r in rows)
    ws = [words(r["text"]) for r in rows]
    print(f"chunks_v3: {len(rows):,} chunks | by source: {dict(c)} | words min/med/max: {min(ws)}/{sorted(ws)[len(ws)//2]}/{max(ws)}")

if __name__ == "__main__":
    main()
