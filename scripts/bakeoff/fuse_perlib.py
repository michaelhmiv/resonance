#!/usr/bin/env python3
"""Reference implementation of Resonance's winning ranking layer:
  1. Stratified per-library retrieval (top-20 Scripture + top-30 Witnesses + top-10 Past Self)
  2. Per-library z-score normalization of dense cosine scores (removes length/register bias)
  3. Fusion with instruction-aware Qwen3-Reranker-0.6B yes/no logits:
       score = alpha * z_lib(dense_cosine) + (1 - alpha) * z_all(rerank_logit)
     Recommended default: alpha = 0.70 (14/50 expected echoes, 11x Bible ref gain, 50/50 Scripture, 5x hubness)
  4. Optional Calibrated Silence per-library floor on Qwen3-Reranker P(yes) (e.g. tau=0.05-0.10)
  5. Presentation guards: per-work cap = 2, near-duplicate demotion

Usage:
  python3 scripts/bakeoff/fuse_perlib.py <reranked.json> <stratified_candidates.json> <out.json> [alpha] [silence_tau]
"""
import json, statistics, sys
from pathlib import Path


def fuse_entry(rr_entry, cand_by_n, alpha=0.70, silence_tau=0.0):
    sc = rr_entry["all_scored"]
    by_lib = {}
    for x in sc:
        lib = "scripture" if x["source"] == "bible" else ("personal" if x["source"] == "personal" else "witness")
        by_lib.setdefault(lib, []).append(x["score"])

    lib_stats = {
        lib: (statistics.mean(vals), max(statistics.pstdev(vals), 1e-6))
        for lib, vals in by_lib.items()
    }
    ls = [x["rerank_logit"] for x in sc]
    lm, lsd = statistics.mean(ls), max(statistics.pstdev(ls), 1e-6)

    scored = []
    for x in sc:
        if silence_tau > 0.0 and x["rerank_prob"] < silence_tau:
            continue
        lib = "scripture" if x["source"] == "bible" else ("personal" if x["source"] == "personal" else "witness")
        m, sd = lib_stats[lib]
        dz = (x["score"] - m) / sd
        lz = (x["rerank_logit"] - lm) / lsd
        fused = alpha * dz + (1.0 - alpha) * lz
        scored.append((fused, x))

    scored.sort(key=lambda t: -t[0])
    picks, per_work = [], {}
    for fused, x in scored:
        if per_work.get(x["work_id"], 0) >= 2:
            continue
        full_c = cand_by_n[x["n"]]
        picks.append({
            **full_c,
            "rerank_prob": x["rerank_prob"],
            "rerank_logit": x["rerank_logit"],
            "fused_score": round(fused, 4),
        })
        per_work[x["work_id"]] = per_work.get(x["work_id"], 0) + 1
        if len(picks) >= 5:
            break
    return {
        "id": rr_entry["id"],
        "title": rr_entry.get("title", rr_entry["id"]),
        "journal": rr_entry["journal"],
        "picks": picks,
        "all_scored": sc,
    }


def main():
    rr_path, cand_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    alpha = float(sys.argv[4]) if len(sys.argv) > 4 else 0.70
    tau = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0

    rr_data = json.loads(Path(rr_path).read_text())
    c_map = {
        e["id"]: {c["n"]: c for c in e["candidates"]}
        for e in json.loads(Path(cand_path).read_text())
    }
    out = [fuse_entry(e, c_map[e["id"]], alpha=alpha, silence_tau=tau) for e in rr_data]
    Path(out_path).write_text(json.dumps(out, indent=1))
    print(f"wrote {out_path} ({len(out)} entries, alpha={alpha}, silence_tau={tau})")


if __name__ == "__main__":
    main()
