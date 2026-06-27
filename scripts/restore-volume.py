#!/usr/bin/env python3
"""
Restore the Railway volume data for Resonance.

Source of truth (as of 2026-06-27):
  - Voice / Bible *content* (JSON, ~245 MB total) lives in
    /data/resonance/apps/web/data/seeded_library/  (built 2026-06-25).
  - Vector index (HNSW + raw vectors.bin, ~3.4 GB) and small helpers
    (library_manifest.json, manifests/) live in
    /data/resonance/build/output/seeded_library/  (built 2026-06-26).

These are two different build pipelines. Before 2026-06-25 the content
also lived in build/output/, but the canonical content snapshot moved
to apps/web/data/ when the route files were repointed to read from there.
The script must point at the *current* location of each file, not assume
a single source directory.

Uploads the corpus + vector index to the Railway volume via the chunked
admin upload endpoints. Skips files that are already present on the
volume (or restores the whole thing with --force).

Usage:
  python3 restore-volume.py
  python3 restore-volume.py --force   # re-upload even if it looks present
  python3 restore-volume.py --token <ADMIN_UPLOAD_TOKEN> --url <RAILWAY_URL>

Token defaults to the one in /data/resonance/apps/web/.env.local.
URL defaults to the current prod (resonanceweb-production-276b).
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# Defaults
DEFAULT_TOKEN = "_HmP3b31UMpC1Hs0FptT_tpxB0H8j3VpW56zD4zdq7M"
DEFAULT_URL = "https://resonanceweb-production-276b.up.railway.app"

# Content source: voice_books.json, voice_passages.json, bible_books.json,
# bible_passages.json. This is the canonical 75-book / 201 MB snapshot built
# on 2026-06-25. The old build/output/ copy of these is the 18-book legacy
# snapshot from 2026-06-23 — DO NOT use it.
LOCAL_CONTENT = Path("/data/resonance/apps/web/data/seeded_library")

# Vector / manifest source: HNSW index (corpus.hnsw ~2.7 GB, corpus.idmap ~7 MB),
# raw vectors.bin (~678 MB), manifests/, library_manifest.json. Lives in the
# older build/output/ tree because the vector pipeline was last run there.
LOCAL_VECTORS = Path("/data/resonance/build/output/seeded_library")
LOCAL_VECTORS_BUILD = Path("/data/resonance/build/output")  # for vectors_gte-small.bin (legacy)
LOCAL_PACKAGES = Path("/data/resonance/build/output/packages")

# Mobile download pipeline artifacts (Phase 0, built 2026-06-27):
# 75 per-book voice shards + 1 scripture bundle. Total ~6.2 GB on volume.
LOCAL_SHARDS = LOCAL_VECTORS / "library_shards"
LOCAL_SCRIPTURE = LOCAL_VECTORS / "scripture_bundle"

# All files we want on the volume, in upload order.
# Vector index first (largest), then bible metadata, then voice metadata.
UPLOADS = [
    # (kind, local_path, remote_path, chunk_size_mb)
    # kind: "vectors" uses /api/admin/upload-vectors (X-Model, X-Filename)
    #       "file"    uses /api/admin/upload-file    (X-Path)
    # pplx vectors: model=pplx-embed-v1-4b, file=vectors.bin
    ("vectors", LOCAL_VECTORS / "vectors_pplx/vectors_pplx-embed-v1-4b.bin", "pplx-embed-v1-4b", "vectors.bin", 8),
    # pplx manifest
    ("file", LOCAL_VECTORS / "manifests/pplx-embed-v1-4b/manifest.json", "vectors/pplx-embed-v1-4b/manifest.json", 1),
    # gte-small manifest (legacy but the route code references it)
    ("file", LOCAL_VECTORS / "manifests/gte-small/manifest.json", "seeded_library/manifests/gte-small/manifest.json", 1),
    # bible + voice passage metadata — canonical snapshot from apps/web/data/
    ("file", LOCAL_CONTENT / "bible_passages.json", "seeded_library/bible_passages.json", 8),
    ("file", LOCAL_CONTENT / "voice_passages.json", "seeded_library/voice_passages.json", 8),
    # gte-small vectors (legacy file, but the route has logic for it)
    ("file", LOCAL_VECTORS_BUILD / "vectors_gte-small.bin", "seeded_library/vectors_gte-small.bin", 8),
    # Top-level helper files
    ("file", LOCAL_CONTENT / "bible_books.json", "seeded_library/bible_books.json", 1),
    ("file", LOCAL_CONTENT / "voice_books.json", "seeded_library/voice_books.json", 1),
    ("file", LOCAL_VECTORS / "library_manifest.json", "seeded_library/library_manifest.json", 1),
    # Mobile download pipeline — voice shards (auto-discovered)
    # and scripture bundle are added below by _add_pipeline_uploads().
]


def _add_pipeline_uploads():
    """Append entries for the 75 voice shards + scripture bundle to UPLOADS."""
    if (LOCAL_SHARDS / "manifest.json").exists():
        UPLOADS.append(("file", LOCAL_SHARDS / "manifest.json", "seeded_library/library_shards/manifest.json", 1))
    if LOCAL_SHARDS.is_dir():
        for book_dir in sorted(LOCAL_SHARDS.iterdir()):
            if not book_dir.is_dir():
                continue
            for filename in ("idmap.json", "vectors.bin", "corpus.hnsw"):
                p = book_dir / filename
                if p.exists():
                    chunk = 8 if filename != "idmap.json" else 1
                    UPLOADS.append((("file", p, f"seeded_library/library_shards/{book_dir.name}/{filename}", chunk)))
    if LOCAL_SCRIPTURE.is_dir():
        for p in sorted(LOCAL_SCRIPTURE.iterdir()):
            if p.is_file():
                chunk = 1 if p.suffix == ".json" else 8
                UPLOADS.append((("file", p, f"seeded_library/scripture_bundle/{p.name}", chunk)))


def curl_upload_chunk(url: str, token: str, file_bytes: bytes, headers: dict) -> dict:
    """Upload one chunk via curl, return parsed JSON."""
    # Write chunk to a temp file so curl can stream it without --data-binary issues
    import tempfile
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(file_bytes)
        tmp = f.name
    try:
        cmd = [
            "curl", "-s", "-X", "POST", url,
            "-H", f"X-Admin-Token: {token}",
            "-H", "Content-Type: application/octet-stream",
        ]
        for k, v in headers.items():
            cmd += ["-H", f"{k}: {v}"]
        cmd += ["--data-binary", f"@{tmp}"]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            return {"_raw": result.stdout, "_stderr": result.stderr, "_code": result.returncode}
    finally:
        os.unlink(tmp)


def upload_file(url: str, token: str, local: Path, remote: str, chunk_mb: int) -> bool:
    """Upload a single file in N MB chunks via /api/admin/upload-file."""
    if not local.exists():
        print(f"  ⚠️  {local.name} not found locally, skipping")
        return False
    size = local.stat().st_size
    chunk_size = chunk_mb * 1024 * 1024
    total = (size + chunk_size - 1) // chunk_size
    print(f"  📤 {remote} ({size/1024/1024:.1f} MB, {total} chunks)")
    with open(local, "rb") as f:
        for i in range(total):
            chunk = f.read(chunk_size)
            headers = {
                "X-Path": remote,
                "X-Chunk-Index": str(i),
                "X-Total-Chunks": str(total),
            }
            r = curl_upload_chunk(f"{url}/api/admin/upload-file", token, chunk, headers)
            if not r.get("ok"):
                print(f"    ❌ chunk {i}: {r}")
                return False
            if i == total - 1:
                print(f"    ✅ assembled: {r.get('path', remote)} ({r.get('size', size)} bytes)")
    return True


def upload_vectors(url: str, token: str, local: Path, model: str, filename: str, chunk_mb: int) -> bool:
    """Upload a vector file via /api/admin/upload-vectors."""
    if not local.exists():
        print(f"  ⚠️  {local.name} not found locally, skipping")
        return False
    size = local.stat().st_size
    chunk_size = chunk_mb * 1024 * 1024
    total = (size + chunk_size - 1) // chunk_size
    print(f"  📤 vectors/{model}/{filename} ({size/1024/1024:.1f} MB, {total} chunks)")
    with open(local, "rb") as f:
        for i in range(total):
            chunk = f.read(chunk_size)
            headers = {
                "X-Model": model,
                "X-Filename": filename,
                "X-Chunk-Index": str(i),
                "X-Total-Chunks": str(total),
            }
            r = curl_upload_chunk(f"{url}/api/admin/upload-vectors", token, chunk, headers)
            if not r.get("ok"):
                print(f"    ❌ chunk {i}: {r}")
                return False
            if i == total - 1:
                print(f"    ✅ assembled: {r.get('path')} ({r.get('size', size)} bytes)")
    return True


def check_status(url: str, token: str) -> dict:
    """Check what the volume already has."""
    import urllib.request
    req = urllib.request.Request(
        f"{url}/api/vectors/status",
        headers={}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", default=DEFAULT_TOKEN)
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--force", action="store_true", help="Re-upload even if it looks present")
    parser.add_argument("--only", help="Only upload files matching this substring (e.g. 'pplx' or 'bible_passages')")
    args = parser.parse_args()

    print(f"=== Restore Resonance volume data ===")
    print(f"  URL:   {args.url}")
    print(f"  Token: {args.token[:8]}…")
    print()
    print("Current volume state:")
    status = check_status(args.url, args.token)
    print(f"  vectors: {status}")
    print()

    # Auto-discover voice shards + scripture bundle on disk
    _add_pipeline_uploads()
    def _upload_remote_path(spec):
        # 4-tuple ("file", local, remote, chunk_mb) → spec[2] is remote
        # 5-tuple ("vectors", local, model, filename, chunk_mb) → filename is spec[3]
        return spec[2] if spec[0] == "file" else spec[3]
    n_shards = sum(1 for s in UPLOADS if "library_shards" in _upload_remote_path(s))
    n_bundle = sum(1 for s in UPLOADS if "scripture_bundle" in _upload_remote_path(s))
    print(f"  Upload queue: {len(UPLOADS)} entries (incl. {n_shards} shard files + {n_bundle} bundle files)")
    print()

    if not args.force and status.get("loaded"):
        print("✅ Vectors already loaded. Pass --force to re-upload.")
        return 0

    start = time.time()
    success = []
    failed = []
    for spec in UPLOADS:
        if args.only and args.only not in str(spec):
            continue
        kind = spec[0]
        local = spec[1]
        if kind == "vectors":
            model, filename, chunk_mb = spec[2], spec[3], spec[4]
            ok = upload_vectors(args.url, args.token, local, model, filename, chunk_mb)
        else:
            remote, chunk_mb = spec[2], spec[3]
            ok = upload_file(args.url, args.token, local, remote, chunk_mb)
        if ok:
            success.append(str(local))
        else:
            failed.append(str(local))
    elapsed = time.time() - start
    print()
    print(f"=== Done in {elapsed:.0f}s ===")
    print(f"  ✅ {len(success)} uploaded")
    print(f"  ❌ {len(failed)} failed")
    if failed:
        for f in failed:
            print(f"     - {f}")
    print()
    print("Final status:")
    print(f"  {check_status(args.url, args.token)}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
