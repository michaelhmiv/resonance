#!/usr/bin/env python3
"""Sharded BGE-reranker-v2-m3 (int8 ONNX, MIT) runner with sigmoid probability
output for calibrated-silence & Scripture-slot margin evaluation.

Usage: rerank_bge_v2.py <shard_k> <num_shards> <candidates.json> <out.json>
"""
import json, math, sys, time
from pathlib import Path
import numpy as np
import onnxruntime as ort
from huggingface_hub import snapshot_download
from transformers import AutoTokenizer

REPO = "onnx-community/bge-reranker-v2-m3-ONNX"


def sigmoid(x):
    if x > 60:
        return 1.0
    if x < -60:
        return 0.0
    return 1.0 / (1.0 + math.exp(-x))


def format_doc(c):
    lbl = c.get("ref") or c["work_id"].split("__")[0].replace("-", " ").title()
    return f"[{lbl}] {c['text'][:1400]}"


def main():
    k, n = int(sys.argv[1]), int(sys.argv[2])
    cand_path, out_path = sys.argv[3], sys.argv[4]
    entries = json.loads(Path(cand_path).read_text())
    mine = entries[k::n]
    print(f"bge-v2-m3 shard {k}/{n}: {len(mine)} entries", flush=True)

    snap = snapshot_download(
        REPO,
        allow_patterns=["onnx/model_quantized*", "tokenizer*", "config.json", "special_tokens_map.json"],
    )
    tok = AutoTokenizer.from_pretrained(snap)
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    so.intra_op_num_threads = 4
    sess = ort.InferenceSession(
        str(Path(snap) / "onnx/model_quantized.onnx"),
        sess_options=so,
        providers=["CPUExecutionProvider"],
    )
    inames = [i.name for i in sess.get_inputs()]

    results = []
    for e in mine:
        t0 = time.time()
        pairs = [(e["journal"], format_doc(c)) for c in e["candidates"]]
        logits_all = []
        for i in range(0, len(pairs), 16):
            batch = pairs[i : i + 16]
            enc = tok(
                [q for q, _ in batch],
                [d for _, d in batch],
                padding=True,
                truncation=True,
                max_length=768,
                return_tensors="np",
            )
            feed = {k_: v for k_, v in enc.items() if k_ in inames}
            logits = sess.run(None, feed)[0]
            logits_all.extend(np.asarray(logits).reshape(-1).tolist())

        scored = []
        for c, lg in zip(e["candidates"], logits_all):
            scored.append({
                **c,
                "ce_score": round(float(lg), 3),
                "rerank_prob": round(sigmoid(float(lg)), 4),
                "rerank_logit": round(float(lg), 3),
            })
        scored.sort(key=lambda x: -x["ce_score"])
        picks, per_work = [], {}
        for c in scored:
            if per_work.get(c["work_id"], 0) >= 2:
                continue
            picks.append(c)
            per_work[c["work_id"]] = per_work.get(c["work_id"], 0) + 1
            if len(picks) >= 5:
                break
        print(
            f"{e['id']}: top1 CE={picks[0]['ce_score']:+.2f} (P={picks[0]['rerank_prob']:.3f}) "
            f"{picks[0].get('ref') or picks[0]['work_id'][:24]} ({time.time()-t0:.1f}s)",
            flush=True,
        )
        results.append({
            "id": e["id"],
            "title": e.get("title", e["id"]),
            "journal": e["journal"],
            "picks": picks,
            "all_scored": [
                {
                    "n": c["n"],
                    "work_id": c["work_id"],
                    "source": c["source"],
                    "ref": c.get("ref"),
                    "score": c["score"],
                    "ce_score": c["ce_score"],
                    "rerank_prob": c["rerank_prob"],
                    "rerank_logit": c["rerank_logit"],
                }
                for c in scored
            ],
        })
    Path(out_path).write_text(json.dumps(results, indent=1))
    print(f"wrote {out_path}", flush=True)


if __name__ == "__main__":
    main()
