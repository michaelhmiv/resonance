#!/usr/bin/env python3
"""EmbeddingGemma 2 bake-off runner (GitHub Actions).

Spike mode: embed 10 sentences, verify paraphrase geometry (the pipeline is
only 'working' if paraphrases land closer than unrelated pairs).
Full mode: embed the chunks_v2 pool + the 50 golden-set queries, cosine
top-5 per query -> results.json.

Runner: sentence-transformers over the official ONNX int8 build. The LiteRT
.litertlm path is attempted first in spike mode and its outcome logged; the
production pack pipeline decision rides on that log line.
"""
import json, re, sys, time
from pathlib import Path
import numpy as np

MODE = sys.argv[1] if len(sys.argv) > 1 else "spike"
ROOT = Path(__file__).resolve().parents[2]

def try_litert():
    try:
        import litert_lm  # noqa
        return "litert_lm importable"
    except Exception as e:
        return f"litert_lm unavailable: {type(e).__name__}"

def load_model():
    from sentence_transformers import SentenceTransformer
    t0 = time.time()
    model = SentenceTransformer(
        "onnx-community/embeddinggemma-2-ONNX", backend="onnx",
        model_kwargs={"file": "model_quantized.onnx"},
        truncate_dim=512)
    model.max_seq_length = 512
    print(f"model loaded in {time.time()-t0:.1f}s; dim=512 (truncated, renormalized by ST)", flush=True)
    return model

def spike(model):
    sents = [
        "I am exhausted from being awake all night with the baby.",
        "I haven't slept properly since my daughter was born and I'm running on empty.",
        "The quarterly earnings report exceeded analyst expectations.",
        "Do not be anxious about tomorrow, for tomorrow will be anxious for itself.",
        "I keep worrying about money and what the future holds for my family.",
        "The recipe calls for two cups of flour and a teaspoon of salt.",
    ]
    emb = model.encode(sents, prompt_name="query", normalize_embeddings=True)
    sim = emb @ emb.T
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
        if m: out.append({"id": head.split(" — ")[0], "title": head, "journal": m.group(1).replace("\n", " ")})
    return out

def full(model):
    pool = [json.loads(l) for l in (ROOT / "corpus/chunks_v2.jsonl").open()]
    print(f"pool: {len(pool):,} passages", flush=True)
    t0 = time.time()
    emb = model.encode([p["text"] for p in pool], prompt_name="document",
                       batch_size=64, normalize_embeddings=True, show_progress_bar=False)
    print(f"pool embedded in {(time.time()-t0)/60:.1f} min", flush=True)
    np.save("/tmp/pool_emb.npy", emb)
    queries = golden_queries()
    print(f"queries: {len(queries)}", flush=True)
    q = model.encode([x["journal"] for x in queries], prompt_name="query",
                     normalize_embeddings=True)
    sims = q @ emb.T
    results = []
    for i, query in enumerate(queries):
        top = np.argsort(-sims[i])[:5]
        results.append({**query, "results": [
            {"rank": r + 1, "score": round(float(sims[i][j]), 4),
             "work_id": pool[j]["work_id"], "source": pool[j]["source"],
             "ref": pool[j]["chunk_id"] if pool[j]["source"] == "bible" else None,
             "text": pool[j]["text"][:600]} for r, j in enumerate(top)]})
    Path("bakeoff-results.json").write_text(json.dumps(results, indent=1))
    print("wrote bakeoff-results.json", flush=True)

if __name__ == "__main__":
    print("litert check:", try_litert(), flush=True)
    m = load_model()
    if MODE == "spike":
        sys.exit(0 if spike(m) else 1)
    full(m)
