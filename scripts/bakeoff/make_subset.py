"""Stratified subset of the bake-off pool for a fast judgment run:
every author work and every Bible book represented, evenly spaced picks."""
import json, random
from collections import defaultdict
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
pool = [json.loads(l) for l in (ROOT / "corpus/chunks_v3.jsonl").open()]
rng = random.Random(42)
def spaced(items, k):
    if len(items) <= k: return items
    step = len(items) / k
    return [items[int(i * step)] for i in range(k)]
by_work = defaultdict(list)
for p in pool: by_work[p["work_id"]].append(p)
subset = []
for wid, items in sorted(by_work.items()):
    if wid == "web":
        by_book = defaultdict(list)
        import re as _re
        for p in items: by_book[_re.match(r"(.+?) \d+:\d+", p["chunk_id"]).group(1)].append(p)
        for book, verses in sorted(by_book.items()):
            subset += spaced(verses, max(10, round(2400 * len(verses) / len(items))))
    else:
        subset += spaced(items, 55)
rng.shuffle(subset)
out = ROOT / "corpus/chunks_subset.jsonl"
with out.open("w") as f:
    for p in subset: f.write(json.dumps(p) + "\n")
works = len({p['work_id'] for p in subset})
print(f"subset: {len(subset):,} passages across {works} works/books-groups")
