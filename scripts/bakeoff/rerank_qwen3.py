#!/usr/bin/env python3
"""Decider-seat contestant: instruction-aware pointwise reranker (Qwen3-Reranker-0.6B).

Uses n24q02m/Qwen3-Reranker-0.6B-ONNX (onnx/model_yesno_quantized.onnx, 572 MB INT8,
Apache 2.0). Unlike BGE cross-encoders, Qwen3-Reranker accepts a task instruction that
specifies Resonance's posture/direction judgment, and outputs calibrated P(yes) scores
that directly support 'calibrated silence' floors and Scripture-slot margins.

Usage: rerank_qwen3.py <shard_k> <num_shards> <candidates.json>
Writes rerank-qwen3-shard-<k>.json.
"""
import json, math, shutil, sys, time
from pathlib import Path
import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from transformers import AutoTokenizer

REPO = "n24q02m/Qwen3-Reranker-0.6B-ONNX"
MODEL_FILE = "onnx/model_yesno_quantized.onnx"

SYSTEM_PROMPT = (
    "Judge whether the Document meets the requirements based on the Query "
    'and the Instruct provided. Note that the answer can only be "yes" or "no".'
)

RESONANCE_DECIDER_INSTRUCT = (
    "Determine whether this Scripture or classic Christian passage faithfully speaks "
    "to the writer's actual emotional situation, posture, and spiritual direction. "
    "Answer yes only if the passage's stance fits where the writer is heading; answer no "
    "if it merely shares surface keywords while contradicting the writer's posture "
    "(such as a passage nursing bitterness for someone seeking to forgive, or condemning "
    "someone who is honestly wrestling with doubt)."
)

TEMPLATE = (
    "<|im_start|>system\n{system}<|im_end|>\n"
    "<|im_start|>user\n<Instruct>: {instruction}\n"
    "<Query>: {query}\n<Document>: {document}<|im_end|>\n"
    "<|im_start|>assistant\n<think>\n\n</think>\n\n"
)

FORBIDDEN = ("<|im_start|>", "<|im_end|>", "<|endoftext|>")


def sanitize(s):
    for tok in FORBIDDEN:
        s = s.replace(tok, "")
    return s


def format_cand_doc(c):
    lbl = c.get("ref") or c["work_id"].split("__")[0].replace("-", " ").title()
    div = (c.get("division") or "").strip()
    header = f"{lbl} ({div})" if div and not c.get("ref") else lbl
    return f"[{header}]\n{c['text'][:1000]}"


def load():
    tok = AutoTokenizer.from_pretrained(REPO)
    d = Path("/tmp/qwen3_reranker")
    d.mkdir(parents=True, exist_ok=True)
    dst = d / "model_yesno_quantized.onnx"
    if not dst.exists():
        shutil.copy(hf_hub_download(REPO, MODEL_FILE), dst)
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    so.intra_op_num_threads = 4
    sess = ort.InferenceSession(str(dst), sess_options=so, providers=["CPUExecutionProvider"])
    print(
        f"loaded {REPO}: inputs={[(i.name, i.shape) for i in sess.get_inputs()]}, "
        f"outputs={[(o.name, o.shape) for o in sess.get_outputs()]}",
        flush=True,
    )
    return tok, sess


def score_pair(tok, sess, query, doc_text, max_length=1024):
    prompt = TEMPLATE.format(
        system=SYSTEM_PROMPT,
        instruction=RESONANCE_DECIDER_INSTRUCT,
        query=sanitize(query),
        document=sanitize(doc_text),
    )
    enc = tok(prompt, truncation=True, max_length=max_length, return_tensors="np")
    in_ids = enc["input_ids"].astype(np.int64)
    attn = enc["attention_mask"].astype(np.int64)
    feeds = {}
    for inp in sess.get_inputs():
        if inp.name == "input_ids":
            feeds[inp.name] = in_ids
        elif inp.name == "attention_mask":
            feeds[inp.name] = attn
        elif inp.name == "position_ids":
            feeds[inp.name] = np.maximum(np.cumsum(attn, axis=1) - 1, 0).astype(np.int64)
    out = sess.run(None, feeds)[0]
    # model_yesno_quantized outputs (1, 2) with [no_logit, yes_logit]
    no_l, yes_l = float(out[0, 0]), float(out[0, 1])
    diff = no_l - yes_l
    if diff > 60:
        prob = 0.0
    elif diff < -60:
        prob = 1.0
    else:
        prob = 1.0 / (1.0 + math.exp(diff))
    return prob, yes_l - no_l


def spike(tok, sess):
    q = (
        "Mom called. Thirty years of her rewriting history and I still pick up hoping "
        "it'll be different. I want to forgive her — I mean actually forgive, not just go numb."
    )
    good = (
        "[Bible — Colossians 3:12-15]\n"
        "Bearing with one another, and forgiving each other, if any man has a complaint "
        "against any; even as Christ forgave you, so you also do."
    )
    bad = (
        "[Bible — Job 9:16-20]\n"
        "If I had called, and he had answered me, yet I wouldn't believe that he listened "
        "to my voice. For he breaks me with a storm, and multiplies my wounds without cause."
    )
    p_good, l_good = score_pair(tok, sess, q, good)
    p_bad, l_bad = score_pair(tok, sess, q, bad)
    print(f"SPIKE G09: good(Col3)={p_good:.4f} (logit={l_good:.2f}) vs bad(Job9)={p_bad:.4f} (logit={l_bad:.2f})", flush=True)
    ok = p_good > p_bad + 0.15
    print("SPIKE:", "PASS" if ok else "FAIL", flush=True)
    return ok


def main():
    k, n = int(sys.argv[1]), int(sys.argv[2])
    cand_path = sys.argv[3]
    entries = json.loads(Path(cand_path).read_text())
    mine = entries[k::n]
    print(f"qwen3-reranker shard {k}/{n}: {len(mine)} entries", flush=True)
    tok, sess = load()
    if k == 0 and not spike(tok, sess):
        sys.exit(1)

    results = []
    for e in mine:
        t0 = time.time()
        scored = []
        for c in e["candidates"]:
            prob, logit = score_pair(tok, sess, e["journal"], format_cand_doc(c))
            scored.append({**c, "rerank_prob": round(prob, 4), "rerank_logit": round(logit, 3)})
        scored.sort(key=lambda x: -x["rerank_logit"])
        picks, per_work = [], {}
        for c in scored:
            if per_work.get(c["work_id"], 0) >= 2:
                continue
            picks.append(c)
            per_work[c["work_id"]] = per_work.get(c["work_id"], 0) + 1
            if len(picks) >= 5:
                break
        print(
            f"{e['id']}: top1={picks[0]['rerank_prob']:.3f} ({picks[0].get('ref') or picks[0]['work_id'][:24]}) "
            f"({time.time()-t0:.1f}s)",
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
                    "rerank_prob": c["rerank_prob"],
                    "rerank_logit": c["rerank_logit"],
                }
                for c in scored
            ],
        })
    out_path = f"rerank-qwen3-shard-{k}.json"
    Path(out_path).write_text(json.dumps(results, indent=1))
    print(f"wrote {out_path}", flush=True)


if __name__ == "__main__":
    main()
