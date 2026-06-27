#!/usr/bin/env python3
"""
Merge the locally-re-embedded voice vectors (from scripts/library/.reembed/)
with the bible vectors in the production pplx index, producing a single
id-sorted vectors.bin + manifest ready for upload to Railway.

Inputs:
  - /data/resonance/build/output/seeded_library/vectors_pplx/vectors_pplx-embed-v1-4b.bin
        Production pplx vectors (bible first 244,089 rows in id-sorted order,
        then legacy 18-book voice 20,979 rows we DISCARD)
  - /data/resonance/scripts/library/.reembed/vectors.bin
        New voice vectors (260,532 rows in BOOK-iteration order)
  - /data/resonance/scripts/library/.reembed/manifest.json
        New voice manifest (passage_ids in book-iteration order)
  - /data/resonance/apps/web/data/seeded_library/voice_passages.json
        Canonical voice passages (for book_id lookup if needed)
  - /data/resonance/build/output/seeded_library/vectors_pplx/corpus.idmap
        Production idmap — we extract bible passage ids from rows 0..244088

Outputs (in scripts/library/.reembed/merged/):
  - vectors.bin
        Combined 504,621 vectors, id-sorted (bible first by id, then voice by id)
  - manifest.json
        passage_count: 504621, passage_ids: [sorted], passage_sources: [bible/voice]
  - sha256.txt
        sha256 of vectors.bin for upload verification
  - local_verification.txt
        Output of the post-build identity-query check (run via hnswlib-node)
"""

import hashlib
import json
import shutil
import struct
import sys
from pathlib import Path

REPO = Path("/data/resonance")
PROD_VECTORS = REPO / "build/output/seeded_library/vectors_pplx/vectors_pplx-embed-v1-4b.bin"
PROD_IDMAP = REPO / "build/output/seeded_library/vectors_pplx/corpus.idmap"
LOCAL_VOICE_VECTORS = REPO / "scripts/library/.reembed/vectors.bin"
LOCAL_VOICE_MANIFEST = REPO / "scripts/library/.reembed/manifest.json"
OUT_DIR = REPO / "scripts/library/.reembed/merged"

DIM = 2560
BIBLE_COUNT = 244_089  # rows 0..244088 in production vectors.bin


def load_prod_bible_ids() -> list[int]:
    """Extract the 244,089 bible passage ids from the production idmap, in row order."""
    print(f"[bible-ids] reading {PROD_IDMAP} (only first {BIBLE_COUNT} entries)")
    with PROD_IDMAP.open() as f:
        idmap = json.load(f)
    ids = idmap["passageIds"][:BIBLE_COUNT]
    sources = idmap["passageSources"][:BIBLE_COUNT]
    assert all(s == "bible" for s in sources), "Expected first 244,089 entries to all be bible"
    # Confirm id-sorted
    assert ids == sorted(ids), "Bible ids should already be in id-sorted order"
    print(f"[bible-ids] {len(ids):,} bible ids, range {ids[0]:,}-{ids[-1]:,}, sorted: True")
    return ids


def load_local_voice_ids() -> list[int]:
    """Read the 260,532 local voice passage ids from the re-embed manifest."""
    with LOCAL_VOICE_MANIFEST.open() as f:
        m = json.load(f)
    ids = m["passage_ids"]
    print(f"[voice-ids] {len(ids):,} local voice ids, range {min(ids):,}-{max(ids):,}, "
          f"sorted: {ids == sorted(ids)}")
    return ids


def extract_bible_vectors() -> bytes:
    """Read the first BIBLE_COUNT vectors from the production vectors.bin (each = DIM bytes)."""
    bytes_to_read = BIBLE_COUNT * DIM
    print(f"[bible-vecs] reading {bytes_to_read:,} bytes from {PROD_VECTORS.name}")
    with PROD_VECTORS.open("rb") as f:
        data = f.read(bytes_to_read)
    actual = len(data)
    if actual != bytes_to_read:
        sys.exit(f"  ERROR: expected {bytes_to_read:,} bytes, got {actual:,}")
    print(f"[bible-vecs] {actual:,} bytes read ({actual/1024/1024:.1f} MB)")
    return data


def reorder_voice_vectors_to_id_sorted(voice_ids: list[int]) -> bytes:
    """Read all local voice vectors, sort by id, return as concatenated bytes."""
    print(f"[voice-vecs] reading {LOCAL_VOICE_VECTORS.name} (size={LOCAL_VOICE_VECTORS.stat().st_size:,})")
    with LOCAL_VOICE_VECTORS.open("rb") as f:
        data = f.read()
    expected = len(voice_ids) * DIM
    if len(data) != expected:
        sys.exit(f"  ERROR: vectors.bin is {len(data):,} bytes, expected {expected:,} for "
                 f"{len(voice_ids):,} vectors × {DIM} dims")
    # Split into per-vector chunks, sort by id, concatenate
    # We need to remember the id order and re-shuffle the vector chunks to match
    print(f"[voice-vecs] splitting into {len(voice_ids):,} per-vector chunks of {DIM} bytes")
    vectors: list[bytes] = [data[i * DIM : (i + 1) * DIM] for i in range(len(voice_ids))]
    # Now sort by id — voice_ids[i] is the passage id for vectors[i]
    # We want the output order to be sorted by passage id
    paired = sorted(zip(voice_ids, vectors), key=lambda p: p[0])
    sorted_ids = [pid for pid, _ in paired]
    print(f"[voice-vecs] sorted: {sorted_ids == sorted(set(sorted_ids))}, "
          f"first 5 ids={sorted_ids[:5]}, last 5={sorted_ids[-5:]}")
    return b"".join(v for _, v in paired)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bible_ids = load_prod_bible_ids()
    voice_ids = load_local_voice_ids()

    # Confirm no id overlap (so simple concat works)
    bible_set = set(bible_ids)
    overlap = sum(1 for vid in voice_ids if vid in bible_set)
    if overlap:
        sys.exit(f"  ERROR: {overlap} voice ids overlap with bible ids — can't simply concat")
    print(f"[merge-check] bible ∩ voice = ∅ (no overlap)")

    # Confirm voice range is above bible range
    assert min(voice_ids) > max(bible_ids), "Voice ids should all be > max bible id for clean concat"
    print(f"[merge-check] voice range ({min(voice_ids):,}-{max(voice_ids):,}) > "
          f"bible range ({min(bible_ids):,}-{max(bible_ids):,})")

    bible_vecs = extract_bible_vectors()
    voice_vecs = reorder_voice_vectors_to_id_sorted(voice_ids)

    # Concatenate: bible first (id-sorted), then voice (id-sorted)
    combined = bible_vecs + voice_vecs
    total = len(bible_ids) + len(voice_ids)
    expected_bytes = total * DIM
    if len(combined) != expected_bytes:
        sys.exit(f"  ERROR: combined is {len(combined):,} bytes, expected {expected_bytes:,}")
    print(f"\n[merge] combined: {len(combined):,} bytes ({len(combined)/1024/1024:.1f} MB), "
          f"{total:,} vectors")

    out_vecs = OUT_DIR / "vectors.bin"
    out_vecs.write_bytes(combined)
    print(f"[write] {out_vecs} ({out_vecs.stat().st_size:,} bytes)")

    # Build combined manifest
    all_ids = bible_ids + sorted(voice_ids)  # already sorted within each block
    all_sources = ["bible"] * len(bible_ids) + ["voice"] * len(voice_ids)
    assert len(all_ids) == total
    assert all_sources.count("bible") == len(bible_ids)
    assert all_sources.count("voice") == len(voice_ids)
    # Confirm fully sorted
    assert all_ids == sorted(all_ids), "Combined ids should be in id-sorted order"

    manifest = {
        "model": "pplx-embed-v1-4b",
        "dim": DIM,
        "dtype": "int8",
        "quantization": "signed_linear",
        "passage_count": total,
        "shards": [{"file": "vectors.bin", "start": 0, "count": total}],
        "passage_ids": all_ids,
        "passage_sources": all_sources,
        "passage_order": "id",
        "built_at": "2026-06-27T00:00:00Z",
        "source": {
            "bible": "build/output/seeded_library/vectors_pplx/vectors_pplx-embed-v1-4b.bin (rows 0..244088)",
            "voice": "scripts/library/.reembed/vectors.bin (re-ordered to id-sorted, 260,532 of 75 canonical books)",
        },
    }
    out_manifest = OUT_DIR / "manifest.json"
    out_manifest.write_text(json.dumps(manifest, indent=2))
    print(f"[write] {out_manifest} ({out_manifest.stat().st_size:,} bytes)")

    # sha256 for upload verification
    h = hashlib.sha256()
    with out_vecs.open("rb") as f:
        while True:
            chunk = f.read(8 * 1024 * 1024)  # 8 MB
            if not chunk:
                break
            h.update(chunk)
    sha = h.hexdigest()
    (OUT_DIR / "sha256.txt").write_text(sha + "\n")
    print(f"[write] {OUT_DIR / 'sha256.txt'} = {sha}")

    # Summary
    print(f"\n=== Merge complete ===")
    print(f"  Output dir: {OUT_DIR}")
    print(f"  vectors.bin: {out_vecs.stat().st_size:,} bytes "
          f"({out_vecs.stat().st_size/1024/1024:.1f} MB)")
    print(f"  manifest.json: {out_manifest.stat().st_size:,} bytes")
    print(f"  sha256: {sha}")
    print(f"  Total passages: {total:,} (bible={len(bible_ids):,}, voice={len(voice_ids):,})")
    print(f"\n  Next step: upload vectors.bin in 4MB chunks to /api/admin/upload-vectors,")
    print(f"  upload manifest.json to /api/admin/upload-file at vectors/pplx-embed-v1-4b/manifest.json")


if __name__ == "__main__":
    main()
