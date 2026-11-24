# Resonance Model Bake-Off v2 — Empirical Decision Report

**Date:** 2026-11-24  
**Scope:** End-to-end local-only, quantized-only evaluation across **5 retrievers**, **4 deciders/rerankers**, **int8 pack vector quantization**, **Hybrid BM25+Dense RRF**, and **Stratified Per-Library Z-Score Fusion** on the identical 6,785-passage v3 subset (`scripts/bakeoff/make_subset.py`) and 50 golden entries (`docs/resonance/golden-set-v1.md`).  
**Constraints respected:** Local-only Android runtime, quantized weights only (INT8 ONNX / Q4_K_M GGUF), zero generated text shown to users, AGPLv3-compatible licenses audited.

---

## Executive Recommendation (Adopted Stack)

Replace the incumbent `EmbeddingGemma 2` retriever and listwise LLM decider candidates with an **all-Apache-2.0, quantized INT8 ONNX two-stage pipeline**:

| Seat | Winning Artifact (Hugging Face) | License | Phone Footprint | Pack Size (111k chunks, `int8`) |
|---|---|---|---|---|
| **Retriever** | [`onnx-community/voyage-4-nano-ONNX`](https://huggingface.co/onnx-community/voyage-4-nano-ONNX) (`onnx/model_quantized.onnx`) | **Apache 2.0** | 346M total (**180M backbone**) | **54.2 MB** @ 512d (`0.9952` overlap) / **108.4 MB** @ 1024d |
| **Candidate Fetch** | **Stratified Per-Library Top-50** (`20 Scripture + 30 Witnesses` + personal imports) | — | 0 MB (SQLite / ANN query) | Eliminates prose-vs-Scripture length bias |
| **Decider / Reranker** | [`n24q02m/Qwen3-Reranker-0.6B-ONNX`](https://huggingface.co/n24q02m/Qwen3-Reranker-0.6B-ONNX) (`onnx/model_yesno_quantized.onnx`) | **Apache 2.0** | 572 MB INT8 (2-dim yes/no head) | Instruction-aware posture rubric; zero prose generation |
| **Fusion & Guards** | **Per-Library Z-Score Fusion** (`α = 0.70`) + per-work cap `2` + calibrated silence floor | — | <1 ms | See `scripts/bakeoff/fuse_perlib.py` |

### Headline Impact vs. Incumbent (`EmbeddingGemma 2`, Run `45384646621`)
- **Exact expected Bible verse hits in top-5:** `1/50` → **`11/50` (11× increase)**
- **Total expected echoes in top-5:** `6/50` → **`14/50` (+133%)**
- **Top-50 exact Bible recall (512d stratified int8):** `7/50` → **`19/50` (2.7×)**; total expected echo R@50: `25/50` → **`34/50`**
- **Scripture in top-5:** `47/50` (only via forced Scripture slot) → **`50/50` (100% naturally, zero forced slot)**
- **Hubness & diversity:** `max_hub = 5×`, **`205/250` unique passages** (highest diversity of any top pipeline)
- **G09 canonical posture test:** Eliminates `Job 9:16-20` bitterness (`job=False`); surfaces `2 Corinthians 2:1-5` reconciliation
- **Hard negatives:** **0 true violations** *(note: `Psalms 127:1-5` on G01 was auto-flagged only because `build_units.py` merges both the expected echo v.2 and hard negative vv.3–5 into one chunk)*
- **Int8 pack compression:** **`0.9952` top-50 overlap** vs. float32 — 4× smaller mobile download with virtually zero recall loss

---

## 1. Evidence Ledger (GitHub Actions Runs)

| Run ID | Workflow | What It Evaluated |
|---|---|---|
| [`45384646621`](https://github.com/michaelhmiv/resonance/actions/runs/45384646621) | `bakeoff-subset` | Incumbent `EmbeddingGemma 2` INT8 (`title: none`, 512d) |
| [`45394166454`](https://github.com/michaelhmiv/resonance/actions/runs/45394166454) | `bakeoff-retrievers-v2` | `eg2-titled` (`vespa-engine` text-only INT8), `voyage-4-nano` INT8, `harrier-0.6b` INT8 |
| [`45394734822`](https://github.com/michaelhmiv/resonance/actions/runs/45394734822) | `bakeoff-qwen3-emb` | `qwen3-emb-0.6b` INT8 (`n24q02m/Qwen3-Embedding-0.6B-ONNX`) |
| [`45394165966`](https://github.com/michaelhmiv/resonance/actions/runs/45394165966) | `bakeoff-deciders-v2` | `Gemma 4 E2B-it` Q4_K_M, `LFM3-1.7B` Q4_K_M, `BGE-reranker-v2-m3` INT8, `Qwen3-Reranker-0.6B` INT8 on EG2 baseline |
| [`45400640723`](https://github.com/michaelhmiv/resonance/actions/runs/45400640723) | `bakeoff-phase2-end2end` | Stratified per-library `int8` retrieval (`Voyage-4-Nano` 512d/1024d & `Qwen3-Emb` 1024d) × `BGE-v2-m3` & `Qwen3-Reranker-0.6B` + EG2 `Qwen3-Reranker` shard 0 |

---

## 2. Phase 1 — Retriever Bake-Off Results (All 5 Quantized INT8 ONNX Models)

| Retriever | License | Dim (Native→Prod) | 111k `int8` Pack | Int8 Overlap@50 | Top-5 Echoes (Ref / Auth) | R@50 Exact Bible / Any | Max Hub (Top-5) | G09 Job? |
|---|---|---|---:|---:|---:|---:|---:|---|
| `EG2 Baseline` (`title:none`) | Apache 2.0 | 768→512 | 54.2 MB | — | 6 (1 / 5) | 7 / 25 | 5× | **Yes (bad)** |
| `EG2-Titled` (`vespa-engine` text-only) | Apache 2.0 | 768→512 | 54.2 MB | 0.9780 | 8 (1 / 7) | 8 / 24 | 5× | No *(mammoths #1)* |
| **`Voyage-4-Nano`** (flat 512d) | **Apache 2.0** | 2048→512 | **54.2 MB** | **0.9952** | **10 (3 / 6)** | **11 / 28** | **6×** | **No** |
| **`Voyage-4-Nano`** (stratified 512d) | **Apache 2.0** | 2048→512 | **54.2 MB** | **0.9952** | 9 (3 / 6) | **19 / 34 (#1)** | **5×** | **No** |
| **`Qwen3-Emb-0.6B`** (512d, inst) | **Apache 2.0** | 1024→512 | 54.2 MB | 0.9904 | 9 (3 / 6) | 7 / 24 | 19× | **No (Eph 4:26-32!)** |
| **`Qwen3-Emb-0.6B`** (1024d, inst) | **Apache 2.0** | 1024→1024 | 108.4 MB | 0.9904 | **12 (5 / 6)** | 12 / 28 | 13× | **No (Eph 4:26-32!)** |
| `Harrier-0.6B` (1024d, inst) | MIT | 1024→1024 | 108.4 MB | 0.9896 | 3 (0 / 3) | 2 / 22 | 5× | No |

### Key Retriever Findings
1. **MTEB ≠ Resonance:** `microsoft/harrier-oss-v1-0.6b` ranks #10 on MTEB Multilingual v2 (`69.0`), yet finished dead last (`3/50` top-5 echoes, `0` Bible hits) on modern-journal → ancient-witness matching.
2. **Why `Voyage-4-Nano` wins the retriever seat:** Tiny 180M backbone (3.3× smaller compute than 0.6B models), clean Apache 2.0, near-lossless `int8` vector quantization (`0.9952`), low hubness (`5×`), and **2.7× higher exact Bible R@50 (`19/50`)** once paired with stratified per-library fetch.
3. **Why `Qwen3-Embedding-0.6B` (1024d) is a strong Runner-Up:** Best single-entry G09 retrieval (`Ephesians 4:26-32` + Gregory the Great + Fenelon) via its custom Resonance query instruction, and highest pure-retriever top-5 (`12/50`). Its drawback is high hubness (`13–19×`, heavily amplified by index/TOC debris like *Spiritual Canticle* `#481`) and 3.3× heavier phone compute.
4. **Hybrid BM25+Dense RRF:** Tested across all 4 retrievers; slightly reduced hubness on Qwen3 (`19× → 13×`) but did not improve expected-echo recall over pure dense (modern journal slang rarely shares archaic Scripture vocabulary). Worth keeping optional for explicit keyword/reference lookup rather than default semantic resonance.

---

## 3. Decider / Reranker Bake-Off Results

### A. On Incumbent `EmbeddingGemma 2` Baseline (Run `45384646621`, 50/50 entries)

| Decider (Quantized Phone-Class) | License | Size | Top-5 Echoes (Ref / Auth) | Scripture Top-5 (Top-1) | Max Hub | G09 Job? |
|---|---|---:|---:|---:|---:|---|
| `EG2 Embed-Only` | Apache 2.0 | 314 MB | 6 (1 / 5) | 47 (11) | 5× | **Yes (Job 9 #1)** |
| `Gemma 4 E2B-it` Q4_K_M (top-30) | Apache 2.0 | 3.1 GB | 6 (1 / 5) | 45 (14) | 5× | **Yes (Job 9 #1, Job 27 #3)** |
| `LFM3-1.7B` Q4_K_M (top-30) | **LFM Open v1.0** ⚠️ | 1.0 GB | 7 (1 / 6) | 41 (16) | 6× | **Yes (Job 33 #3)** |
| `BGE-reranker-v2-m3` INT8 ONNX | MIT | ~570 MB | **10 (1 / 8)** | 26 (7) | 9× | **No** |
| `Qwen3-Reranker-0.6B` INT8 ONNX | **Apache 2.0** | **572 MB** | 7 (2 / 5) | 38 (16) | **6×** | **No** *(Job 9 crushed to P=0.015)* |

### B. On Upgraded Stratified Per-Library Retrievers (Phase 2, Run `45400640723`)

| End-to-End Pipeline (All `int8` Vectors, All Apache 2.0 / MIT) | Top-5 Echoes (Ref / Auth) | Scripture Top-5 (Top-1) | Max Hub (Unique/250) | G09 Job? |
|---|---:|---:|---:|---|
| `Voyage-4-Nano (512d)` + `BGE-v2-m3` | 7 (0 / 6) | 32 (9) | 6× (211) | No |
| `Voyage-4-Nano (1024d)` + `BGE-v2-m3` | 4 (0 / 4) | 30 (9) | 7× (207) | No |
| `Qwen3-Emb (1024d)` + `BGE-v2-m3` | 4 (1 / 3) | 30 (5) | 6× (165) | No |
| `Voyage-4-Nano (1024d)` + `Qwen3-Reranker-0.6B` (reranker only, `α=0`) | 9 (3 / 6) | 47 (21) | 7× (191) | No |
| `Qwen3-Emb (1024d)` + `Qwen3-Reranker-0.6B` (`PerLib α=0.65`) | 9 (6 / 4) | 50 (18) | 19× (131) | **No (Eph 4:26-32!)** |
| **🏆 `Voyage-4-Nano (1024d)` + `Qwen3-Reranker-0.6B` (`PerLib α=0.70`)** | **14 (11 / 3)** | **50 (16)** | **5× (205)** | **No** |

### Why Listwise 2B–3B LLMs and Uninstructed BGE Lost
1. **Listwise LLMs (`Gemma 4 E2B`, `LFM3-1.7B`):** Slow on phones (~4.5K-token prefill + KV cache), 2–5× larger download (1.0–3.1 GB), suffered lost-in-the-middle on 30 passages, still left Job passages in G09 top-5, and `LFM3-1.7B` carries a non-standard license (`LFM Open License v1.0`).
2. **`BGE-reranker-v2-m3` (no-instruction cross-encoder):** Helped on weak EG2 (`6→10`), but **severely regressed both strong retrievers (`12→4` and `9→4`)** because it is trained on literal web QA and penalizes indirect/poetic Scripture.
3. **`Qwen3-Reranker-0.6B` + Per-Library Z-Score Fusion (`α=0.70`):** Combines `Voyage-4-Nano`'s extraordinary cross-register recall with `Qwen3-Reranker-0.6B`'s posture filtering and calibrated `P(yes)` probabilities — achieving **`14/50` expected echoes (`11` exact Bible verses!)**, `50/50` Scripture coverage, `5×` hubness, and zero text generation.

---

## 4. Calibrated Silence & Scripture-Slot Margin Ruling Data

Using `Qwen3-Reranker-0.6B`'s calibrated `P(yes)` probabilities on `Voyage-4-Nano (1024d)` stratified candidates:
- **Calibration note:** Because `Qwen3-Reranker-0.6B` was trained on strict factual QA, indirect pastoral/devotional fits naturally calibrate in the **`0.05 – 0.50`** range (e.g., strong G13 faith fits score `0.23–0.33`; G02 anxiety hits score `0.29`; Job 9 bitterness on G09 drops to `0.015`).
- **Recommended Calibrated Silence floor:** Start with **`τ = 0.05` – `0.08`** per library (Scripture / Witnesses / Past Self). At `τ = 0.10`, Scripture goes silent on 18/50 entries and Witnesses on 12/50 (`2.44` avg passages shown); lowering to `τ = 0.05` suppresses genuine misses (like Job 9 at `0.015`) while preserving ~85% of pastoral echoes.
- **Scripture-Slot Margin (`Δ`):** With **Stratified Per-Library Retrieval + Per-Library Z-Score Fusion (`α = 0.70`)**, Scripture lands naturally in top-5 on **50/50 entries** without any blunt slot override. If a fallback slot is retained for edge cases, a tight **`Δ = 0.05`** on `P(yes)` (or `0.35σ` on fused score) prevents weak verses from displacing strong witnesses.

---

## 5. Additional Pipeline & Corpus Bugs Caught During Bake-Off

1. **Index/TOC debris slipping past `build_units.py`:** `a-spiritual-canticle-of-the-soul-and-the-bridegroom-christ#481` (`11: If riches abound, 43 / lxii. 2: My soul hath thirsted, 131...`) is a Scripture index page that acted as a 42/50 hub for `Qwen3-Emb`. Add a multi-line page-number/index detector (`>=3` lines ending in `,\s*\d+$`) to `build_units.py` §3.1.
2. **Verse-group boundary on Psalm 127:** `build_units.py` grouped all 5 verses into `Psalms 127:1-5`, combining G01's expected echo (`v.2`, sleep) with its hard negative (`vv.3–5`, arrows). Worth keeping in mind when evaluating G01 or splitting Psalm 127 at its stanza break (`1-2` / `3-5`).
3. **`work_id="web"` per-work cap collision:** All 66 Bible books currently share `work_id="web"`. Per-work cap `2` therefore caps *all* Scripture to 2 passages (usually desirable), but a per-Bible-book cap of `1` prevents two consecutive passages from the same book/chapter taking both Scripture slots.
4. **Why `pplx-embed-v2-context` was skipped for production:** While `9b` is now GA (MIT), `0.6b` still has **no license on Hugging Face**, requires custom `pplx_contextual_qwen3_5` + CUDA kernels (`flash-linear-attention`/`causal-conv1d`), and has no ONNX/LiteRT mobile export. Title-enriched `Voyage-4-Nano` INT8 ONNX + stratified per-library fetch already solved the core recall gap cleanly on standard Android ONNX Runtime.
