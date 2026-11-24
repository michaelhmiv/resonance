#!/usr/bin/env python3
"""Build stratified per-library top-50 candidates (20 Scripture + 30 Witnesses)
from pre-computed retriever shard embeddings, using production int8 scalar-quantized
vectors at the target dimension (512d or 1024d).

Why stratified per-library retrieval:
  Resonance maintains separate libraries (Scripture, Witnesses, Past Self).
  In a flat cosine top-50, prose-preferring embedders (like Voyage-4-Nano) can
  crowd out shorter 75-word Bible verse groups. Retrieving top-20 Scripture +
  top-30 Witnesses ensures every query gives the reranker a complete view of both
  libraries, while letting calibrated silence floors suppress either library if weak.

Usage: build_stratified_candidates.py <model_key> <num_shards> <dim> <out_prefix>
"""
import json, sys
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_retriever as rr


def main():
    model_key = sys.argv[1]
    n_shards = int(sys.argv[2])
    dim = int(sys.argv[3])
    out_prefix = sys.argv[4]

    tok, sess, cfg = rr.load(model_key)
    pool = [json.loads(l) for l in (rr.ROOT / "corpus/chunks_subset.jsonl").open()]
    emb_full = np.concatenate([np.load(f"shard_{model_key}_{k}.npy") for k in range(n_shards)], axis=0)
    assert emb_full.shape[0] == len(pool), (emb_full.shape, len(pool))

    queries = rr.golden_queries()
    q_full = rr.embed_texts(tok, sess, cfg, [rr.format_query(model_key, x["journal"]) for x in queries])

    # Truncate to target dim, L2-normalize, and apply production int8 scalar quantization
    emb = emb_full[:, :dim].copy()
    emb /= np.maximum(np.linalg.norm(emb, axis=1, keepdims=True), 1e-12)
    emb_i8 = rr.quantize_int8_vectors(emb)

    q = q_full[:, :dim].copy()
    q /= np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-12)

    sims = q @ emb_i8.T

    bible_idx = np.array([i for i, p in enumerate(pool) if p["source"] == "bible"], dtype=np.int32)
    witness_idx = np.array([i for i, p in enumerate(pool) if p["source"] != "bible"], dtype=np.int32)

    flat_results, flat_cands, strat_cands = [], [], []
    for i, query in enumerate(queries):
        # Flat guarded top-5 (for retriever-only comparison at this exact dim + int8)
        top5 = rr.select_with_guards(pool, sims[i])
        flat_results.append({
            **query,
            "results": [
                {
                    "rank": r + 1,
                    "score": round(float(sims[i][j]), 4),
                    "work_id": pool[j]["work_id"],
                    "source": pool[j]["source"],
                    "ref": pool[j]["chunk_id"] if pool[j]["source"] == "bible" else None,
                    "division": pool[j].get("division"),
                    "text": pool[j]["text"][:600],
                }
                for r, j in enumerate(top5)
            ],
        })

        # Flat top-50
        top50 = np.argsort(-sims[i])[:50]
        flat_cands.append({
            **query,
            "candidates": [
                {
                    "n": r + 1,
                    "score": round(float(sims[i][j]), 4),
                    "work_id": pool[j]["work_id"],
                    "source": pool[j]["source"],
                    "ref": pool[j]["chunk_id"] if pool[j]["source"] == "bible" else None,
                    "division": pool[j].get("division"),
                    "text": pool[j]["text"][:1200],
                }
                for r, j in enumerate(top50)
            ],
        })

        # Stratified per-library top-50: top-20 Scripture + top-30 Witnesses, ordered by score
        b_top = bible_idx[np.argsort(-sims[i][bible_idx])[:20]]
        w_top = witness_idx[np.argsort(-sims[i][witness_idx])[:30]]
        combined = np.concatenate([b_top, w_top])
        combined = combined[np.argsort(-sims[i][combined])]
        strat_cands.append({
            **query,
            "candidates": [
                {
                    "n": r + 1,
                    "score": round(float(sims[i][j]), 4),
                    "work_id": pool[j]["work_id"],
                    "source": pool[j]["source"],
                    "ref": pool[j]["chunk_id"] if pool[j]["source"] == "bible" else None,
                    "division": pool[j].get("division"),
                    "text": pool[j]["text"][:1200],
                }
                for r, j in enumerate(combined)
            ],
        })

    Path(f"results-{out_prefix}.json").write_text(json.dumps(flat_results, indent=1))
    Path(f"candidates-{out_prefix}-flat.json").write_text(json.dumps(flat_cands, indent=1))
    Path(f"candidates-{out_prefix}-stratified.json").write_text(json.dumps(strat_cands, indent=1))
    print(f"wrote {out_prefix} (dim={dim}, int8 pack={110996*dim/(1024*1024):.1f} MB)", flush=True)


if __name__ == "__main__":
    main()
