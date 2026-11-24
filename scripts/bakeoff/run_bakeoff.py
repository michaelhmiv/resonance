#!/usr/bin/env python3
"""EmbeddingGemma 2 bake-off runner v2 — raw ONNX Runtime, no optimum /
sentence-transformers (their version drift killed attempts 1-2; driving the
model directly also gives exact control of the input recipe for packs).

Recipe: the model's own prompt templates are read from the repo's
config_sentence_transformers.json at runtime (never from memory). Mean
pooling over the attention mask, truncate to 512 dims, L2-normalize.
Spike mode asserts paraphrase geometry before any full run is trusted.
"""
import json, re, sys, time
from pathlib import Path
import numpy as np

MODE = sys.argv[1] if len(sys.argv) > 1 else "spike"
ROOT = Path(__file__).resolve().parents[2]
REPO = "onnx-community/embeddinggemma-2-ONNX"

def load():
    from huggingface_hub import hf_hub_download
    import onnxruntime as ort
    from transformers import AutoTokenizer
    cfg = json.loads(Path(hf_hub_download(REPO, "config_sentence_transformers.json")).read_text())
    prompts = cfg.get("prompts", {})
    print("model prompts:", prompts, flush=True)
    tok = AutoTokenizer.from_pretrained(REPO)
    import shutil
    d = Path("/tmp/eg2_model"); d.mkdir(exist_ok=True)
    for fn in ["onnx/model_quantized.onnx", "onnx/model_quantized.onnx_data"]:
        shutil.copy(hf_hub_download(REPO, fn), d / Path(fn).name)
    sess = ort.InferenceSession(str(d / "model_quantized.onnx"),
                                providers=["CPUExecutionProvider"])
    return tok, sess, prompts

def embed(tok, sess, texts, prefix, batch=32):
    out = []
    for i in range(0, len(texts), batch):
        chunk = [prefix + t for t in texts[i:i + batch]]
        enc = tok(chunk, padding=True, truncation=True, max_length=512, return_tensors="np")
        inputs = {inp.name: enc[inp.name] for inp in sess.get_inputs() if inp.name in enc}
        # Text-only run of the joint multimodal graph: modality feature
        # inputs are required by the signature but inert when the text
        # carries no media placeholder tokens. Feed zero-length features.
        for inp in sess.get_inputs():
            if inp.name in inputs: continue
            shape = []
            for j, d in enumerate(inp.shape):
                if isinstance(d, int): shape.append(d)
                elif j == 0: shape.append(len(chunk))
                else: shape.append(0)
            dt = np.float16 if "float16" in (inp.type or "") else np.float32
            inputs[inp.name] = np.zeros(shape, dtype=dt)
        res = sess.run(None, inputs)[0]
        if res.ndim == 3:  # token embeddings -> mean pool w/ mask
            mask = enc["attention_mask"][..., None].astype(np.float32)
            emb = (res * mask).sum(1) / mask.sum(1)
        else:
            emb = res
        out.append(emb[:, :512])
        if i and i % (batch * 100) == 0:
            print(f"  embedded {i:,}/{len(texts):,}", flush=True)
    v = np.concatenate(out).astype(np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)

def spike(tok, sess, prompts):
    sents = [
        "I am exhausted from being awake all night with the baby.",
        "I haven't slept properly since my daughter was born and I'm running on empty.",
        "The quarterly earnings report exceeded analyst expectations.",
        "Do not be anxious about tomorrow, for tomorrow will be anxious for itself.",
        "I keep worrying about money and what the future holds for my family.",
        "The recipe calls for two cups of flour and a teaspoon of salt.",
    ]
    e = embed(tok, sess, sents, prompts.get("query", ""))
    sim = e @ e.T
    print("paraphrase pair (0,1):", round(float(sim[0,1]), 3))
    print("unrelated pair  (0,2):", round(float(sim[0,2]), 3))
    print("thematic pair   (3,4):", round(float(sim[3,4]), 3))
    ok = sim[0,1] > sim[0,2] + 0.1 and sim[3,4] > sim[0,2]
    print("SPIKE:", "PASS" if ok else "FAIL", flush=True)
    return ok

def golden_queries():
    text = (ROOT / "docs/resonance/golden-set-v1.md").read_text()
    out = []
    for block in re.split(r"\n### ", text)[1:]:
        head = block.splitlines()[0].strip()
        m = re.search(r"\*\*Journal:\*\* \"(.+?)\"", block, re.S)
        if m: out.append({"id": head.split(" — ")[0], "title": head,
                          "journal": m.group(1).replace("\n", " ")})
    return out

def full(tok, sess, prompts):
    fname = "chunks_subset.jsonl" if MODE == "subset" else "chunks_v2.jsonl"
    pool = [json.loads(l) for l in (ROOT / f"corpus/{fname}").open()]
    print(f"pool ({fname}): {len(pool):,} passages", flush=True)
    t0 = time.time()
    emb = embed(tok, sess, [p["text"] for p in pool], prompts.get("document", ""), batch=64)
    print(f"pool embedded in {(time.time()-t0)/60:.1f} min", flush=True)
    queries = golden_queries()
    q = embed(tok, sess, [x["journal"] for x in queries], prompts.get("query", ""))
    sims = q @ emb.T
    def select(i):
        ranked = np.argsort(-sims[i])
        picked, per_work = [], {}
        def dup(j):
            ws = set(pool[j]["text"].lower().split())
            return any(len(ws & set(pool[k]["text"].lower().split())) / max(len(ws), 1) > 0.7 for k in picked)
        for j in ranked[:60]:
            if len(picked) >= 5: break
            if per_work.get(pool[j]["work_id"], 0) >= 2 or dup(int(j)): continue
            picked.append(int(j)); per_work[pool[j]["work_id"]] = per_work.get(pool[j]["work_id"], 0) + 1
        if not any(pool[j]["source"] == "bible" for j in picked):  # Scripture slot (spec SS6)
            bible = [int(j) for j in ranked[:15] if pool[j]["source"] == "bible"]
            if bible: picked[-1] = bible[0]
        return picked
    results = []
    for i, query in enumerate(queries):
        top = select(i)
        results.append({**query, "results": [
            {"rank": r + 1, "score": round(float(sims[i][j]), 4),
             "work_id": pool[j]["work_id"], "source": pool[j]["source"],
             "ref": pool[j]["chunk_id"] if pool[j]["source"] == "bible" else None,
             "text": pool[j]["text"][:600]} for r, j in enumerate(top)]})
    Path("bakeoff-results.json").write_text(json.dumps(results, indent=1))
    print("wrote bakeoff-results.json", flush=True)

def shard(tok, sess, prompts, k, n):
    pool = [json.loads(l) for l in (ROOT / "corpus/chunks_v2.jsonl").open()]
    lo, hi = k * len(pool) // n, (k + 1) * len(pool) // n
    part = pool[lo:hi]
    print(f"shard {k}/{n}: passages {lo:,}-{hi:,} ({len(part):,})", flush=True)
    order = sorted(range(len(part)), key=lambda i: len(part[i]["text"]))
    sorted_emb = embed(tok, sess, [part[i]["text"] for i in order],
                       prompts.get("document", ""), batch=64)
    emb = np.empty_like(sorted_emb)
    for pos, idx in enumerate(order): emb[idx] = sorted_emb[pos]
    np.save(f"shard_{k}.npy", emb)
    print(f"shard {k} saved {emb.shape}", flush=True)

def combine(tok, sess, prompts, n):
    pool = [json.loads(l) for l in (ROOT / "corpus/chunks_v2.jsonl").open()]
    emb = np.concatenate([np.load(f"shard_{k}.npy") for k in range(n)])
    assert emb.shape[0] == len(pool), (emb.shape, len(pool))
    print(f"combined pool embeddings {emb.shape}", flush=True)
    queries = golden_queries()
    q = embed(tok, sess, [x["journal"] for x in queries], prompts.get("query", ""))
    sims = q @ emb.T
    def select(i):
        ranked = np.argsort(-sims[i])
        picked, per_work = [], {}
        def dup(j):
            ws = set(pool[j]["text"].lower().split())
            return any(len(ws & set(pool[k]["text"].lower().split())) / max(len(ws), 1) > 0.7 for k in picked)
        for j in ranked[:60]:
            if len(picked) >= 5: break
            if per_work.get(pool[j]["work_id"], 0) >= 2 or dup(int(j)): continue
            picked.append(int(j)); per_work[pool[j]["work_id"]] = per_work.get(pool[j]["work_id"], 0) + 1
        if not any(pool[j]["source"] == "bible" for j in picked):  # Scripture slot (spec SS6)
            bible = [int(j) for j in ranked[:15] if pool[j]["source"] == "bible"]
            if bible: picked[-1] = bible[0]
        return picked
    results = []
    for i, query in enumerate(queries):
        top = select(i)
        results.append({**query, "results": [
            {"rank": r + 1, "score": round(float(sims[i][j]), 4),
             "work_id": pool[j]["work_id"], "source": pool[j]["source"],
             "ref": pool[j]["chunk_id"] if pool[j]["source"] == "bible" else None,
             "text": pool[j]["text"][:600]} for r, j in enumerate(top)]})
    Path("bakeoff-results.json").write_text(json.dumps(results, indent=1))
    print("wrote bakeoff-results.json", flush=True)

if __name__ == "__main__":
    tok, sess, prompts = load()
    if MODE == "spike":
        sys.exit(0 if spike(tok, sess, prompts) else 1)
    elif MODE == "shard":
        shard(tok, sess, prompts, int(sys.argv[2]), int(sys.argv[3]))
    elif MODE == "combine":
        combine(tok, sess, prompts, int(sys.argv[2]))
    else:
        full(tok, sess, prompts)
