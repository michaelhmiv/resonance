#!/usr/bin/env python3
"""Decider-seat contestant: cross-encoder reranker (SBERT family).

BGE reranker v2-m3, int8-quantized ONNX (the phone-class artifact), scores
each (journal entry, candidate) pair with full cross-attention and ranks.
It generates nothing — pure pair scoring. Selection applies the spec's
per-work cap of 2; no Scripture slot (that guard belongs to presentation
and would apply equally to any seat winner in production).

Usage: rerank_crossencoder.py <candidates.json>
Writes rerank-crossencoder.json.
"""
import json, sys
from pathlib import Path
import numpy as np
import onnxruntime as ort
from huggingface_hub import snapshot_download
from transformers import AutoTokenizer

REPO = "onnx-community/bge-reranker-v2-m3-ONNX"

def main():
    entries = json.loads(Path(sys.argv[1]).read_text())
    snap = snapshot_download(REPO, allow_patterns=[
        "onnx/model_quantized*", "tokenizer*", "config.json", "special_tokens_map.json"])
    tok = AutoTokenizer.from_pretrained(snap)
    sess = ort.InferenceSession(str(Path(snap) / "onnx/model_quantized.onnx"),
                                providers=["CPUExecutionProvider"])
    inames = [i.name for i in sess.get_inputs()]
    results = []
    for e in entries:
        pairs = [(e["journal"], c["text"][:1600]) for c in e["candidates"]]
        scores = []
        for i in range(0, len(pairs), 32):
            batch = pairs[i:i + 32]
            enc = tok([q for q, _ in batch], [d for _, d in batch],
                      padding=True, truncation=True, max_length=512, return_tensors="np")
            feed = {k: v for k, v in enc.items() if k in inames}
            logits = sess.run(None, feed)[0]
            scores.extend(np.asarray(logits).reshape(-1).tolist())
        ranked = sorted(range(len(scores)), key=lambda j: -scores[j])
        picks, per_work = [], {}
        for j in ranked:
            c = e["candidates"][j]
            if per_work.get(c["work_id"], 0) >= 2: continue
            picks.append({**c, "ce_score": round(float(scores[j]), 3)})
            per_work[c["work_id"]] = per_work.get(c["work_id"], 0) + 1
            if len(picks) >= 5: break
        results.append({"id": e["id"], "journal": e["journal"], "picks": picks})
        print(f"{e['id']}: top ce {picks[0]['ce_score'] if picks else '-'}", flush=True)
    Path("rerank-crossencoder.json").write_text(json.dumps(results, indent=1))
    print("wrote rerank-crossencoder.json", flush=True)

if __name__ == "__main__":
    main()
