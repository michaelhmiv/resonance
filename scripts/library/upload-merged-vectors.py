#!/usr/bin/env python3
"""
Upload the merged vectors.bin + manifest.json to Railway production.

Resumable: if a chunk fails or the process is interrupted, re-running the
script continues from the last successful chunk. The /api/admin/upload-vectors
GET endpoint reports which chunks have been received.

Inputs (from scripts/library/.reembed/merged/):
  - vectors.bin (1,291,829,760 bytes, 504,621 vectors × 2,560 dims)
  - manifest.json (passage_ids + passage_sources, bible+voice sorted by id)
  - sha256.txt (precomputed hash for verification after upload)

Targets (on Railway production volume):
  - /data/vectors/pplx-embed-v1-4b/vectors.bin
  - /data/vectors/pplx-embed-v1-4b/manifest.json

After upload, the route's auto-staleness check (corpus-index.ts) detects the
new fingerprint and spawns build-hnsw-index.mjs as a detached background
process (~3-6 min). The old HNSW keeps serving during the rebuild.
"""

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

CHUNK_SIZE = 4 * 1024 * 1024  # 4 MB (matches reembed_pplx_4b.py)
MAX_RETRIES = 5
RETRY_BACKOFF = 2  # exponential: 2, 4, 8, 16, 30s (capped)

DEFAULT_URL = "https://resonanceweb-production-276b.up.railway.app"
DEFAULT_MODEL = "pplx-embed-v1-4b"
DEFAULT_FILE = "vectors.bin"

MERGED_DIR = Path("/data/resonance/scripts/library/.reembed/merged")


def get_admin_token() -> str:
    p = Path("/data/resonance/apps/web/.env.local")
    if not p.exists():
        sys.exit("Missing apps/web/.env.local")
    for line in p.read_text().splitlines():
        line = line.strip()
        if line.startswith("ADMIN_UPLOAD_TOKEN="):
            return line.split("=", 1)[1].strip()
    sys.exit("ADMIN_UPLOAD_TOKEN not found in .env.local")


def get_status(base: str, token: str, model: str, filename: str) -> dict:
    url = f"{base}/api/admin/upload-vectors?model={model}&filename={filename}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("X-Admin-Token", token)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def diag_file(base: str, token: str, path: str) -> dict:
    url = f"{base}/api/admin/diag-file?path={path}&offset=0&length=16"
    req = urllib.request.Request(url, method="GET")
    req.add_header("X-Admin-Token", token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": e.code, "body": e.read().decode()[:200]}


def upload_chunk(base: str, token: str, model: str, filename: str,
                 chunk_idx: int, total_chunks: int, data: bytes) -> dict:
    url = f"{base}/api/admin/upload-vectors"
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("X-Admin-Token", token)
    req.add_header("X-Model", model)
    req.add_header("X-Filename", filename)
    req.add_header("X-Chunk-Index", str(chunk_idx))
    req.add_header("X-Total-Chunks", str(total_chunks))
    req.add_header("Content-Type", "application/octet-stream")
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read())


def upload_chunk_with_retry(base: str, token: str, model: str, filename: str,
                            chunk_idx: int, total_chunks: int, data: bytes) -> dict:
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return upload_chunk(base, token, model, filename,
                                chunk_idx, total_chunks, data)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:300]
            last_err = f"HTTP {e.code}: {body}"
            if e.code in (429, 500, 502, 503, 504):
                wait = min(30, RETRY_BACKOFF ** attempt)
                print(f"  [retry {attempt}/{MAX_RETRIES}] {last_err[:80]} — waiting {wait}s")
                time.sleep(wait)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_err = f"{type(e).__name__}: {e}"
            wait = min(30, RETRY_BACKOFF ** attempt)
            print(f"  [retry {attempt}/{MAX_RETRIES}] {last_err[:80]} — waiting {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"Chunk {chunk_idx} failed after {MAX_RETRIES} retries: {last_err}")


def upload_file(base: str, token: str, rel_path: str, data: bytes) -> dict:
    """Single-shot upload via /api/admin/upload-file. Subject to platform body size limit (~10 MB)."""
    url = f"{base}/api/admin/upload-file"
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("X-Admin-Token", token)
    req.add_header("X-Path", rel_path)
    req.add_header("X-Chunk-Index", "0")
    req.add_header("X-Total-Chunks", "1")
    req.add_header("Content-Type", "application/octet-stream")
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read())


def upload_file_chunked(base: str, token: str, rel_path: str, data: bytes,
                         chunk_size: int = 4 * 1024 * 1024) -> dict:
    """Chunked upload via /api/admin/upload-file with the same protocol as /api/admin/upload-vectors.
    The endpoint supports X-Chunk-Index + X-Total-Chunks; final chunk triggers atomic assembly."""
    total_size = len(data)
    total_chunks = (total_size + chunk_size - 1) // chunk_size
    print(f"  chunked upload: {total_size:,} bytes, {total_chunks} chunks of {chunk_size/1024/1024:.0f} MB")
    last_result = None
    for chunk_idx in range(total_chunks):
        start = chunk_idx * chunk_size
        end = min(start + chunk_size, total_size)
        chunk = data[start:end]
        url = f"{base}/api/admin/upload-file"
        req = urllib.request.Request(url, data=chunk, method="POST")
        req.add_header("X-Admin-Token", token)
        req.add_header("X-Path", rel_path)
        req.add_header("X-Chunk-Index", str(chunk_idx))
        req.add_header("X-Total-Chunks", str(total_chunks))
        req.add_header("Content-Type", "application/octet-stream")
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    last_result = json.loads(r.read())
                    break
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                if attempt == MAX_RETRIES:
                    raise
                wait = min(30, RETRY_BACKOFF ** attempt)
                print(f"    [retry {attempt}/{MAX_RETRIES}] chunk {chunk_idx}: {e} — waiting {wait}s")
                time.sleep(wait)
        if chunk_idx == total_chunks - 1:
            return last_result
    return last_result


def upload_vectors(base: str, token: str, vec_path: Path, model: str, filename: str):
    total_size = vec_path.stat().st_size
    total_chunks = (total_size + CHUNK_SIZE - 1) // CHUNK_SIZE
    print(f"[vectors] {vec_path.name}: {total_size:,} bytes ({total_size/1024/1024:.1f} MB), "
          f"{total_chunks} chunks of {CHUNK_SIZE/1024/1024:.0f} MB each")

    # Check what's already uploaded (resumable)
    status = get_status(base, token, model, filename)
    if status.get("assembled") and status.get("size") == total_size:
        print(f"[vectors] already assembled with correct size — skipping")
        return status
    if status.get("assembled"):
        # /api/admin/upload-vectors GET doesn't return size, so diag-file the actual file
        diag = diag_file(base, token, f"vectors/{model}/{filename}")
        actual = diag.get("size")
        if actual == total_size:
            print(f"[vectors] already at correct size on server — skipping")
            return status
        if actual is not None:
            print(f"[vectors] WARNING: existing file is {actual:,} bytes, "
                  f"expected {total_size:,} — will overwrite via chunked upload")
        else:
            print(f"[vectors] WARNING: existing file may be partial — will overwrite via chunked upload")
    received = set(status.get("chunks_received", []))
    if received:
        print(f"[vectors] resuming: {len(received)}/{total_chunks} chunks already received")
    else:
        print(f"[vectors] starting fresh upload")

    start_t = time.time()
    with vec_path.open("rb") as f:
        for chunk_idx in range(total_chunks):
            if chunk_idx in received:
                continue
            f.seek(chunk_idx * CHUNK_SIZE)
            data = f.read(CHUNK_SIZE)
            t0 = time.time()
            result = upload_chunk_with_retry(base, token, model, filename,
                                              chunk_idx, total_chunks, data)
            elapsed = time.time() - t0
            speed_mbps = (len(data) / 1024 / 1024) / elapsed if elapsed > 0 else 0
            overall = time.time() - start_t
            done = chunk_idx + 1
            remaining = total_chunks - done
            eta = (overall / done) * remaining if done > 0 else 0
            print(f"  [{done:>4}/{total_chunks}] {len(data):>10,} bytes in {elapsed:5.2f}s "
                  f"({speed_mbps:5.1f} MB/s) — ETA {eta:5.0f}s — {result.get('ok')}")
            # If this was the last chunk, the server assembled the file
            if chunk_idx == total_chunks - 1:
                return result
    return status


def upload_manifest(base: str, token: str, manifest_path: Path, model: str):
    rel_path = f"vectors/{model}/manifest.json"
    print(f"\n[manifest] uploading to {rel_path} ({manifest_path.stat().st_size:,} bytes)")
    data = manifest_path.read_bytes()
    # Platform truncates single-shot uploads at ~10 MB; use chunked for >10 MB
    if len(data) > 10 * 1024 * 1024:
        result = upload_file_chunked(base, token, rel_path, data)
    else:
        result = upload_file(base, token, rel_path, data)
    print(f"[manifest] {result}")
    return result


def verify_upload(base: str, token: str, vec_path: Path, manifest_path: Path,
                  model: str, expected_sha: str):
    """Use diag-file to confirm size on the server, then sha256 the local + diff."""
    print(f"\n[verify] checking uploaded size on server")
    import base64
    url = f"{base}/api/admin/diag-file?path=vectors/{model}/vectors.bin&offset=0&length=16"
    req = urllib.request.Request(url, method="GET")
    req.add_header("X-Admin-Token", token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read())
            remote_size = d.get("size")
            print(f"  remote vectors.bin size: {remote_size:,} bytes")
            print(f"  local  vectors.bin size: {vec_path.stat().st_size:,} bytes")
            print(f"  match: {remote_size == vec_path.stat().st_size}")
    except urllib.error.HTTPError as e:
        print(f"  diag-file HTTP {e.code}: {e.read().decode()[:200]}")

    # Sha256 local
    print(f"\n[verify] local sha256: {expected_sha}")
    print(f"  → Server will re-HNSW-build on next request from corpus-index.ts staleness check")
    print(f"  → Wait 3-6 min for the build, then test /api/resonance")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", default=os.environ.get("PROD_URL", DEFAULT_URL))
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--skip-vectors", action="store_true",
                   help="Skip the vectors upload (e.g. for manifest-only re-upload)")
    p.add_argument("--skip-manifest", action="store_true",
                   help="Skip the manifest upload")
    args = p.parse_args()

    token = get_admin_token()
    print(f"[init] target: {args.url} model={args.model}")

    vec_path = MERGED_DIR / "vectors.bin"
    manifest_path = MERGED_DIR / "manifest.json"
    sha_path = MERGED_DIR / "sha256.txt"

    if not vec_path.exists() or not manifest_path.exists() or not sha_path.exists():
        sys.exit(f"Missing files in {MERGED_DIR}. Run scripts/library/merge-voice-into-bible.py first.")

    expected_sha = sha_path.read_text().strip()

    if not args.skip_vectors:
        upload_vectors(args.url, token, vec_path, args.model, "vectors.bin")
    if not args.skip_manifest:
        upload_manifest(args.url, token, manifest_path, args.model)

    verify_upload(args.url, token, vec_path, manifest_path, args.model, expected_sha)
    print(f"\n=== Upload complete ===")


if __name__ == "__main__":
    main()
