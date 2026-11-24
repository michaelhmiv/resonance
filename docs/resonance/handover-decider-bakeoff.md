# Handover — decider-seat bake-off & retriever challengers

**Date:** 2026-11-24 · **From:** Jeff (Muse) · **Project home:** issue #53 · **Working branch:** `phase1-bootable-apk`

## The product in one paragraph

Resonance is a free, AGPLv3, offline-first Christian journaling app. A user writes a journal entry; the app surfaces 5 passages that genuinely speak to it, drawn from ~111,000 chunks of the Bible and public-domain Christian writers, plus the user's own past writings. It is **retrieval, not conversation**: a bi-encoder embeds the entry and retrieves a top-50 shortlist; a local "decider" model then selects/orders the final 5. Every word the user reads was written by a human (or is Scripture). Full constitution: `docs/resonance/principles.md`.

## Locked constraints — do not relitigate

- **Local-only runtime.** No cloud models or APIs in the product path. No generated text is ever shown to the user: no chat, no advice, no generated reflection questions/prompts. The decider only *selects* among presented candidates.
- **Quantized builds only** for anything tested or shipped (phone-class artifacts: Q4_K_M GGUF, int8 ONNX). Testing a cloud or full-precision stand-in invalidates the test — the seat is judged on the artifact that would actually ship.
- **Licenses** must permit redistribution inside a free AGPLv3 app. Read the actual license text; flag custom licenses explicitly.
- **One embedding model, one recipe, everywhere**; production embeddings are quantized-only (full precision exists only as a bake-off reference ceiling).
- GitHub operations via the `gh` CLI only. Heavy work runs on GitHub Actions, never on a local device.
- **Michael judges the results**: bake-offs are delivered as PDFs over the 50 golden entries (`docs/resonance/golden-set-v1.md`); he rules on which model holds each seat. Nothing is "done" without fresh run evidence.

## Decider-seat bake-off — IN FLIGHT, next actions are yours

**Candidates run:** `45381711987` (workflow `bakeoff-subset`, started 2026-11-24T11:10Z, still running at handover). It embeds the v3 subset (6,785 passages from `scripts/corpus/chunk_v3.py`, spec in `docs/resonance/chunking-spec.md`) and produces two artifacts: `bakeoff-results` (embedding-only lists with §6 guards: per-work cap 2, near-duplicate demotion, Scripture slot) and `bakeoff-candidates` (`bakeoff-candidates.json` — raw top-50 per golden entry).

**Contestants** (harnesses committed on `phase1-bootable-apk`):

1. **Gemma 3n E2B-it, Q4_K_M GGUF** (unsloth) — front-runner; same LiteRT family as the embedder. E4B is the stretch candidate if E2B's judgment is too weak. Harness: `scripts/bakeoff/rerank_decider.py`, workflow `rerank.yml` (10 shards × 5 entries, llama-server, JSON-schema-constrained picks).
2. **LiquidAI LFM3-1.7B, Q4_K_M GGUF** (official `LiquidAI/LFM3-1.7B-GGUF`) — ~1 GB at 4-bit. Same harness/workflow. ⚠️ License is the custom **LFM Open License v1.0** — must be read before any adoption, whatever the scores say.
3. **BAAI bge-reranker-v2-m3 cross-encoder, int8 ONNX** (`onnx-community/bge-reranker-v2-m3-ONNX`) — generates nothing; pure pair scoring. Harness: `scripts/bakeoff/rerank_crossencoder.py`, workflow `rerank-crossencoder.yml`. Applies the per-work cap of 2; no Scripture slot (that is a presentation guard and would apply equally to any winner in production).

**Do these in order:**

1. When run `45381711987` completes with success: `gh run download 45381711987` and verify `bakeoff-candidates.json` parses as 50 entries.
2. Dispatch all three reranks:
   - `gh workflow run rerank.yml -f candidates_run=45381711987 -f model=gemma3n-e2b-q4km`
   - `gh workflow run rerank.yml -f candidates_run=45381711987 -f model=lfm3-1.7b-q4km`
   - `gh workflow run rerank-crossencoder.yml -f candidates_run=45381711987`
3. When all three complete: download the `rerank-<model>-shard-*` artifacts (10 per LLM model) and `rerank-crossencoder`; merge each model's shards into one 50-entry result.
4. Build the **four-way comparison PDF**: embedding-only vs Gemma-decided vs LFM-decided vs BGE-decided, one section per golden entry, **G09 first**, then G01–G50. G09 is the canonical posture test — a writer seeking to forgive her mother; embedding-only ranked a bitterness/protest passage #1 (Job 9). The decider that fixes G09 without wrecking the good lists is the story of this test.
5. Deliver the PDF to Michael in the 🕊️ Resonance room and record his ruling on issue #53 (and in `principles.md` / `chunking-spec.md` if the ruling changes them).

Note: Jeff's 5-minute watchdog cron for this chain was **stood down at handover** (one driver per project). Watching run `45381711987` is now yours.

**Pending sub-decision:** Jeff's recommendation, recorded on #53, that the §6 Scripture slot fire only within a small score margin of the passage it displaces (v2 evidence: the blunt slot sometimes forced weak verses and evicted the best author hits). Michael has not ruled on the margin. Chunking spec §6 guard 5 (reader rerank) was added 2026-11-24.

**Embedder incumbency, for context:** EmbeddingGemma 2 (int8 ONNX standing in for the phone's LiteRT build) *earned* the retriever seat on this golden set — v1: Scripture in top-5 for only 5/50 entries (a chunking problem, since fixed); v2 with the v3 pipeline: 47/50. It is the incumbent by evidence, not by default.

## Retriever challenger — NOT STARTED (Michael: "worth checking out", 2026-11-24)

**Candidate pair:** `perplexity-ai/pplx-embed-v2-context-9b-preview` + `perplexity-ai/pplx-embed-v2-context-0.6b`. The 0.6B's card documents a **shared embedding space** with the 1024-dim MRL prefix of the 9B ("Documents can be embedded with one model and queried with another"), so: the 9B embeds the corpus offline at pack generation; the 0.6B (multimodal — text/images/visual documents) queries on the phone. Its distinguishing feature is **contextual chunk encoding**: chunks are encoded in document groups (non-overlapping), each vector absorbing surrounding context — aimed at our measured weakness of context-stripped chunks.

**Blockers and risks:**
- ⚠️ The 0.6B lists **no license** on Hugging Face (the 9B and the rest of the family are MIT). A bake-off needs no license; adoption does. Get Perplexity's clarification in writing before any ship decision.
- The 9B is a **preview**: its card warns embeddings should not be mixed with a future release's — packs built on it would need re-embedding when the final lands.
- Custom code (`trust_remote_code`), CUDA-oriented, no ONNX export. GitHub Actions standard runners are CPU-only, so the true asymmetric test needs a GPU decision.
- Production packs for the full 110,996-chunk corpus have **not** been generated yet — a challenger tested now costs a subset run; tested later it costs a re-embed. That timing is the main reason to run this soon.

**Staged plan (Jeff's recommendation):** Stage 1 — the 0.6B encodes *both* ends of the same 6,785-passage v3 subset (documents in work-groups for contextual mode; queries via its `encode_queries`), compare top-5s against EmbeddingGemma 2's v2 results on the 50 entries, PDF to Michael. Stage 2, only if Stage 1 is competitive — solve the GPU question for the real 9B-documents test.

**Also on the radar, not commitments:** SPLADE-style sparse encoders for hybrid semantic+keyword recall (SBERT ecosystem); late-interaction/multi-vector storage math is unfavorable on a phone; `Horizon-Labs/multilingual-reranker-small` (Apache-2.0, 141M) is a plausible future decider contestant. An external agent's report recommended swapping embedders to the pplx v1/late lines wholesale — Jeff audited it 2026-11-24: its read of the legacy June code was accurate, but the swap was **not** adopted; the seat changes only by golden-set evidence.

**Idea to spec, endorsed by Jeff, needs Michael's ruling:** "calibrated silence" — per-library confidence floors (Scripture / Witnesses / Past Self); a library with no candidate above its floor renders nothing instead of a forced weak pick. Draft it into the ranking spec alongside the decider result.

## Adjacent open items — don't lose these

- **PR #54** (Phase 1 bootable APK) is open; its remaining gate is Michael's Pixel device pass (A8–A11) via the Firebase App Tester invite, then merge.
- The literal `.litertlm` run / drift check against the ONNX bake-off runner is still owed before any pack generation.
- Author passages are not yet loaded into the Railway Postgres; full-corpus pack generation is future production work.
- Legacy June code (`scripts/library/reembed_pplx_4b.py`, `/api/embed` endpoints, `packages/core/src/llm.ts`, `apps/mobile/src/embedding/reflectionService.ts`) is superseded by the local-first rulings. Do not build on it.
