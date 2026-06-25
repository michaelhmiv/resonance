#!/usr/bin/env python3
"""
Re-embed the Resonance voice library against pplx-embed-v1-4b via OpenRouter,
writing int8 vectors + a manifest directly to the Railway volume.

This is a one-shot operation after the embedding-model migration. It:

  1. Reads the book catalog from /api/library/books (75 books, 7 packages).
  2. For each book, fetches its passages from /api/library/passages.
  3. Filters out imprints/prefaces (front-matter) — they pollute retrieval.
  4. Embeds via OpenRouter in batches of 50 passages, exponential backoff on
     429/5xx, hard cap of $2.00 total cost.
  5. Quantizes the float32 vectors to int8 (signed, /127).
  6. Uploads vectors.bin + manifest.json to the volume in 4MB chunks via
     the existing /api/admin/upload-vectors and /api/admin/upload-file
     endpoints.
  7. Is fully resumable: writes state.json after each book, so an aborted
     run can pick up where it left off without re-billing OpenRouter.

Outputs (all under scripts/library/.reembed/):
  state.json       { books_done: [...], total_cost_usd, total_tokens, last_update }
  failed.json      { books_failed: [{ book_id, reason }] }
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

# ── Defaults (override via CLI) ────────────────────────────────────────────

DEFAULT_PROD_URL = "https://resonance-production-fce2.up.railway.app"
DEFAULT_BATCH = 50
DEFAULT_MAX_COST_USD = 2.00
DEFAULT_MODEL = "perplexity/pplx-embed-v1-4b"
DIM = 2560  # pplx-embed-v1-4b output dimension

# Front-matter heuristic — publisher imprints, table of contents, "PREFACE",
# "CONTENTS" pages, and similar noise. We skip passages that are very short
# or match these patterns.
FRONT_MATTER_PATTERNS = [
    "PUBLISHING COMPANY",
    "GRAND RAPIDS",
    "WM. B. EERDMANS",
    "PRINTED IN THE",
    "ALL RIGHTS RESERVED",
    "COPYRIGHT",
    "ISBN",
    "FIRST EDITION",
    "TABLE OF CONTENTS",
    "PREFACE",
    "TRANSLATOR'S NOTE",
    "TRANSLATOR’S NOTE",
    "EDITOR'S PREFACE",
    "INTRODUCTION\n",  # standalone intro lines
]


def is_front_matter(text: str) -> bool:
    t = text.strip()
    if len(t) < 80:  # very short passages are usually noise
        return True
    upper = t.upper()
    return any(pat in upper for pat in FRONT_MATTER_PATTERNS)


# ── HTTP helpers ───────────────────────────────────────────────────────────

def http_get_json(url: str, cookie: str | None = None, headers: dict | None = None) -> dict:
    req = urllib.request.Request(url, method="GET")
    if cookie:
        req.add_header("Cookie", f"resonance-auth={cookie}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def openrouter_embed(texts: list[str], api_key: str, model: str, max_retries: int = 5) -> dict:
    """Call OpenRouter embeddings endpoint, return parsed JSON."""
    url = "https://openrouter.ai/api/v1/embeddings"
    body = json.dumps({"model": model, "input": texts}).encode("utf-8")

    last_err: str | None = None
    for attempt in range(1, max_retries + 1):
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Authorization", f"Bearer {api_key}")
        req.add_header("Content-Type", "application/json")
        req.add_header("HTTP-Referer", "https://resonance.app")
        req.add_header("X-Title", "Resonance")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")[:300]
            if e.code == 429 or e.code >= 500:
                wait = min(30, 2 ** attempt)
                print(f"  [retry {attempt}/{max_retries}] {e.code} — waiting {wait}s: {err_body[:120]}")
                last_err = f"{e.code}: {err_body}"
                time.sleep(wait)
                continue
            raise RuntimeError(f"OpenRouter {e.code}: {err_body}")
        except urllib.error.URLError as e:
            last_err = f"URLError: {e}"
            time.sleep(min(10, 2 ** attempt))
    raise RuntimeError(f"OpenRouter failed after {max_retries} retries: {last_err}")


def admin_upload_chunk(
    prod_url: str, token: str, model: str, filename: str,
    chunk_idx: int, total_chunks: int, data: bytes,
) -> dict:
    url = f"{prod_url}/api/admin/upload-vectors"
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("X-Admin-Token", token)
    req.add_header("X-Model", model)
    req.add_header("X-Filename", filename)
    req.add_header("X-Chunk-Index", str(chunk_idx))
    req.add_header("X-Total-Chunks", str(total_chunks))
    req.add_header("Content-Type", "application/octet-stream")
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode("utf-8"))


def admin_upload_file(
    prod_url: str, token: str, rel_path: str, data: bytes,
) -> dict:
    url = f"{prod_url}/api/admin/upload-file"
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("X-Admin-Token", token)
    req.add_header("X-Path", rel_path)
    req.add_header("X-Chunk-Index", "0")
    req.add_header("X-Total-Chunks", "1")
    req.add_header("Content-Type", "application/octet-stream")
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode("utf-8"))


# ── Main pipeline ──────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--prod-url", default=os.environ.get("PROD_URL", DEFAULT_PROD_URL))
    p.add_argument("--auth-cookie", default=os.environ.get("RESONANCE_AUTH_COOKIE"))
    p.add_argument("--admin-token", default=os.environ.get("ADMIN_UPLOAD_TOKEN"))
    p.add_argument("--openrouter-key", default=os.environ.get("OPENROUTER_API_KEY"))
    p.add_argument("--batch", type=int, default=DEFAULT_BATCH)
    p.add_argument("--max-cost", type=float, default=DEFAULT_MAX_COST_USD)
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--state-dir", default=str(Path(__file__).parent / ".reembed"))
    p.add_argument("--limit-books", type=int, default=0, help="0 = all books; >0 = first N (for testing)")
    p.add_argument("--dry-run", action="store_true", help="Fetch + embed but don't upload")
    p.add_argument("--skip-upload", action="store_true", help="Embed only; write shards locally")
    p.add_argument("--resume", action="store_true", help="Skip books already in state.json")
    args = p.parse_args()

    if not args.openrouter_key:
        sys.exit("OPENROUTER_API_KEY env var required (or --openrouter-key)")
    if not args.admin_token and not (args.dry_run or args.skip_upload):
        sys.exit("ADMIN_UPLOAD_TOKEN env var required (or --admin-token)")

    state_dir = Path(args.state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    state_path = state_dir / "state.json"
    failed_path = state_dir / "failed.json"
    vectors_local_path = state_dir / "vectors.bin"
    manifest_local_path = state_dir / "manifest.json"

    # Load or init state
    if state_path.exists():
        state = json.loads(state_path.read_text())
    else:
        state = {
            "books_done": [],
            "books_failed": [],
            "total_cost_usd": 0.0,
            "total_tokens": 0,
            "passages_embedded": 0,
            "passages_skipped": 0,
            "started_at": time.time(),
            "last_update": time.time(),
        }
    print(f"[state] {len(state['books_done'])} books done, {state['passages_embedded']} passages embedded so far")

    # Fetch book catalog
    print(f"[catalog] fetching from {args.prod_url}/api/library/books")
    catalog = http_get_json(f"{args.prod_url}/api/library/books", cookie=args.auth_cookie)
    all_books = []
    for pkg in catalog.get("packages", []):
        for b in pkg.get("books", []):
            all_books.append({
                "id": b["id"],
                "title": b.get("title"),
                "author": b.get("author"),
                "package": pkg.get("packageId"),
            })
    print(f"[catalog] {len(all_books)} books in {len(catalog.get('packages', []))} packages")
    if args.limit_books:
        all_books = all_books[:args.limit_books]
        print(f"[catalog] limited to first {len(all_books)} books for this run")

    # Open vector file (append mode if resuming, else write)
    if vectors_local_path.exists() and state["passages_embedded"] > 0:
        vec_fh = open(vectors_local_path, "ab")
    else:
        vec_fh = open(vectors_local_path, "wb")
    current_offset = vec_fh.tell()  # bytes already written

    passage_order: list[dict] = []  # { id, book_id, dim_offset } for manifest

    # Process each book
    for i, book in enumerate(all_books, 1):
        book_id = book["id"]
        if args.resume and book_id in state["books_done"]:
            print(f"[{i}/{len(all_books)}] {book_id} — already done, skipping")
            continue
        if state["total_cost_usd"] >= args.max_cost:
            print(f"[abort] cost cap reached: ${state['total_cost_usd']:.4f} >= ${args.max_cost}")
            break

        print(f"[{i}/{len(all_books)}] {book_id} — {book.get('author','?')}, {book.get('title','?')[:50]}")
        try:
            # Fetch passages
            url = f"{args.prod_url}/api/library/passages?bookId={urllib.parse.quote(book_id)}"
            data = http_get_json(url, cookie=args.auth_cookie)
            passages = data.get("passages", [])
            if not passages:
                print(f"  no passages, skipping")
                state["books_done"].append(book_id)
                continue

            # Filter front-matter
            kept = [p for p in passages if not is_front_matter(p["text"])]
            skipped = len(passages) - len(kept)
            if skipped:
                print(f"  filtered {skipped}/{len(passages)} front-matter passages")
            state["passages_skipped"] += skipped

            # Embed in batches
            book_cost = 0.0
            book_tokens = 0
            for batch_start in range(0, len(kept), args.batch):
                batch = kept[batch_start:batch_start + args.batch]
                texts = [p["text"] for p in batch]
                result = openrouter_embed(texts, args.openrouter_key, args.model)

                usage = result.get("usage", {})
                batch_cost = usage.get("cost", 0) or 0
                batch_tokens = usage.get("total_tokens", 0) or 0
                book_cost += batch_cost
                book_tokens += batch_tokens
                state["total_cost_usd"] += batch_cost
                state["total_tokens"] += batch_tokens

                if state["total_cost_usd"] >= args.max_cost:
                    print(f"  [cost-cap] hit ${args.max_cost} mid-book, aborting")
                    break

                # Process each embedding in the batch
                for j, emb_item in enumerate(result.get("data", [])):
                    vec = emb_item.get("embedding", [])
                    if len(vec) != DIM:
                        print(f"  WARN: dim mismatch for passage {batch[j]['id']}: got {len(vec)}, expected {DIM}")
                        continue
                    # Quantize float32 to int8 (signed)
                    int8 = bytes(max(-127, min(127, int(round(v * 127)))) & 0xFF for v in vec)
                    vec_fh.write(int8)
                    passage_order.append({
                        "id": batch[j]["id"],
                        "book_id": book_id,
                        "dim_offset": current_offset,
                    })
                    current_offset += DIM

            state["passages_embedded"] += len(kept)
            state["books_done"].append(book_id)
            print(f"  embedded {len(kept)} passages, batch cost ${book_cost:.6f}, book tokens {book_tokens}")
            print(f"  running total: ${state['total_cost_usd']:.4f} / ${args.max_cost}")

        except Exception as e:
            print(f"  ERROR: {e}")
            state["books_failed"].append({"book_id": book_id, "reason": str(e)[:300]})

        # Persist state every book
        state["last_update"] = time.time()
        state_path.write_text(json.dumps(state, indent=2))

    vec_fh.close()

    # Write local manifest
    manifest = {
        "model": "pplx-embed-v1-4b",
        "dim": DIM,
        "dtype": "int8",
        "quantization": "signed_linear",
        "passage_count": len(passage_order),
        "shards": [{"file": "vectors.bin", "start": 0, "count": len(passage_order)}],
        "passage_order_source": "voice_passages.json (current 75-book library)",
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "passage_order_summary": {
            "total": len(passage_order),
            "unique_books": len(set(p["book_id"] for p in passage_order)),
        },
    }
    manifest_local_path.write_text(json.dumps(manifest, indent=2))
    failed_path.write_text(json.dumps({"books_failed": state["books_failed"]}, indent=2))

    print(f"\n=== Local pipeline complete ===")
    print(f"  passages embedded: {state['passages_embedded']} (skipped {state['passages_skipped']} front-matter)")
    print(f"  books done: {len(state['books_done'])}/{len(all_books)}")
    print(f"  books failed: {len(state['books_failed'])}")
    print(f"  total cost: ${state['total_cost_usd']:.4f}")
    print(f"  total tokens: {state['total_tokens']}")
    print(f"  vectors file: {vectors_local_path} ({vectors_local_path.stat().st_size / 1024 / 1024:.1f} MB)")
    print(f"  manifest: {manifest_local_path}")

    if args.dry_run or args.skip_upload:
        print(f"\n[--{'dry-run' if args.dry_run else 'skip-upload'}] not uploading to volume")
        return

    # Upload vectors.bin in 4MB chunks
    print(f"\n=== Uploading vectors.bin to {args.prod_url} ===")
    VECTORS_MODEL = "pplx-embed-v1-4b"
    CHUNK = 4 * 1024 * 1024
    with open(vectors_local_path, "rb") as f:
        data = f.read()
    chunks = [data[i:i + CHUNK] for i in range(0, len(data), CHUNK)]
    print(f"  {len(chunks)} chunks of up to 4MB")
    for idx, chunk in enumerate(chunks):
        print(f"  uploading chunk {idx + 1}/{len(chunks)} ({len(chunk)/1024/1024:.1f} MB)…")
        result = admin_upload_chunk(
            args.prod_url, args.admin_token, VECTORS_MODEL, "vectors.bin",
            idx, len(chunks), chunk,
        )
        if not result.get("ok"):
            sys.exit(f"upload failed: {result}")

    # Upload manifest
    print(f"\n=== Uploading manifest.json ===")
    manifest_bytes = manifest_local_path.read_bytes()
    result = admin_upload_file(
        args.prod_url, args.admin_token,
        f"vectors/{VECTORS_MODEL}/manifest.json",
        manifest_bytes,
    )
    print(f"  {result}")

    # Verify
    print(f"\n=== Verifying deployment ===")
    status_url = f"{args.prod_url}/api/vectors/status"
    status = http_get_json(status_url, cookie=args.auth_cookie)
    print(f"  model: {status.get('model')}")
    print(f"  dim: {status.get('dim')}")
    print(f"  dtype: {status.get('dtype')}")
    print(f"  passage_count: {status.get('passage_count')}")
    print(f"  file_size_mb: {status.get('file_size_mb')}")
    print(f"  loaded: {status.get('loaded')}")
    print(f"  books: {status.get('books')}")


if __name__ == "__main__":
    main()
