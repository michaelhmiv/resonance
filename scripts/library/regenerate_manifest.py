#!/usr/bin/env python3
"""
Regenerate manifest.json (with passage_ids) from an existing re-embed run.

Use this after adding passage_ids tracking to the re-embed script, to avoid
re-billing OpenRouter just to update the manifest.

Reads:
  - state.json: ordered list of books_done (in processing order)
  - vectors.bin: row-major int8 vectors, dim 2560
  - /api/library/passages: per-book passages (in same order as script processed them,
    after front-matter filter)

Writes:
  - manifest.json with the new passage_ids[] field populated
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.parse
from pathlib import Path

DIM = 2560
PATTERNS = [
    "PUBLISHING COMPANY", "GRAND RAPIDS", "WM. B. EERDMANS",
    "PRINTED IN THE", "ALL RIGHTS RESERVED", "COPYRIGHT", "ISBN",
    "FIRST EDITION", "TABLE OF CONTENTS", "PREFACE", "TRANSLATOR'S NOTE",
    "TRANSLATOR’S NOTE", "EDITOR'S PREFACE", "INTRODUCTION\n",
]


def is_front_matter(text: str) -> bool:
    t = text.strip()
    if len(t) < 80:
        return True
    upper = t.upper()
    return any(pat in upper for pat in PATTERNS)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--prod-url", default=os.environ.get("PROD_URL", "https://resonance-production-fce2.up.railway.app"))
    p.add_argument("--auth-cookie", default=os.environ.get("RESONANCE_AUTH_COOKIE"))
    p.add_argument("--state-dir", default=str(Path(__file__).parent / ".reembed"))
    p.add_argument("--model", default="pplx-embed-v1-4b")
    p.add_argument("--admin-token", default=os.environ.get("ADMIN_UPLOAD_TOKEN"))
    args = p.parse_args()

    state_dir = Path(args.state_dir)
    state_path = state_dir / "state.json"
    vectors_path = state_dir / "vectors.bin"
    manifest_path = state_dir / "manifest.json"

    state = json.loads(state_path.read_text())
    books_done = state["books_done"]
    print(f"[state] {len(books_done)} books done")

    # Sanity check: vectors.bin size should be N * DIM
    total = vectors_path.stat().st_size
    assert total % DIM == 0, f"vectors.bin size {total} not divisible by {DIM}"
    expected = state["passages_embedded"] * DIM
    if total != expected:
        print(f"  WARN: vectors.bin is {total} bytes, expected {expected} (off by {abs(total - expected)} bytes)")
    n_vecs = total // DIM
    print(f"[vectors] {n_vecs} vectors of {DIM}d int8 ({total / 1024 / 1024:.1f} MB)")

    # Re-walk books in the same order, collect passage IDs.
    # We cap at n_vecs (the actual vector count in the file) to handle the
    # case where state.json's passages_embedded drifts slightly from the
    # actual write count (e.g. dim mismatches that don't get logged).
    passage_ids: list[int] = []
    book_counts: dict[str, int] = {}
    target = n_vecs
    for i, book_id in enumerate(books_done, 1):
        if len(passage_ids) >= target:
            print(f"  [{i}/{len(books_done)}] reached {target} passage IDs, stopping early")
            break
        url = f"{args.prod_url}/api/library/passages?bookId={urllib.parse.quote(book_id)}"
        req = urllib.request.Request(url, headers={"Cookie": f"resonance-auth={args.auth_cookie}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
        passages = data.get("passages", [])
        kept = [p for p in passages if not is_front_matter(p["text"])]
        added = 0
        for p in kept:
            if len(passage_ids) >= target:
                break
            passage_ids.append(p["id"])
            added += 1
        book_counts[book_id] = added
        if i % 10 == 0:
            print(f"  [{i}/{len(books_done)}] walked, total passages so far: {len(passage_ids)}")

    print(f"\n[passage_ids] {len(passage_ids)} collected")
    if len(passage_ids) != n_vecs:
        sys.exit(f"MISMATCH: {len(passage_ids)} passage IDs but {n_vecs} vectors — aborting")

    # Read existing manifest (to preserve other fields)
    existing = json.loads(manifest_path.read_text())

    manifest = {
        **existing,
        "passage_ids": passage_ids,
        "passage_count": len(passage_ids),
        "shards": [{"file": "vectors.bin", "start": 0, "count": len(passage_ids)}],
        "manifest_regenerated_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime()),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"\n[manifest] wrote {manifest_path} with passage_ids[]")

    if not args.admin_token:
        print("[skip-upload] no admin token; upload manually via the reembed script's chunked upload")
        return

    # Upload new manifest
    print(f"\n[uploading manifest] /data/vectors/{args.model}/manifest.json")
    body = manifest_path.read_bytes()
    req = urllib.request.Request(
        f"{args.prod_url}/api/admin/upload-file",
        data=body, method="POST",
        headers={
            "X-Admin-Token": args.admin_token,
            "X-Path": f"vectors/{args.model}/manifest.json",
            "X-Chunk-Index": "0",
            "X-Total-Chunks": "1",
            "Content-Type": "application/octet-stream",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        result = json.loads(r.read())
    print(f"  {result}")


if __name__ == "__main__":
    main()
