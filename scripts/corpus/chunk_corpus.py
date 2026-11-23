#!/usr/bin/env python3
"""Chunk staging_v3 texts into passages for embedding + DB load.

Paragraph-aware: split on blank lines, pack paragraphs into ~120-200 word
chunks, hard-split oversized paragraphs on sentence boundaries. Emits
corpus/chunks_v1.jsonl with {work_id, source, chunk_id, text} and a summary.
Work id = the staged file's stem; source = its staging subfolder.
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / "corpus/staging_v4_clean"
OUT = ROOT / "corpus/chunks_v2.jsonl"
MIN_W, MAX_W = 40, 200

def words(s): return len(s.split())

def chunk_text(text: str) -> list[str]:
    text = re.sub(r"\r\n?", "\n", text)
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if words(p.strip()) >= 3]
    chunks, cur = [], ""
    for p in paras:
        if words(p) > MAX_W:  # hard-split long paragraphs by sentences
            if cur: chunks.append(cur); cur = ""
            sents = re.split(r"(?<=[.!?])\s+", p)
            buf = ""
            for s in sents:
                if words(buf) + words(s) > MAX_W and buf: chunks.append(buf); buf = s
                else: buf = f"{buf} {s}".strip()
            if buf: chunks.append(buf)
            continue
        if words(cur) + words(p) > MAX_W and words(cur) >= MIN_W:
            chunks.append(cur); cur = p
        else:
            cur = f"{cur}\n\n{p}".strip() if cur else p
    if cur and words(cur) >= 8: chunks.append(cur)
    return [c for c in chunks if words(c) >= 8]

def main():
    total, per_source = 0, {}
    with OUT.open("w") as f:
        for sub in ["ccel", "ia", "gutenberg", "additions", "rescue"]:
            d = STAGING / sub
            if not d.exists(): continue
            for path in sorted(d.glob("*.txt")):
                chunks = chunk_text(path.read_text(errors="replace"))
                for i, c in enumerate(chunks):
                    f.write(json.dumps({"work_id": path.stem, "source": sub,
                                        "chunk_id": i, "text": c}) + "\n")
                per_source[path.stem] = len(chunks); total += len(chunks)
    print(f"works: {len(per_source)}  chunks: {total}")
    small = {k: v for k, v in per_source.items() if v < 3}
    print("works with <3 chunks:", small if small else "none")

if __name__ == "__main__":
    main()
