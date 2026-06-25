#!/usr/bin/env python3
"""
Upload corpus files to the Railway volume via the /api/admin/upload-file endpoint.

Reads `ADMIN_UPLOAD_TOKEN` from the environment and `RESONANCE_URL` (default:
https://resonance.up.railway.app).

Usage:
    python3 upload_corpus.py --file apps/web/data/seeded_library/voice_passages.json
    python3 upload_corpus.py --file apps/web/data/seeded_library/voice_books.json
    python3 upload_corpus.py --all    # uploads voice_books.json + voice_passages.json + per-work attribution

Each file is uploaded in 8 MB chunks. The endpoint reassembles them server-side
and writes to /data/<path> on the Railway volume.
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

DEFAULT_URL = "https://resonance.up.railway.app"
CHUNK_SIZE = 8 * 1024 * 1024  # 8 MB


def upload_file(base_url: str, token: str, local_path: Path, rel_dest_path: str,
                max_retries: int = 3) -> bool:
    """Upload a single file in chunks."""
    file_size = local_path.stat().st_size
    total_chunks = (file_size + CHUNK_SIZE - 1) // CHUNK_SIZE
    print(f"  Uploading {local_path} ({file_size / 1024 / 1024:.1f} MB) as {total_chunks} chunks")
    print(f"  → {rel_dest_path}")

    with open(local_path, "rb") as f:
        for i in range(total_chunks):
            chunk = f.read(CHUNK_SIZE)
            if not chunk:
                break
            url = f"{base_url}/api/admin/upload-file"
            req = urllib.request.Request(url, data=chunk, method="POST")
            req.add_header("Content-Type", "application/octet-stream")
            req.add_header("X-Admin-Token", token)
            req.add_header("X-Path", rel_dest_path)
            req.add_header("X-Chunk-Index", str(i))
            req.add_header("X-Total-Chunks", str(total_chunks))

            for attempt in range(max_retries):
                try:
                    resp = urllib.request.urlopen(req, timeout=120)
                    result = json.loads(resp.read().decode())
                    if result.get("ok"):
                        if "remaining" in result:
                            print(f"    chunk {i+1}/{total_chunks} OK ({len(chunk)} bytes), {result['remaining']} remaining")
                        else:
                            print(f"    chunk {i+1}/{total_chunks} — FILE ASSEMBLED ({result.get('size', 0) / 1024 / 1024:.1f} MB)")
                        break
                    else:
                        print(f"    chunk {i+1}/{total_chunks} error: {result}")
                        if attempt < max_retries - 1:
                            time.sleep(5)
                except Exception as e:
                    print(f"    chunk {i+1}/{total_chunks} HTTP error: {e}")
                    if attempt < max_retries - 1:
                        time.sleep(10)
            else:
                print(f"  ✗ FAILED chunk {i+1} after {max_retries} retries")
                return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="Local file to upload (single file mode)")
    ap.add_argument("--rel-dest", help="Destination path under /data/ (default: same as local file under data/)")
    ap.add_argument("--all", action="store_true", help="Upload voice_books.json + voice_passages.json + per-work attribution files")
    ap.add_argument("--url", default=os.environ.get("RESONANCE_URL", DEFAULT_URL))
    ap.add_argument("--token", default=os.environ.get("ADMIN_UPLOAD_TOKEN", ""))
    args = ap.parse_args()

    if not args.token:
        print("ERROR: ADMIN_UPLOAD_TOKEN not set in env")
        sys.exit(1)

    repo_root = Path(__file__).parent.parent.parent

    if args.all:
        # Upload the main library files + per-work attribution
        files_to_upload = [
            (repo_root / "apps/web/data/seeded_library/voice_books.json",
             "seeded_library/voice_books.json"),
            (repo_root / "apps/web/data/seeded_library/voice_passages.json",
             "seeded_library/voice_passages.json"),
        ]
        # Add per-work attribution.json files (small, useful audit trail)
        staging_dir = repo_root / "corpus" / "staging_v2"
        if staging_dir.exists():
            for pkg_dir in sorted(staging_dir.iterdir()):
                if not pkg_dir.is_dir(): continue
                for f in sorted(pkg_dir.iterdir()):
                    if f.suffix == ".json" and f.name.endswith(".attribution.json"):
                        # Map staging to /data/seeded_library/staging/<pkg>/<file>
                        rel = f"seeded_library/staging/{pkg_dir.name}/{f.name}"
                        files_to_upload.append((f, rel))

        print(f"Uploading {len(files_to_upload)} files to {args.url}")
        for local, rel in files_to_upload:
            if not local.exists():
                print(f"  SKIP {local} (not found)")
                continue
            ok = upload_file(args.url, args.token, local, rel)
            if not ok:
                print(f"  ✗ FAILED: {local}")
                sys.exit(1)
        print("\n✓ All files uploaded successfully")
        return

    if args.file:
        local = Path(args.file)
        if not local.exists():
            print(f"ERROR: file not found: {local}")
            sys.exit(1)
        rel = args.rel_dest
        if not rel:
            # Default: file is under apps/web/data/seeded_library/X → /data/seeded_library/X
            # Or under corpus/staging_v2/... → /data/seeded_library/staging/...
            rel_path = local.resolve()
            if "seeded_library" in str(rel_path):
                idx = str(rel_path).index("seeded_library")
                rel = str(rel_path)[idx:].replace("seeded_library/", "")
            elif "staging_v2" in str(rel_path):
                idx = str(rel_path).index("staging_v2")
                tail = str(rel_path)[idx + len("staging_v2/"):]
                rel = f"seeded_library/staging/{tail}"
            else:
                rel = str(local.name)
        ok = upload_file(args.url, args.token, local, rel)
        if not ok:
            sys.exit(1)
        print("✓ Upload complete")
        return

    ap.print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()
