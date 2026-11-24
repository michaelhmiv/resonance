#!/usr/bin/env python3
"""Append WEB Bible verses (verse = natural unit) to corpus/chunks_v2.jsonl."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
d = json.loads((ROOT / "corpus/bible/web.json").read_text())
n = 0
with open(ROOT / "corpus/chunks_v2.jsonl", "a") as f:
    for v in d["verses"]:
        txt = (v.get("text") or "").strip()
        if len(txt.split()) >= 4:
            ref = f"{v.get('book_name','')} {v.get('chapter')}:{v.get('verse')}".strip()
            f.write(json.dumps({"work_id": "bible-web", "source": "bible",
                                "chunk_id": ref, "text": txt}) + "\n"); n += 1
print(f"WEB verses appended: {n:,}")
