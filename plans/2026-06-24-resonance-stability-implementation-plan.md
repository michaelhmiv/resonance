# Resonance Stability + Shared Architecture Implementation Plan

Date: 2026-06-24

## Current root causes

1. The app has a shared `DataLayer` contract, but only Word was meaningfully migrated. Journal/Patterns/Settings still have platform-specific implementations.
2. Web resonance depended on a non-deployed 389 MB vector file and returned empty placeholders when the vector file was missing.
3. `/api/embed` is still a hash-development endpoint, not a semantic model endpoint. Journal now calls `/api/resonance` with text directly so the fake vector endpoint is not part of the user-facing resonance path.
4. LLM routing used generic `LLM_MODEL`, which can be contaminated by other Hermes/project config. Resonance now uses `RESONANCE_LLM_MODEL` and defaults to `deepseek/deepseek-v4-pro`.
5. Mobile local model loading and web/premium cloud model selection were mixed in one model catalog. The mobile local model manager now refuses cloud-only DeepSeek and leaves that to the future cloud DataLayer.

## Implemented in this pass

- Web `WebDataLayer` no longer has empty stubs for journal loading/saving/deleting, resonance, local pattern calculations, calendar days, or LLM reflection methods.
- Mobile `MobileDataLayer` no longer returns null/empty placeholders for resonance/pattern/LLM methods; it delegates to existing local mobile services.
- Web resonance now has a transparent lexical fallback when semantic vectors are unavailable, returning non-empty Scripture/voice cards with a response `method` and `note` so it is not misrepresented as semantic search.
- Journal web page now calls `/api/resonance` with text directly instead of piping user text through the fake hash `/api/embed` route.
- DeepSeek V4 Pro is the default web/cloud LLM model via `RESONANCE_LLM_MODEL || deepseek/deepseek-v4-pro`.
- Settings and health endpoints now report DeepSeek defaults.
- Journal entry POST supports idempotent upsert by ID, which is required for future shared continuous-journal autosave.

## Remaining product-critical work

### Phase 1 — Real semantic resonance

- Quantize/shard `vectors_gte-small.bin` under deployable file-size limits.
- Add vector manifest with dimension, dtype, count, shard list, checksums, and passage row-order contract.
- Replace lexical fallback as primary path with semantic vector search once shards load.
- Replace `/api/embed` with a real GTE-small-compatible embedding implementation or remove it from user-facing paths entirely.
- Add relevance smoke tests for rest/anxiety/alone/grief prompts.

### Phase 2 — Complete shared screens

- Move Journal into `packages/screens` with continuous segments and autosave.
- Move Patterns into `packages/screens` with calendar + writing/reading history.
- Move Settings into `packages/screens` with real shared settings DataLayer methods.
- Prohibit screen-level direct DB/API imports except platform wrapper/adapter files.

### Phase 3 — Reader completeness

- Make cross-reference links navigate instead of no-op.
- Make library search results open their Library reading surface.
- Add Send to Journal from Word/Search/Resonance cards.
- Add reading history events so Patterns can reflect both writing and reading.
- Make bookmark semantics explicit: verse/chapter/library passage.

### Phase 4 — Premium/cloud stability

- Replace temporary JSON store with Supabase/Postgres + RLS.
- Add web premium auth check; web remains premium-only and no-signup for now.
- Add cloud mobile DataLayer for premium mobile users.
- Use project-specific env vars only (`RESONANCE_*`) for Resonance cloud behavior.

### Phase 5 — Package system

- Move package catalog out of absolute build paths.
- Implement real package install/uninstall/download/checksum/vector activation.
- Add package discovery surface from Word header/library icon.

## Verification performed in this pass

- `npm run typecheck:packages` passed.
- `npm run typecheck:mobile` passed.
- `npm run typecheck:web` passed.
- `npm run build` passed with existing benign Next/react-native-web warnings.
- Local built app smoke passed:
  - auth cookie creation
  - health reports DeepSeek model and transparent resonance fallback
  - settings reports `llmModel: deepseek-v4-pro`
  - `/api/reflect` returns text from `deepseek/deepseek-v4-pro`
  - `/api/resonance` returns non-empty Scripture + voice cards via fallback
  - journal upsert/fetch persists the smoke segment
