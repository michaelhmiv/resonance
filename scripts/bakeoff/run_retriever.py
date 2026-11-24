#!/usr/bin/env python3
"""Unified quantized ONNX retriever bake-off runner (phone-class int8 models).

Supports:
  - eg2-titled:     vespa-engine/embeddinggemma-2-ONNX (int8, text-only, Apache 2.0)
                    with real `title: {work} | text: {text}` metadata
  - qwen3-emb-0.6b: n24q02m/Qwen3-Embedding-0.6B-ONNX (int8, Apache 2.0, MRL 512/1024)
                    with Resonance custom query instruction
  - harrier-0.6b:   onnx-community/harrier-oss-v1-0.6b-ONNX (int8, MIT, 1024d)
                    with Resonance custom query instruction
  - voyage-4-nano:  onnx-community/voyage-4-nano-ONNX (int8, Apache 2.0, MRL 512/1024)

Modes:
  spike <model>
  shard <model> <k> <n>
  combine <model> <n>
"""
import json, math, re, shutil, sys, time
from collections import Counter
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]

RESONANCE_INSTRUCT = (
    "Given a personal journal entry expressing the writer's present struggle, "
    "emotion, or longing, retrieve Scripture or classic Christian spiritual passages "
    "that speak faithfully to the writer's emotional state, posture, and spiritual need."
)

MODELS = {
    "eg2-titled": {
        "repo": "vespa-engine/embeddinggemma-2-ONNX",
        "files": ["onnx/int8/model.onnx", "onnx/int8/model.onnx_data"],
        "entry": "model.onnx",
        "pooling": "mean",
        "output_pref": "sentence_embedding",
        "max_len": 512,
        "batch": 32,
        "mrl_dim": 512,
        "license": "apache-2.0",
    },
    "qwen3-emb-0.6b": {
        "repo": "n24q02m/Qwen3-Embedding-0.6B-ONNX",
        "files": ["onnx/model_quantized.onnx"],
        "entry": "model_quantized.onnx",
        "pooling": "last_token",
        "output_pref": None,
        "max_len": 512,
        "batch": 16,
        "mrl_dim": 512,
        "append_eos": True,
        "license": "apache-2.0",
    },
    "harrier-0.6b": {
        "repo": "onnx-community/harrier-oss-v1-0.6b-ONNX",
        "files": ["onnx/model_quantized.onnx", "onnx/model_quantized.onnx_data"],
        "entry": "model_quantized.onnx",
        "pooling": "last_token",
        "output_pref": None,
        "max_len": 512,
        "batch": 16,
        "mrl_dim": None,
        "append_eos": False,  # tokenizer.json TemplateProcessing already appends <|endoftext|>
        "license": "mit",
    },
    "voyage-4-nano": {
        "repo": "onnx-community/voyage-4-nano-ONNX",
        "files": ["onnx/model_quantized.onnx", "onnx/model_quantized.onnx_data"],
        "entry": "model_quantized.onnx",
        "pooling": "mean",
        "output_pref": "pooler_output",
        "max_len": 512,
        "batch": 32,
        "mrl_dim": 512,
        "license": "apache-2.0",
    },
}


def format_title(chunk):
    if chunk["source"] == "bible":
        return f"Bible — {chunk['chunk_id']}"
    wid = chunk["work_id"].split("__")[0].replace("-", " ").title()
    div = (chunk.get("division") or "").strip()
    if div:
        return f"{wid} — {div[:80]}"
    return wid


def format_query(model_key, text):
    if model_key == "eg2-titled":
        return f"task: search result | query: {text}"
    if model_key == "qwen3-emb-0.6b":
        return f"Instruct: {RESONANCE_INSTRUCT}\nQuery:{text}"
    if model_key == "harrier-0.6b":
        return f"Instruct: {RESONANCE_INSTRUCT}\nQuery: {text}"
    if model_key == "voyage-4-nano":
        return f"Represent the query for retrieving supporting documents: {text}"
    raise ValueError(model_key)


def format_doc(model_key, chunk):
    title = format_title(chunk)
    text = chunk["text"]
    if model_key == "eg2-titled":
        return f"title: {title} | text: {text}"
    if model_key in ("qwen3-emb-0.6b", "harrier-0.6b"):
        return f"[{title}]\n{text}"
    if model_key == "voyage-4-nano":
        return f"Represent the document for retrieval: [{title}]\n{text}"
    raise ValueError(model_key)


def load(model_key):
    from huggingface_hub import hf_hub_download
    import onnxruntime as ort
    from transformers import AutoTokenizer

    cfg = MODELS[model_key]
    tok = AutoTokenizer.from_pretrained(cfg["repo"])
    if cfg["pooling"] == "last_token":
        tok.padding_side = "left"
        if tok.pad_token is None and tok.eos_token is not None:
            tok.pad_token = tok.eos_token

    d = Path(f"/tmp/model_{model_key}")
    d.mkdir(parents=True, exist_ok=True)
    for fn in cfg["files"]:
        dst = d / Path(fn).name
        if not dst.exists():
            shutil.copy(hf_hub_download(cfg["repo"], fn), dst)

    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    so.intra_op_num_threads = 4
    sess = ort.InferenceSession(
        str(d / cfg["entry"]), sess_options=so, providers=["CPUExecutionProvider"]
    )
    print(
        f"loaded {model_key} ({cfg['repo']}): "
        f"inputs={[(i.name, i.shape, i.type) for i in sess.get_inputs()[:6]]} "
        f"(total {len(sess.get_inputs())}), "
        f"outputs={[(o.name, o.shape) for o in sess.get_outputs()]}",
        flush=True,
    )
    return tok, sess, cfg


def build_feeds(sess, enc):
    feeds = {}
    in_ids = enc["input_ids"].astype(np.int64)
    attn = enc["attention_mask"].astype(np.int64)
    bsz = in_ids.shape[0]
    for inp in sess.get_inputs():
        name = inp.name
        if name == "input_ids":
            feeds[name] = in_ids
        elif name == "attention_mask":
            feeds[name] = attn
        elif name == "token_type_ids":
            feeds[name] = enc.get("token_type_ids", np.zeros_like(in_ids)).astype(np.int64)
        elif name == "position_ids":
            pos = np.maximum(np.cumsum(attn, axis=1) - 1, 0).astype(np.int64)
            feeds[name] = pos
        else:
            # Handle optional KV-cache or empty modality tensors cleanly
            shape = []
            for j, dim in enumerate(inp.shape):
                if isinstance(dim, int):
                    shape.append(dim)
                elif j == 0:
                    shape.append(bsz)
                else:
                    shape.append(0)
            dt = np.float16 if "float16" in (inp.type or "") else np.float32
            feeds[name] = np.zeros(shape, dtype=dt)
    return feeds


def pool_output(sess, outs, enc, cfg):
    out_names = [o.name for o in sess.get_outputs()]
    pref = cfg.get("output_pref")
    if pref and pref in out_names:
        arr = outs[out_names.index(pref)]
        if arr.ndim == 2:
            return arr.astype(np.float32)

    # Otherwise pick the 3D hidden state (usually index 0)
    res = outs[0]
    if res.ndim == 2:
        return res.astype(np.float32)

    attn = enc["attention_mask"]
    if cfg["pooling"] == "last_token":
        left_pad = bool(attn[:, -1].all())
        if left_pad:
            emb = res[:, -1, :]
        else:
            idx = attn.sum(axis=1) - 1
            emb = res[np.arange(res.shape[0]), idx, :]
    else:
        mask = attn[..., None].astype(np.float32)
        emb = (res * mask).sum(axis=1) / np.maximum(mask.sum(axis=1), 1e-9)
    return emb.astype(np.float32)


def embed_texts(tok, sess, cfg, texts):
    # Detect static batch=1 graphs (e.g. n24q02m Qwen3-Embedding ONNX)
    inp0_b = sess.get_inputs()[0].shape[0]
    batch = 1 if (isinstance(inp0_b, int) and inp0_b == 1) else cfg["batch"]
    append_eos = cfg.get("append_eos", False) and tok.eos_token is not None

    out = []
    t0 = time.time()
    for i in range(0, len(texts), batch):
        chunk = texts[i : i + batch]
        if append_eos:
            eos = tok.eos_token
            chunk = [t if t.endswith(eos) else (t + eos) for t in chunk]
        enc = tok(
            chunk,
            padding=True,
            truncation=True,
            max_length=cfg["max_len"],
            return_tensors="np",
        )
        feeds = build_feeds(sess, enc)
        outs = sess.run(None, feeds)
        emb = pool_output(sess, outs, enc, cfg)
        out.append(emb)
        done = i + len(chunk)
        if done % 256 < batch or done == len(texts):
            rate = done / max(time.time() - t0, 1e-3)
            print(f"  embedded {done:,}/{len(texts):,} ({rate:.1f}/s)", flush=True)
    v = np.concatenate(out, axis=0).astype(np.float32)
    norms = np.linalg.norm(v, axis=1, keepdims=True)
    return v / np.maximum(norms, 1e-12)


def spike(model_key, tok, sess, cfg):
    queries = [
        "I am exhausted from being awake all night with the baby.",
        "I keep worrying about money and what the future holds for my family.",
        "Mom called and I want to forgive her without going numb.",
    ]
    docs = [
        {"source": "bible", "work_id": "web", "chunk_id": "Psalms 127:1-2", "division": None,
         "text": "It is vain for you to rise up early, to stay up late, eating the bread of toil; for he gives sleep to his loved ones."},
        {"source": "bible", "work_id": "web", "chunk_id": "Matthew 6:25-34", "division": None,
         "text": "Therefore I tell you, don't be anxious for your life: what you will eat, or what you will drink. Your heavenly Father knows that you need all these things."},
        {"source": "bible", "work_id": "web", "chunk_id": "Colossians 3:12-15", "division": None,
         "text": "Bearing with one another, and forgiving each other, if any man has a complaint against any; even as Christ forgave you, so you also do."},
        {"source": "ia", "work_id": "quarterly-earnings", "chunk_id": "q#0", "division": None,
         "text": "The quarterly earnings report exceeded analyst expectations with strong revenue growth across enterprise cloud segments."},
    ]
    qe = embed_texts(tok, sess, cfg, [format_query(model_key, q) for q in queries])
    de = embed_texts(tok, sess, cfg, [format_doc(model_key, d) for d in docs])
    sim = qe @ de.T
    print("SPIKE sim matrix (queries x [sleep, anxiety, forgive, earnings]):")
    for r, q in enumerate(queries):
        print(f"  q{r}: {[round(float(x), 3) for x in sim[r]]}")
    ok = (
        sim[0, 0] > sim[0, 3] + 0.08
        and sim[1, 1] > sim[1, 3] + 0.08
        and sim[2, 2] > sim[2, 3] + 0.08
    )
    print("SPIKE:", "PASS" if ok else "FAIL", flush=True)
    return ok


def golden_queries():
    text = (ROOT / "docs/resonance/golden-set-v1.md").read_text()
    out = []
    for block in re.split(r"\n### ", text)[1:]:
        head = block.splitlines()[0].strip()
        m = re.search(r'\*\*Journal:\*\* "(.+?)"', block, re.S)
        if m:
            out.append({
                "id": head.split(" — ")[0],
                "title": head,
                "journal": m.group(1).replace("\n", " "),
            })
    return out


def run_shard(model_key, k, n):
    tok, sess, cfg = load(model_key)
    if k == 0:
        if not spike(model_key, tok, sess, cfg):
            sys.exit(1)
    pool = [json.loads(l) for l in (ROOT / "corpus/chunks_subset.jsonl").open()]
    lo, hi = k * len(pool) // n, (k + 1) * len(pool) // n
    part = pool[lo:hi]
    print(f"{model_key} shard {k}/{n}: passages {lo:,}-{hi:,} ({len(part):,})", flush=True)
    formatted = [format_doc(model_key, p) for p in part]
    # Length-sort to minimize padding overhead on dynamic-batch models
    order = sorted(range(len(part)), key=lambda i: len(formatted[i]))
    sorted_emb = embed_texts(tok, sess, cfg, [formatted[i] for i in order])
    emb = np.empty_like(sorted_emb)
    for pos, idx in enumerate(order):
        emb[idx] = sorted_emb[pos]
    np.save(f"shard_{model_key}_{k}.npy", emb)
    print(f"saved shard_{model_key}_{k}.npy {emb.shape}", flush=True)


def bm25_scores(pool, queries):
    """Lightweight BM25 over pool (mirrors Android SQLite FTS5 hybrid scoring)."""
    stop = {
        "the", "and", "that", "this", "with", "for", "you", "your", "have", "from",
        "they", "will", "not", "are", "was", "were", "his", "her", "him", "she",
        "but", "all", "one", "had", "has", "out", "about", "just", "like", "what",
        "when", "into", "their", "them", "been", "would", "there", "more", "than",
    }
    def toks(s):
        return [w for w in re.findall(r"[a-z]{3,}", s.lower()) if w not in stop]

    docs = [toks(p["text"]) for p in pool]
    N = len(docs)
    df = Counter()
    lens = np.array([len(d) for d in docs], dtype=np.float32)
    avgdl = float(lens.mean()) if N else 1.0
    tfs = []
    for d in docs:
        c = Counter(d)
        tfs.append(c)
        for w in c:
            df[w] += 1

    k1, b = 1.5, 0.75
    out = np.zeros((len(queries), N), dtype=np.float32)
    for qi, q in enumerate(queries):
        qtoks = toks(q["journal"])
        for w in set(qtoks):
            if w not in df:
                continue
            idf = math.log(1.0 + (N - df[w] + 0.5) / (df[w] + 0.5))
            for di, c in enumerate(tfs):
                tf = c.get(w, 0)
                if tf:
                    out[qi, di] += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * lens[di] / avgdl))
    return out


def select_with_guards(pool, sims_row):
    ranked = np.argsort(-sims_row)
    picked, per_work = [], {}

    def dup(j):
        ws = set(pool[j]["text"].lower().split())
        return any(
            len(ws & set(pool[k]["text"].lower().split())) / max(len(ws), 1) > 0.7
            for k in picked
        )

    for j in ranked[:60]:
        if len(picked) >= 5:
            break
        if per_work.get(pool[j]["work_id"], 0) >= 2 or dup(int(j)):
            continue
        picked.append(int(j))
        per_work[pool[j]["work_id"]] = per_work.get(pool[j]["work_id"], 0) + 1
    if not any(pool[j]["source"] == "bible" for j in picked):
        bible = [int(j) for j in ranked[:15] if pool[j]["source"] == "bible"]
        if bible:
            picked[-1] = bible[0]
    return picked


def summarize_sims(pool, queries, sims, label):
    top5_hubs, top50_hubs = Counter(), Counter()
    scripture_top5, scripture_top1, scripture_top50 = 0, 0, 0
    s1_list, s50_list = [], []
    for i in range(len(queries)):
        ranked = np.argsort(-sims[i])
        s1_list.append(float(sims[i][ranked[0]]))
        s50_list.append(float(sims[i][ranked[49]]))
        picked = select_with_guards(pool, sims[i])
        if any(pool[j]["source"] == "bible" for j in picked):
            scripture_top5 += 1
        if pool[picked[0]]["source"] == "bible":
            scripture_top1 += 1
        if any(pool[j]["source"] == "bible" for j in ranked[:50]):
            scripture_top50 += 1
        for j in picked:
            top5_hubs[pool[j]["chunk_id"]] += 1
        for j in ranked[:50]:
            top50_hubs[pool[j]["chunk_id"]] += 1
    return {
        "variant": label,
        "scripture_top1": scripture_top1,
        "scripture_top5": scripture_top5,
        "scripture_top50": scripture_top50,
        "max_hub_top5": top5_hubs.most_common(1)[0][1] if top5_hubs else 0,
        "max_hub_top50": top50_hubs.most_common(1)[0][1] if top50_hubs else 0,
        "top5_hubs": top5_hubs.most_common(5),
        "top50_hubs": top50_hubs.most_common(5),
        "mean_top1_score": round(float(np.mean(s1_list)), 4),
        "mean_top50_score": round(float(np.mean(s50_list)), 4),
        "mean_gap_1_to_50": round(float(np.mean(np.array(s1_list) - np.array(s50_list))), 4),
    }


def quantize_int8_vectors(emb):
    """Per-vector symmetric int8 scalar quantization (simulates 57 MB mobile pack)."""
    scale = np.max(np.abs(emb), axis=1, keepdims=True) / 127.0
    q = np.clip(np.round(emb / np.maximum(scale, 1e-12)), -127, 127).astype(np.int8)
    dq = q.astype(np.float32) * scale
    dq /= np.maximum(np.linalg.norm(dq, axis=1, keepdims=True), 1e-12)
    return dq


def run_combine(model_key, n):
    tok, sess, cfg = load(model_key)
    pool = [json.loads(l) for l in (ROOT / "corpus/chunks_subset.jsonl").open()]
    emb_full = np.concatenate([np.load(f"shard_{model_key}_{k}.npy") for k in range(n)], axis=0)
    assert emb_full.shape[0] == len(pool), (emb_full.shape, len(pool))

    queries = golden_queries()
    q_full = embed_texts(tok, sess, cfg, [format_query(model_key, x["journal"]) for x in queries])

    # Choose primary deployment dimension (512d MRL if supported, else native)
    mrl = cfg.get("mrl_dim")
    if mrl and emb_full.shape[1] > mrl:
        emb_prod = emb_full[:, :mrl].copy()
        emb_prod /= np.maximum(np.linalg.norm(emb_prod, axis=1, keepdims=True), 1e-12)
        q_prod = q_full[:, :mrl].copy()
        q_prod /= np.maximum(np.linalg.norm(q_prod, axis=1, keepdims=True), 1e-12)
        prod_dim = mrl
    else:
        emb_prod, q_prod = emb_full, q_full
        prod_dim = emb_full.shape[1]

    sims_full = q_full @ emb_full.T
    sims_prod = q_prod @ emb_prod.T
    emb_int8 = quantize_int8_vectors(emb_prod)
    sims_int8 = q_prod @ emb_int8.T

    # Hybrid Dense + BM25 (FTS5-equivalent) via RRF
    bm25 = bm25_scores(pool, queries)
    sims_hybrid = np.zeros_like(sims_prod)
    for i in range(len(queries)):
        d_order = np.argsort(-sims_prod[i])
        b_order = np.argsort(-bm25[i])
        d_rank = np.empty(len(pool), dtype=np.int32)
        b_rank = np.empty(len(pool), dtype=np.int32)
        d_rank[d_order] = np.arange(1, len(pool) + 1)
        b_rank[b_order] = np.arange(1, len(pool) + 1)
        # Only boost BM25 when there is actually a lexical match (>0)
        b_term = np.where(bm25[i] > 0, 0.25 / (60.0 + b_rank), 0.0)
        sims_hybrid[i] = 0.75 / (60.0 + d_rank) + b_term

    # Measure top-50 overlap between float32 and int8 pack vectors
    ov_int8 = []
    ov_mrl = []
    for i in range(len(queries)):
        s_prod = set(np.argsort(-sims_prod[i])[:50].tolist())
        s_i8 = set(np.argsort(-sims_int8[i])[:50].tolist())
        s_full = set(np.argsort(-sims_full[i])[:50].tolist())
        ov_int8.append(len(s_prod & s_i8) / 50.0)
        ov_mrl.append(len(s_prod & s_full) / 50.0)

    def dump_outputs(sims_mat, suffix=""):
        results, cands = [], []
        for i, query in enumerate(queries):
            top5 = select_with_guards(pool, sims_mat[i])
            results.append({
                **query,
                "results": [
                    {
                        "rank": r + 1,
                        "score": round(float(sims_mat[i][j]), 4),
                        "work_id": pool[j]["work_id"],
                        "source": pool[j]["source"],
                        "ref": pool[j]["chunk_id"] if pool[j]["source"] == "bible" else None,
                        "division": pool[j].get("division"),
                        "text": pool[j]["text"][:600],
                    }
                    for r, j in enumerate(top5)
                ],
            })
            top50 = np.argsort(-sims_mat[i])[:50]
            cands.append({
                **query,
                "candidates": [
                    {
                        "n": r + 1,
                        "score": round(float(sims_mat[i][j]), 4),
                        "dense_score": round(float(sims_prod[i][j]), 4),
                        "work_id": pool[j]["work_id"],
                        "source": pool[j]["source"],
                        "ref": pool[j]["chunk_id"] if pool[j]["source"] == "bible" else None,
                        "division": pool[j].get("division"),
                        "text": pool[j]["text"][:1200],
                    }
                    for r, j in enumerate(top50)
                ],
            })
        Path(f"results-{model_key}{suffix}.json").write_text(json.dumps(results, indent=1))
        Path(f"candidates-{model_key}{suffix}.json").write_text(json.dumps(cands, indent=1))

    dump_outputs(sims_prod, "")
    dump_outputs(sims_hybrid, "-hybrid")

    metrics = {
        "model": model_key,
        "repo": cfg["repo"],
        "license": cfg["license"],
        "native_dim": int(emb_full.shape[1]),
        "prod_dim": int(prod_dim),
        "pack_size_111k_int8_mb": round(110996 * prod_dim / (1024 * 1024), 1),
        "top50_overlap_prod_vs_full": round(float(np.mean(ov_mrl)), 4),
        "top50_overlap_prod_vs_int8": round(float(np.mean(ov_int8)), 4),
        "variants": [
            summarize_sims(pool, queries, sims_full, f"full_{emb_full.shape[1]}d"),
            summarize_sims(pool, queries, sims_prod, f"prod_{prod_dim}d"),
            summarize_sims(pool, queries, sims_int8, f"int8_{prod_dim}d"),
            summarize_sims(pool, queries, sims_hybrid, f"hybrid_rrf_{prod_dim}d"),
        ],
    }
    Path(f"metrics-{model_key}.json").write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics, indent=2), flush=True)


if __name__ == "__main__":
    mode, model_key = sys.argv[1], sys.argv[2]
    if mode == "spike":
        tok, sess, cfg = load(model_key)
        sys.exit(0 if spike(model_key, tok, sess, cfg) else 1)
    elif mode == "shard":
        run_shard(model_key, int(sys.argv[3]), int(sys.argv[4]))
    elif mode == "combine":
        run_combine(model_key, int(sys.argv[3]))
    else:
        raise ValueError(mode)
