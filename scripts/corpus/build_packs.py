#!/usr/bin/env python3
"""Build pre-embedded 512d int8 Resonance corpus packs for GitHub Releases.

Embeds `corpus/chunks_v3.jsonl` using the exact pinned `Voyage-4-Nano` INT8 ONNX
model (`onnx-community/voyage-4-nano-ONNX`, commit fb6f32cceb63b6eac92e1fdc08e00d03c41cdf5a),
MRL-slices to 512d, L2-normalizes, and symmetrically quantizes per-vector into
`int8` (`RVEC` v1 binary format matching `packages/core/src/embedding.ts`).

Supports sharded execution for fast parallel GitHub Actions builds:
  1. Shard step:
     python scripts/corpus/build_packs.py embed-shard \
       --chunks corpus/chunks_v3.jsonl \
       --shard 0 --num-shards 8 \
       --out-dir out/shards
  2. Assemble step:
     python scripts/corpus/build_packs.py assemble \
       --chunks corpus/chunks_v3.jsonl \
       --shards-dir out/shards \
       --out-dir out/packs \
       --release-tag corpus-packs-latest \
       --version 1.0.0
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import struct
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

VOYAGE_REPO = "onnx-community/voyage-4-nano-ONNX"
VOYAGE_SHA = "fb6f32cceb63b6eac92e1fdc08e00d03c41cdf5a"
EMBEDDING_DIM = 512
RVEC_MAGIC = b"RVEC"
RVEC_VERSION = 1
RVEC_QUANT_INT8 = 1


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def write_rvec(path: Path, vectors_int8, scales_f32) -> None:
    """Write RVEC v1 binary file matching `parseRvec` in @resonance/core."""
    import numpy as np

    vecs = np.ascontiguousarray(vectors_int8, dtype=np.int8)
    scales = np.ascontiguousarray(scales_f32, dtype="<f4")
    count, dim = vecs.shape
    assert scales.shape == (count,), f"scales shape {scales.shape} != ({count},)"
    header = struct.pack("<4sBBHII", RVEC_MAGIC, RVEC_VERSION, RVEC_QUANT_INT8, dim, count, 0)
    with path.open("wb") as fh:
        fh.write(header)
        fh.write(scales.tobytes())
        fh.write(vecs.tobytes())


def quantize_int8_512(vecs_f32):
    """MRL-slice to 512d, L2-normalize, and symmetrically quantize per-vector int8."""
    import numpy as np

    sliced = np.asarray(vecs_f32[:, :EMBEDDING_DIM], dtype=np.float32)
    norms = np.linalg.norm(sliced, axis=1, keepdims=True)
    norms = np.where(norms > 1e-12, norms, 1.0)
    unit = sliced / norms

    max_abs = np.max(np.abs(unit), axis=1)
    scales = np.where(max_abs > 1e-12, max_abs / 127.0, 1.0).astype(np.float32)
    inv = np.where(max_abs > 1e-12, 127.0 / max_abs, 0.0)[:, None]
    q = np.clip(np.rint(unit * inv), -127, 127).astype(np.int8)
    return q, scales


def load_chunks(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def format_doc(chunk: dict[str, Any]) -> str:
    if chunk.get("source") == "bible":
        title = f"Bible — {chunk.get('chunk_id', '')}"
    else:
        wid = chunk["work_id"].split("__")[0].replace("-", " ").title()
        div = (chunk.get("division") or "").strip()
        title = f"{wid} — {div[:80]}" if div else wid
    return f"Represent the document for retrieval: [{title}]\n{chunk['text']}"


def cmd_embed_shard(args: argparse.Namespace) -> None:
    import shutil
    import numpy as np
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download
    from transformers import AutoTokenizer

    rows = load_chunks(Path(args.chunks))
    n = len(rows)
    shard = args.shard
    num_shards = args.num_shards
    start = (n * shard) // num_shards
    end = (n * (shard + 1)) // num_shards
    sub = rows[start:end]
    print(f"[shard {shard}/{num_shards}] embedding rows [{start}:{end}] ({len(sub):,} chunks)", flush=True)

    model_dir = Path("/tmp/model_voyage_4_nano")
    model_dir.mkdir(parents=True, exist_ok=True)
    for fn in ("onnx/model_quantized.onnx", "onnx/model_quantized.onnx_data"):
        dst = model_dir / Path(fn).name
        if not dst.exists():
            shutil.copy(hf_hub_download(VOYAGE_REPO, filename=fn, revision=VOYAGE_SHA), dst)

    tokenizer = AutoTokenizer.from_pretrained(VOYAGE_REPO, revision=VOYAGE_SHA)

    sess_opts = ort.SessionOptions()
    sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess_opts.intra_op_num_threads = args.threads
    sess = ort.InferenceSession(
        str(model_dir / "model_quantized.onnx"),
        sess_options=sess_opts,
        providers=["CPUExecutionProvider"],
    )
    input_names = [i.name for i in sess.get_inputs()]
    output_names = [o.name for o in sess.get_outputs()]
    print(f"loaded voyage-4-nano inputs={input_names} outputs={output_names}", flush=True)

    # Length-sort for minimal padding overhead
    order = sorted(range(len(sub)), key=lambda i: len(sub[i]["text"]))
    out_q = np.zeros((len(sub), EMBEDDING_DIM), dtype=np.int8)
    out_s = np.zeros((len(sub),), dtype=np.float32)

    batch_size = args.batch_size
    t0 = time.time()
    for b_start in range(0, len(order), batch_size):
        idxs = order[b_start : b_start + batch_size]
        texts = [format_doc(sub[i]) for i in idxs]
        enc = tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors="np",
        )
        ids = enc["input_ids"].astype(np.int64)
        mask = enc["attention_mask"].astype(np.int64)

        feeds: dict[str, Any] = {}
        for name in input_names:
            if name == "input_ids":
                feeds[name] = ids
            elif name == "attention_mask":
                feeds[name] = mask
            elif name == "token_type_ids":
                feeds[name] = enc.get("token_type_ids", np.zeros_like(ids)).astype(np.int64)
            elif name == "position_ids":
                feeds[name] = np.maximum(np.cumsum(mask, axis=1) - 1, 0).astype(np.int64)

        outs = sess.run(output_names, feeds)
        out_map = dict(zip(output_names, outs))
        if "pooler_output" in out_map and out_map["pooler_output"].ndim == 2:
            pooled = out_map["pooler_output"]
        elif outs[0].ndim == 3:
            m = mask[:, :, None].astype(np.float32)
            pooled = (outs[0] * m).sum(axis=1) / np.maximum(m.sum(axis=1), 1e-6)
        else:
            pooled = outs[0]

        q, s = quantize_int8_512(pooled)
        for j, orig_i in enumerate(idxs):
            out_q[orig_i] = q[j]
            out_s[orig_i] = s[j]

        done = b_start + len(idxs)
        if done % 1000 < batch_size or done == len(order):
            dt = max(time.time() - t0, 1e-3)
            print(f"  [{shard}] {done:,}/{len(order):,} ({done/dt:.1f} chunks/s)", flush=True)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    np.save(out_dir / f"shard_{shard:02d}_q.npy", out_q)
    np.save(out_dir / f"shard_{shard:02d}_s.npy", out_s)
    meta = {"shard": shard, "num_shards": num_shards, "start": start, "end": end, "count": len(sub)}
    (out_dir / f"shard_{shard:02d}_meta.json").write_text(json.dumps(meta, indent=2))
    print(f"[shard {shard}] saved {len(sub):,} int8 512d vectors")


def cmd_assemble(args: argparse.Namespace) -> None:
    import numpy as np

    rows = load_chunks(Path(args.chunks))
    shards_dir = Path(args.shards_dir)
    meta_files = sorted(shards_dir.glob("shard_*_meta.json"))
    if not meta_files:
        raise SystemExit(f"No shard metadata files found in {shards_dir}")

    all_q_parts = []
    all_s_parts = []
    expected_start = 0
    for mf in meta_files:
        m = json.loads(mf.read_text())
        if m["start"] != expected_start:
            raise SystemExit(f"Shard gap/overlap at {mf}: expected start {expected_start}, got {m['start']}")
        expected_start = m["end"]
        idx = m["shard"]
        all_q_parts.append(np.load(shards_dir / f"shard_{idx:02d}_q.npy"))
        all_s_parts.append(np.load(shards_dir / f"shard_{idx:02d}_s.npy"))

    if expected_start != len(rows):
        raise SystemExit(f"Total shard rows {expected_start} != chunks_v3 rows {len(rows)}")

    all_q = np.concatenate(all_q_parts, axis=0)
    all_s = np.concatenate(all_s_parts, axis=0)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Split into Bible pack + Witnesses pack (editable/extensible via GitHub Releases)
    pack_specs = [
        {
            "id": "bible-web",
            "label": "World English Bible (512d vectors)",
            "description": "Scripture passages pre-embedded with Voyage-4-Nano INT8.",
            "kind": "bible",
            "indices": [i for i, r in enumerate(rows) if r.get("source") == "bible" or r.get("work_id") == "web"],
        },
        {
            "id": "witnesses-all",
            "label": "80-Work Church Library (512d)",
            "description": "Church Fathers, Medieval Mystics, Reformers, and Modern Witnesses.",
            "kind": "witnesses",
            "indices": [i for i, r in enumerate(rows) if not (r.get("source") == "bible" or r.get("work_id") == "web")],
        },
    ]

    base_url = f"https://github.com/{args.repo}/releases/download/{args.release_tag}"
    manifest_packs = []

    for spec in pack_specs:
        idxs = spec["indices"]
        if not idxs:
            continue
        pack_id = spec["id"]
        passages_path = out_dir / f"{pack_id}.passages.jsonl.gz"
        vectors_path = out_dir / f"{pack_id}.vectors.rvec"

        works = set()
        with gzip.open(passages_path, "wt", encoding="utf-8", compresslevel=6) as gz:
            for chunk_pos, row_idx in enumerate(idxs):
                r = rows[row_idx]
                wid = r["work_id"]
                works.add(wid)
                out_row = {
                    "work_id": wid,
                    "title": wid.split("__")[0].replace("-", " ").title(),
                    "package_id": pack_id,
                    "division": r.get("division"),
                    "chunk_index": chunk_pos,
                    "source": r.get("source", "corpus"),
                    "text": r["text"],
                }
                gz.write(json.dumps(out_row, ensure_ascii=False) + "\n")

        write_rvec(vectors_path, all_q[idxs], all_s[idxs])

        manifest_packs.append(
            {
                "id": pack_id,
                "label": spec["label"],
                "description": spec["description"],
                "version": args.version,
                "kind": spec["kind"],
                "workCount": len(works),
                "passageCount": len(idxs),
                "dim": EMBEDDING_DIM,
                "quantization": "int8",
                "modelId": "voyage-4-nano",
                "passagesUrl": f"{base_url}/{passages_path.name}",
                "passagesBytes": passages_path.stat().st_size,
                "passagesSha256": sha256_file(passages_path),
                "vectorsUrl": f"{base_url}/{vectors_path.name}",
                "vectorsBytes": vectors_path.stat().st_size,
                "vectorsSha256": sha256_file(vectors_path),
            }
        )
        print(
            f"[pack {pack_id}] {len(idxs):,} passages | "
            f"text={passages_path.stat().st_size/1e6:.2f} MB | "
            f"rvec={vectors_path.stat().st_size/1e6:.2f} MB"
        )

    manifest = {
        "schemaVersion": 1,
        "releaseTag": args.release_tag,
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "modelId": "voyage-4-nano",
        "modelRepo": VOYAGE_REPO,
        "modelCommitSha": VOYAGE_SHA,
        "dim": EMBEDDING_DIM,
        "quantization": "int8",
        "packs": manifest_packs,
    }
    manifest_path = out_dir / "packs-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {manifest_path}")


def main() -> None:
    p = argparse.ArgumentParser(description="Build 512d int8 Resonance corpus packs")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_sh = sub.add_parser("embed-shard")
    p_sh.add_argument("--chunks", default="corpus/chunks_v3.jsonl")
    p_sh.add_argument("--shard", type=int, required=True)
    p_sh.add_argument("--num-shards", type=int, default=8)
    p_sh.add_argument("--batch-size", type=int, default=16)
    p_sh.add_argument("--threads", type=int, default=4)
    p_sh.add_argument("--out-dir", required=True)

    p_as = sub.add_parser("assemble")
    p_as.add_argument("--chunks", default="corpus/chunks_v3.jsonl")
    p_as.add_argument("--shards-dir", required=True)
    p_as.add_argument("--out-dir", required=True)
    p_as.add_argument("--repo", default="michaelhmiv/resonance")
    p_as.add_argument("--release-tag", default="corpus-packs-latest")
    p_as.add_argument("--version", default="1.0.0")

    args = p.parse_args()
    if args.cmd == "embed-shard":
        cmd_embed_shard(args)
    else:
        cmd_assemble(args)


if __name__ == "__main__":
    main()
