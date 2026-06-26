#!/usr/bin/env python3
"""
Restore the Railway volume data for Resonance from local /data/resonance/build/output/.

Uploads the corpus + vector index to the new project's /data/ via the
chunked admin upload endpoints. Skips files that are already present on
the volume (or restores the whole thing with --force).

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
LOCAL_BUILD = Path("/data/resonance/build/output/seeded_library")
LOCAL_VECTORS_BUILD = Path("/data/resonance/build/output")  # for vectors_gte-small.bin (legacy)
LOCAL_PACKAGES = Path("/data/resonance/build/output/packages")

# All files we want on the volume, in upload order.
# Vector index first (largest), then bible metadata, then voice metadata.
UPLOADS = [
    # (kind, local_path, remote_path, chunk_size_mb)
    # kind: "vectors" uses /api/admin/upload-vectors (X-Model, X-Filename)
    #       "file"    uses /api/admin/upload-file    (X-Path)
    # pplx vectors: model=pplx-embed-v1-4b, file=vectors.bin
    ("vectors", LOCAL_BUILD / "vectors_pplx/vectors_pplx-embed-v1-4b.bin", "pplx-embed-v1-4b", "vectors.bin", 8),
    # pplx manifest
    ("file", LOCAL_BUILD / "manifests/pplx-embed-v1-4b/manifest.json", "vectors/pplx-embed-v1-4b/manifest.json", 1),
    # gte-small manifest (legacy but the route code references it)
    ("file", LOCAL_BUILD / "manifests/gte-small/manifest.json", "seeded_library/manifests/gte-small/manifest.json", 1),
    # bible + voice passage metadata
    ("file", LOCAL_BUILD / "bible_passages.json", "seeded_library/bible_passages.json", 8),
    ("file", LOCAL_BUILD / "voice_passages.json", "seeded_library/voice_passages.json", 8),
    # gte-small vectors (legacy file, but the route has logic for it)
    ("file", LOCAL_VECTORS_BUILD / "vectors_gte-small.bin", "seeded_library/vectors_gte-small.bin", 8),
    # Top-level helper files
    ("file", LOCAL_BUILD / "bible_books.json", "seeded_library/bible_books.json", 1),
    ("file", LOCAL_BUILD / "voice_books.json", "seeded_library/voice_books.json", 1),
    ("file", LOCAL_BUILD / "library_manifest.json", "seeded_library/library_manifest.json", 1),
    # packages/ directory — only the JSONs; binary shards would be huge
]


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
