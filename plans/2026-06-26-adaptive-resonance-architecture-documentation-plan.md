# Adaptive Resonance Architecture + Documentation Implementation Plan

> **For Hermes:** Use `subagent-driven-development` skill to implement this plan task-by-task after Michael approves the architecture. Do not code from memory; re-audit the touched files before each phase.

**Goal:** Document and then implement a flexible, event-sourced resonance mechanism where journal entries, highlights, notes, reading behavior, and newly added books all contribute to a unified but non-stale understanding of Scripture, Christian voices, and everyday life.

**Architecture:** Store durable facts as events/nodes; store interpretive relationships as provisional edges with evidence, confidence, status, reinforcement, and decay. New content is embedded once, cached, and incorporated through candidate retrieval + graph-aware reranking rather than full vector rescans on every `✦` interaction.

**Tech Stack:** Next.js app routes in `apps/web/app/api/*`, Supabase/Postgres + pgvector migrations in `supabase/migrations`, shared DataLayer/types in `packages/core/src/*`, web adapter in `apps/web/lib/client-data-layer.ts`, journal/reading UI in `packages/screens/src/*`, corpus/book scripts in `scripts/library/*`.

---

## Non-Negotiable Design Principles

1. **Events are durable; interpretations are provisional.**
   - Durable: journal text, highlight created, note text, passage read, resonance opened/saved/dismissed, book added.
   - Provisional: theme labels, inferred concerns, semantic links, “season” names, candidate echoes.

2. **Never store identity claims.**
   - Wrong: `user_is_anxious = true`.
   - Right: `theme_snapshot(label='trust and tomorrow', window='2026-06-19..2026-06-26', evidence=[...])`.

3. **User action outranks model guess.**
   - Highlight, note, save, dismiss, and repeat visits must change ranking more than raw embedding similarity.

4. **New books enter future resonance immediately and past resonance selectively.**
   - Do not rewrite all history when a corpus changes.
   - Backfill recent/high-signal contexts first; lazily recompute older entries when opened.

5. **UI stays humble.**
   - Prefer “This echoes…” / “Recently…” / “You returned to…”
   - Avoid “You are…” / “Your spiritual state is…” / fixed diagnosis language.

6. **Documentation is part of implementation.**
   - Future agents must be able to read the repo and understand the full mechanism without reconstructing it from chat history.

---

## Current-State Findings This Plan Builds On

From the live audit on 2026-06-26:

| Area | Current state |
|---|---|
| Railway deployment | Healthy; latest web deployment success at commit `24d8298` |
| Vector model | `/data/vectors/pplx-embed-v1-4b/vectors.bin`, 647 MB, 265,068 rows |
| Current resonance route | Streams/scores the full vector file per semantic request |
| Journal UX | Auto-loads resonance for all text entries on first paint |
| Cache issue | Module-level `modelCache` has no in-flight promise, so cold concurrent requests duplicate model load/norm work |
| Manifest issue | Active pplx manifest lacks `passage_ids` / `passage_sources`; route falls back to old sidecar alignment |
| Supabase issue | `ensureHighlightVectorsTable()` calls missing `run_sql` RPC in hot path and logs 404s |
| Existing schema | Basic `profiles`, `journal_entries`, `highlights`, `bookmarks`, `settings`, `highlight_vectors` |
| Existing docs | Plans exist under `plans/`; no dedicated architecture docs directory yet |

---

## Documentation Map to Add

Create a first-class documentation set under `docs/resonance/`:

```text
docs/resonance/
  README.md
  principles.md
  data-model.md
  event-flow.md
  adaptive-ranking.md
  refresh-timing.md
  corpus-ingestion.md
  anti-staleness.md
  api-contracts.md
  operational-runbook.md
  agent-guide.md
```

### Purpose of each doc

| File | Purpose |
|---|---|
| `README.md` | Entry point: what Resonance is, how the pieces fit together |
| `principles.md` | Product/architecture constitution: curation, humility, no stale identity claims |
| `data-model.md` | Tables/types: nodes, embeddings, events, edges, snapshots, cache |
| `event-flow.md` | What happens on journal created, highlight created, note updated, book added |
| `adaptive-ranking.md` | Scoring/reranking formula and how user actions reinforce or suppress edges |
| `refresh-timing.md` | Timing model: immediate writes, queued jobs, lazy refresh, scheduled maintenance |
| `corpus-ingestion.md` | How books/passages are added, embedded, versioned, and backfilled |
| `anti-staleness.md` | Decay, expiry, snapshots, candidate/active/dormant lifecycle |
| `api-contracts.md` | API endpoints and response shapes, especially resonance job/cache routes |
| `operational-runbook.md` | Railway/Supabase/vector operational checks and safe diagnostics |
| `agent-guide.md` | Must-read instructions for future agents before modifying resonance mechanics |

---

## Target Data Model

### Durable source tables

These are source-of-truth records.

```text
journal_entries
highlights
bookmarks
reading_events
user_settings
canonical passages/books on volume or DB
```

### New adaptive resonance tables

```sql
resonance_nodes
resonance_embeddings
resonance_events
resonance_edges
resonance_result_cache
theme_snapshots
corpus_versions
book_ingestion_jobs
resonance_jobs
```

### Core lifecycle

```text
user action / corpus event
→ resonance_event
→ node creation/update
→ embedding generation when needed
→ candidate retrieval
→ graph-aware reranking
→ candidate edges
→ result cache
→ UI reads cached result
→ user interaction reinforces/dismisses edges
```

---

## Phase 0 — Documentation Foundation First

**Objective:** Add architecture docs before implementation so future agents understand what they are building and why.

**Files:**
- Create: `docs/resonance/README.md`
- Create: `docs/resonance/principles.md`
- Create: `docs/resonance/data-model.md`
- Create: `docs/resonance/event-flow.md`
- Create: `docs/resonance/adaptive-ranking.md`
- Create: `docs/resonance/corpus-ingestion.md`
- Create: `docs/resonance/anti-staleness.md`
- Create: `docs/resonance/api-contracts.md`
- Create: `docs/resonance/operational-runbook.md`
- Create: `docs/resonance/agent-guide.md`
- Modify: `AUTHOR_LIBRARY.md` or root `README.md` if a root entry point exists; otherwise create `README.md` with a docs pointer.

### Task 0.1: Create docs directory and README

**What to build:**
- `docs/resonance/README.md` explaining:
  - Resonance is a living concordance, not a chatbot.
  - Canonical content + personal events + adaptive relation layer.
  - Where code lives.
  - Which docs to read before editing.

**Acceptance:**
- A new agent can open `docs/resonance/README.md` and know where to go next.

### Task 0.2: Write design principles doc

**What to build:**
- `docs/resonance/principles.md` with the non-negotiables:
  - curation, not generation
  - events durable, interpretations provisional
  - no identity labels
  - user action outranks model guess
  - old data becomes context/contrast, not current truth
  - no request-time full universe recomputation as final architecture

**Acceptance:**
- The doc explicitly forbids stale labels like “user is anxious.”
- The doc gives approved UI language examples.

### Task 0.3: Write data model doc

**What to build:**
- `docs/resonance/data-model.md` documenting each target table:
  - purpose
  - durable vs derived
  - key columns
  - lifecycle
  - deletion/privacy behavior

**Acceptance:**
- Includes schema sketches for `resonance_nodes`, `resonance_embeddings`, `resonance_events`, `resonance_edges`, `resonance_result_cache`, `theme_snapshots`, `corpus_versions`, `book_ingestion_jobs`, `resonance_jobs`.

### Task 0.4: Write event-flow doc

**What to build:**
- `docs/resonance/event-flow.md` with sequence diagrams/bullets for:
  - `journal.created`
  - `journal.updated`
  - `highlight.created`
  - `highlight.note_updated`
  - `resonance.opened`
  - `resonance.saved`
  - `resonance.dismissed`
  - `book.added`
  - `book.completed`

**Acceptance:**
- Each flow states which data is written synchronously and which work is background/deferred.

### Task 0.5: Write adaptive ranking doc

**What to build:**
- `docs/resonance/adaptive-ranking.md` describing ranking inputs:
  - semantic similarity
  - highlight/note affinity
  - reading context
  - recent reinforcement
  - repeated suggestion penalty
  - dismissed penalty
  - staleness penalty
  - diversity bonus

**Acceptance:**
- Includes a clear formula-like pseudocode block.
- Explains why ranking is evidence-based, not a spiritual diagnosis.

### Task 0.6: Write refresh timing doc

**What to build:**
- `docs/resonance/refresh-timing.md` covering:
  - what writes happen synchronously
  - what work is queued near-real-time
  - what refreshes lazily on open
  - what runs on a daily/weekly schedule
  - why the system does not recompute everything on each entry or `✦` tap

**Acceptance:**
- Explicitly defines a hybrid event + queue + scheduled maintenance model.
- Includes recommended schedules for job processing, decay, theme snapshots, and corpus backfill.

### Task 0.7: Write corpus ingestion doc

**What to build:**
- `docs/resonance/corpus-ingestion.md` covering:
  - book metadata validation
  - chunking
  - front-matter filtering
  - embedding once
  - corpus versioning
  - future-aware immediate search
  - selective backfill of recent/high-signal user nodes
  - lazy historical recompute

**Acceptance:**
- Explicitly says not to recompute the entire user history when a book is added.

### Task 0.8: Write anti-staleness doc

**What to build:**
- `docs/resonance/anti-staleness.md` defining:
  - candidate → active → reinforced → dormant → dismissed lifecycle
  - expiry and half-life rules
  - time-windowed theme snapshots
  - how old data becomes contrast

**Acceptance:**
- Includes examples of stale-vs-safe language.

### Task 0.9: Write operational docs and agent guide

**What to build:**
- `docs/resonance/operational-runbook.md`:
  - safe Railway checks
  - vector status checks
  - Supabase schema checks
  - no destructive probes
  - no `railway up`
- `docs/resonance/agent-guide.md`:
  - files to read before editing
  - common traps from this audit
  - required verification commands

**Acceptance:**
- Agent guide says to read `docs/resonance/*` and the `resonance-app` skill before editing resonance mechanics.

**Phase 0 verification:**

```bash
cd /data/resonance
find docs/resonance -maxdepth 1 -type f -print | sort
npm run typecheck:web
npm run typecheck:packages
```

Expected:
- All docs files exist.
- Typechecks remain green because docs-only changes should not affect code.

---

## Phase 0 Completion Ledger — 2026-06-26

**Status:** Implemented locally; pending review/commit.

**Files created:**

- `README.md` — root pointer to architecture docs and core commands.
- `docs/resonance/README.md` — architecture overview and code map.
- `docs/resonance/principles.md` — non-negotiable product/architecture principles.
- `docs/resonance/data-model.md` — target adaptive resonance data model.
- `docs/resonance/event-flow.md` — event-driven flows for journal/highlight/book changes.
- `docs/resonance/adaptive-ranking.md` — ranking factors and edge lifecycle behavior.
- `docs/resonance/refresh-timing.md` — immediate writes, queued jobs, lazy refresh, scheduled maintenance.
- `docs/resonance/corpus-ingestion.md` — book ingestion, corpus versioning, selective backfill.
- `docs/resonance/anti-staleness.md` — decay, snapshots, candidate/active/dormant semantics.
- `docs/resonance/api-contracts.md` — current and target resonance API contracts.
- `docs/resonance/operational-runbook.md` — safe live/Railway/vector verification patterns.
- `docs/resonance/agent-guide.md` — required reading and pitfalls for future agents.

**Verification run:**

```bash
cd /data/resonance
find docs/resonance -maxdepth 1 -type f -print | sort
npm run typecheck:web
npm run typecheck:packages
npm run build --workspace=@resonance/web
```

**Actual result:**

- `find docs/resonance ...` listed all 11 expected docs.
- `npm run typecheck:web` passed.
- `npm run typecheck:packages` passed.
- `npm run build --workspace=@resonance/web` passed; Next generated all 38 static/dynamic routes successfully.

**Completion notes:**

- The docs explicitly encode the anti-staleness contract: durable events vs provisional interpretations.
- Future agents now have a root README and a dedicated `docs/resonance/agent-guide.md` before touching resonance mechanics.
- No app code, schema, Railway settings, or runtime behavior changed in Phase 0.

---

## Phase 1 — Schema: Event-Sourced Adaptive Resonance Tables

**Objective:** Add database structures that separate durable events from provisional interpretations.

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_adaptive_resonance_memory.sql`
- Create/Modify docs: `docs/resonance/data-model.md` with final schema details after migration is written.

### Task 1.1: Add `resonance_nodes`

**What to build:**
- A table for any meaningful object:
  - `scripture_passage`
  - `voice_passage`
  - `journal_entry`
  - `highlight`
  - `note`
  - `book`
  - `theme_snapshot`
  - `reading_event`
- Include `user_id nullable`, `canonical_ref`, `source_table`, `source_id`, `text`, `is_canonical`, `metadata jsonb`, timestamps.

**Acceptance:**
- Unique guard prevents duplicate node for same `source_table/source_id/type`.

### Task 1.2: Add `resonance_embeddings`

**What to build:**
- Embeddings table with:
  - `node_id`
  - `model_id`
  - `dim`
  - `content_hash`
  - vector column initially sized for active web model if pgvector supports it.

**Acceptance:**
- Same node can later have embeddings from multiple models.

### Task 1.3: Add `resonance_events`

**What to build:**
- Event table for user/corpus actions:
  - `journal.created`, `journal.updated`, `highlight.created`, `highlight.note_updated`, `resonance.opened`, `resonance.saved`, `resonance.dismissed`, `book.added`, etc.

**Acceptance:**
- Events are append-only except privacy/delete workflows.

### Task 1.4: Add `resonance_edges`

**What to build:**
- Provisional relationship table with:
  - `from_node_id`, `to_node_id`
  - relation enum/check
  - score, confidence
  - evidence_kind
  - status
  - evidence jsonb
  - created/reinforced/expires timestamps

**Acceptance:**
- Unique-ish protection for duplicate relation between same nodes and relation/evidence kind.

### Task 1.5: Add caches/jobs/version tables

**What to build:**
- `resonance_result_cache`
- `theme_snapshots`
- `corpus_versions`
- `book_ingestion_jobs`
- `resonance_jobs`

**Acceptance:**
- Cache keys include `source_node_id`, `content_hash`, `embedding_model_id`, and `corpus_version_id`.

### Task 1.6: Add RLS/service-role policies

**What to build:**
- Follow existing migration style: enable RLS and grant service role full access.
- Keep user boundaries explicit via `user_id` even though API uses service role today.

**Acceptance:**
- Migration mirrors current policy conventions without relying on missing `run_sql` RPC.

**Phase 1 verification:**

```bash
cd /data/resonance
npm run typecheck:web
npm run typecheck:packages
```

If Supabase CLI is available and configured:

```bash
npx supabase db diff --linked
```

Expected:
- Migration parses.
- Typechecks green.

---

## Phase 2 — Core Types and Contracts

**Objective:** Make the adaptive resonance mechanism visible in shared TypeScript types and DataLayer contracts.

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/data-layer.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/resonance-memory.ts`
- Update docs: `docs/resonance/api-contracts.md`, `docs/resonance/data-model.md`

### Task 2.1: Add shared resonance memory types

**What to build:**
- Types for:
  - `ResonanceNodeType`
  - `ResonanceEventType`
  - `ResonanceRelationType`
  - `ResonanceEdgeStatus`
  - `ResonanceEvidenceKind`
  - `ResonanceObservation`
  - `ThemeSnapshot`
  - `CorpusVersion`

**Acceptance:**
- Exported from `packages/core/src/index.ts`.

### Task 2.2: Extend `ResonanceResult`

**What to build:**
- Add optional metadata fields without breaking existing UI:
  - `sourceNodeId?`
  - `cacheStatus?: 'fresh' | 'stale' | 'pending'`
  - `corpusVersion?`
  - `generatedAt?`
  - `evidence?`

**Acceptance:**
- Existing renderers continue to compile.

### Task 2.3: Extend DataLayer with event/result methods

**What to build:**
- Add optional methods:
  - `recordResonanceOpened(sourceId, targetId)`
  - `recordResonanceSaved(sourceId, targetId)`
  - `recordResonanceDismissed(sourceId, targetId)`
  - `getCachedResonanceForSegment(segmentId)`
  - `enqueueResonanceForSegment(segmentId)`

**Acceptance:**
- Optional to avoid breaking mobile immediately.
- Docs explain web implements first; mobile can no-op until local graph exists.

**Phase 2 verification:**

```bash
cd /data/resonance
npm run typecheck:packages
npm run typecheck:web
```

Expected: both pass.

---

## Phase 3 — Web Persistence Helpers

**Objective:** Add server-side helpers for nodes, events, embeddings, edges, and cache without changing UI behavior yet.

**Files:**
- Create: `apps/web/lib/resonance/memory.ts`
- Create: `apps/web/lib/resonance/hash.ts`
- Create: `apps/web/lib/resonance/ranking.ts`
- Create: `apps/web/lib/resonance/cache.ts`
- Modify: `apps/web/lib/db.ts` only if needed, keeping generic DB functions out of hot resonance logic.
- Update docs: `docs/resonance/event-flow.md`, `docs/resonance/adaptive-ranking.md`

### Task 3.1: Content hashing helper

**What to build:**
- Stable hash for text + node type + source id.

**Acceptance:**
- Same text yields same hash; changed text invalidates embedding/cache.

### Task 3.2: Node upsert helpers

**What to build:**
- `upsertJournalNode(entry)`
- `upsertHighlightNode(highlight)`
- `upsertNoteNode(highlightWithNote)`
- `upsertCanonicalPassageNode(...)` as needed.

**Acceptance:**
- Helpers are idempotent.

### Task 3.3: Event append helpers

**What to build:**
- Append-only event helpers for journal/highlight/resonance/book actions.

**Acceptance:**
- No helper writes interpretive labels as durable facts.

### Task 3.4: Edge helpers

**What to build:**
- `createCandidateEdge`
- `reinforceEdge`
- `dismissEdge`
- `decayEdges` function, callable later from cron/job.

**Acceptance:**
- Edge status lifecycle matches docs.

### Task 3.5: Cache helpers

**What to build:**
- `getResonanceCache(sourceNodeId, contentHash, corpusVersion)`
- `setResonanceCache(...)`
- `markCacheStaleForNode(...)`

**Acceptance:**
- Cache can be stale without blocking UI.

**Phase 3 verification:**

```bash
cd /data/resonance
npm run typecheck:web
npm run build --workspace=@resonance/web
```

Expected: green build.

---

## Phase 4 — Fix Current Hot-Path Performance Before Full Graph Rollout

**Objective:** Stop the current loading problem even before the full adaptive graph is complete.

**Files:**
- Modify: `packages/screens/src/journal/JournalScreen.tsx`
- Modify: `apps/web/app/api/resonance/route.ts`
- Possibly modify: `apps/web/lib/client-data-layer.ts`
- Update docs: `docs/resonance/operational-runbook.md`

### Task 4.1: Stop all-entry auto-resonance fan-out

**What to build:**
- Auto-load only the top/newest visible entry, or disable auto-load and make `✦` user-triggered.
- Keep user experience clear: `✦` can show “Find resonance” / “Finding resonance…”

**Acceptance:**
- Loading journal does not fire one resonance request per historical entry.

### Task 4.2: Add in-flight model load promise

**What to build:**
- In `apps/web/app/api/resonance/route.ts`, guard `loadModel()` with a module-level promise so concurrent cold requests share the same model load.

**Acceptance:**
- Cold concurrent requests should log one model-load operation, not five.

### Task 4.3: Remove schema migration from hot resonance request

**What to build:**
- Stop calling `ensureHighlightVectorsTable()` on every `/api/resonance` request.
- Replace with a one-time best-effort probe or move schema creation entirely to migration.

**Acceptance:**
- Live logs no longer spam missing `run_sql` during resonance.

### Task 4.4: Repair active vector manifest alignment

**What to build:**
- Ensure active pplx manifest has `passage_ids` and `passage_sources`, or document why sidecar remains temporary.
- This should be done with safe upload procedures only after approval.

**Acceptance:**
- `/api/admin/diag-manifest` reports `has_passage_ids: true` and `passage_ids_count == passage_count`, or docs explicitly mark this as deferred with risk.

**Phase 4 verification:**

Local:

```bash
cd /data/resonance
npm run typecheck:web
npm run typecheck:packages
npm run build --workspace=@resonance/web
```

Live after approved deploy:

```bash
BASE=https://resonanceweb-production-276b.up.railway.app
curl -s "$BASE/api/health"
curl -s "$BASE/api/vectors/status"
```

Browser verification after deploy:
- Load `/journal`.
- Confirm only intended resonance request(s) fire.
- Confirm no console errors.
- Confirm `✦` still works.

---

## Phase 4A Completion Ledger — 2026-06-26

**Status:** Implemented locally; pending commit/push/live verification.

**Scope shipped:**

- Added `scripts/verify-resonance-hotpath.mjs` and `npm run verify:resonance-hotpath` regression check.
- Changed `JournalScreen` so first paint loads/expands resonance for only the newest text entry; older entries lazy-load on `✦` tap.
- Changed save behavior so saving a new entry no longer synchronously calls `loadResonance`; `✦` remains user-triggered until the queued/cache architecture is wired.
- Added `modelLoadPromises` in `/api/resonance` so cold concurrent requests share the same model load/norm computation.
- Removed `ensureHighlightVectorsTable()` import/call from `/api/resonance`; schema setup no longer runs on this hot path.

**Verification run:**

```bash
cd /data/resonance
npm run verify:resonance-hotpath
npm run typecheck:web
npm run typecheck:packages
npm run build --workspace=@resonance/web
```

**Actual result:**

- Hot-path verifier passed after first failing red run confirmed the regression check caught the old behavior.
- `npm run typecheck:web` passed.
- `npm run typecheck:packages` passed.
- `npm run build --workspace=@resonance/web` passed; Next generated all 38 routes successfully.

**Remaining Phase 4 item:**

- Active pplx manifest still needs a self-contained `passage_ids`/`passage_sources` repair. That is intentionally left for a separate, explicit vector-volume task.

---

## Phase 5 — Journal Entry Adaptation

**Objective:** New journal entries become durable nodes, embed once, generate candidate edges, and cache resonance.

**Files:**
- Modify: `apps/web/app/api/journal/entries/route.ts`
- Create: `apps/web/app/api/resonance/jobs/route.ts` or similar job endpoint if using API-triggered background work
- Modify: `apps/web/app/api/resonance/route.ts`
- Modify: `apps/web/lib/client-data-layer.ts`
- Modify: `packages/screens/src/journal/JournalScreen.tsx`
- Update docs: `docs/resonance/event-flow.md`, `docs/resonance/api-contracts.md`

### Task 5.1: On journal create/update, create node + event

**What to build:**
- When journal entry is saved, upsert `journal_entry` node.
- Append `journal.created` or `journal.updated` event.

**Acceptance:**
- Journal CRUD still works.
- Node/event rows exist for new entries.

### Task 5.2: Embed journal entry once

**What to build:**
- Generate embedding based on content hash.
- Reuse existing embedding if hash unchanged.

**Acceptance:**
- Reopening same entry does not rebill embedding.

### Task 5.3: Generate candidate edges

**What to build:**
- Retrieve Scripture/voice/past-entry/highlight candidates.
- Use graph-aware reranking.
- Store candidate edges with evidence.

**Acceptance:**
- Edges are candidate/active, not permanent labels.

### Task 5.4: Cache result

**What to build:**
- Store compact `ResonanceResult` per journal node and corpus version.
- `findResonance` returns cache when fresh.

**Acceptance:**
- Repeated `✦` on same entry is fast and does not call `/api/embed` again.

### Task 5.5: UI shows pending/fresh/stale gracefully

**What to build:**
- Journal `✦` can show:
  - pending
  - cached result
  - stale but usable result
  - refreshed result when ready

**Acceptance:**
- User never waits on a full slow job just to view the entry.

---

## Phase 6 — Highlight and Note Adaptation

**Objective:** Highlights and notes become strong personal signals that influence future resonance without creating stale identity claims.

**Files:**
- Modify: `apps/web/app/api/reading/highlights/route.ts`
- Modify: `apps/web/app/api/reading/highlights/[id]/route.ts`
- Modify: `apps/web/lib/db.ts` or move highlight resonance behavior into `apps/web/lib/resonance/*`
- Modify: `packages/screens/src/word/ReadingView.tsx` only if needed to record opened/saved/dismissed interactions
- Update docs: `docs/resonance/event-flow.md`, `docs/resonance/adaptive-ranking.md`

### Task 6.1: On highlight create, create node + durable edge

**What to build:**
- Create `highlight` node.
- Create durable edge `highlight --saved_from--> passage`.
- Append `highlight.created` event.

**Acceptance:**
- Highlight remains explicit user signal.

### Task 6.2: On note add/update, create note node + embedding

**What to build:**
- Treat note text as user interpretation.
- Generate/recompute note embedding on note hash change.
- Mark old note-derived edges dormant when note changes.

**Acceptance:**
- Changing a note adapts future resonance.

### Task 6.3: Use highlights/notes in reranking

**What to build:**
- Boost passages user highlighted.
- Stronger boost for passages with notes.
- Boost semantically related note neighborhoods.

**Acceptance:**
- Journal resonance can say “this connects to a passage you highlighted/noted” when true.

---

## Phase 7 — Book Addition and Corpus Versioning

**Objective:** Newly added books/passages join future resonance immediately and selectively enrich prior material.

**Files:**
- Modify/Create scripts under `scripts/library/*`
- Create: `apps/web/lib/resonance/corpus.ts`
- Possibly create API routes under `apps/web/app/api/admin/corpus/*`
- Update docs: `docs/resonance/corpus-ingestion.md`, `docs/resonance/operational-runbook.md`

### Task 7.1: Define corpus version record

**What to build:**
- Every corpus build/upload gets a version:
  - id
  - model id
  - passage count
  - manifest hash
  - built/uploaded timestamps

**Acceptance:**
- Resonance caches can detect they were computed against an older corpus.

### Task 7.2: Book ingestion job record

**What to build:**
- `book_ingestion_jobs` tracks:
  - added book/package
  - chunk count
  - embedding status
  - corpus version impact
  - backfill status

**Acceptance:**
- Future agents can see if a book was partially ingested.

### Task 7.3: Future-aware immediate retrieval

**What to build:**
- After book ingestion completes, new journal entries can retrieve the new book’s passages.

**Acceptance:**
- New book participates in future `✦` without manual code change.

### Task 7.4: Selective backfill

**What to build:**
- Background/backfill process checks new book only against:
  - last 30 days journal entries
  - active theme snapshot evidence
  - highlighted notes
  - saved resonance entries
  - low-confidence cached results

**Acceptance:**
- Does not recompute all history.
- Candidate edges from new book are marked as `evidence_kind = 'new_corpus_backfill'`.

### Task 7.5: Lazy historical recompute

**What to build:**
- When old entry opens and cache is stale, return cached result immediately and enqueue refresh.

**Acceptance:**
- Old pages remain fast.
- New corpus can improve old entries over time.

---

## Phase 8 — Theme Snapshots and Trails

**Objective:** Add flexible time-windowed themes/trails without permanent labels.

**Files:**
- Create: `apps/web/lib/resonance/themes.ts`
- Modify/Create: `apps/web/app/api/patterns/themes/route.ts`
- Modify/Create: `apps/web/app/api/patterns/weekly/route.ts`
- Update docs: `docs/resonance/anti-staleness.md`

### Task 8.1: Theme snapshot generator

**What to build:**
- Generate snapshots over windows:
  - 7 days
  - 30 days
  - optional 90 days
- Evidence is node IDs, not identity labels.

**Acceptance:**
- Snapshot labels expire and can be regenerated.

### Task 8.2: Trail detection

**What to build:**
- Identify repeated edge neighborhoods, e.g. journal entries repeatedly near trust/tomorrow/refuge passages.
- Store as provisional `same_trail` edges or `theme_snapshot` evidence.

**Acceptance:**
- Trails are candidate/active/dormant, never permanent identity.

### Task 8.3: Update UI language

**What to build:**
- Make patterns UI say:
  - “Recently…”
  - “This has echoed…”
  - “You returned to…”
- Avoid fixed labels.

**Acceptance:**
- Product language follows `docs/resonance/principles.md`.

---

## Phase 9 — Verification, Observability, and Regression Shield

**Objective:** Make the system auditable for future agents and safe to evolve.

**Files:**
- Create: `scripts/verify-resonance-architecture.mjs`
- Create: `scripts/smoke-resonance-live.mjs`
- Update: `package.json` scripts if appropriate
- Update docs: `docs/resonance/operational-runbook.md`, `docs/resonance/agent-guide.md`

### Task 9.1: Static architecture verifier

**What to build:**
- Script checks that required docs exist.
- Script checks migrations contain required adaptive tables.
- Script checks no forbidden permanent identity fields/patterns are introduced.

**Acceptance:**
- Running script gives clear pass/fail output.

### Task 9.2: Local smoke tests

**What to build:**
- Verify:
  - typecheck packages/web
  - build web
  - core resonance helper imports compile

**Acceptance:**
- `npm run build --workspace=@resonance/web` passes.

### Task 9.3: Live smoke tests after approved deploy

**What to build:**
- Script exercises:
  - `/api/health`
  - `/api/vectors/status`
  - auth-protected journal load
  - cached resonance path
  - no fan-out explosion on `/journal`

**Acceptance:**
- Script reports timing and route status.
- Does not mutate unless explicitly run with a fixture flag.

---

## Open Architecture Decisions for Michael

Before implementation, decide these explicitly:

1. **Where should canonical Scripture/voice embeddings live long-term?**
   - Option A: Railway volume + custom index.
   - Option B: Supabase pgvector.
   - Option C: Hybrid: canonical volume, personal graph in Supabase.

2. **Should journal resonance compute immediately on save or only on first `✦` tap?**
   - Recommended: enqueue on save for newest entry, but do not block UI; older entries lazy.

3. **How strong should auto-personalization be?**
   - Recommended: explicit user actions (highlight/note/save) get strong boosts; mere opens get weak boosts.

4. **How should stale results display?**
   - Recommended: show old cached result instantly; quietly refresh; only notify when a materially better/new-corpus result appears.

5. **Should mobile free tier mirror this graph locally?**
   - Recommended: web first; mobile later with local SQLite-compatible subset.

---

## Risk Register

| Risk | Why it matters | Mitigation |
|---|---|---|
| Over-fixed labels | User outgrows inferred themes | Snapshots expire; no identity claims |
| Hidden costs | Auto-compute too many embeddings | Cache by content hash; lazy compute older entries |
| Slow requests | Full vector scan on hot path | Cache, jobs, in-flight load promise, indexed retrieval |
| Graph clutter | Too many weak candidate edges | Expire candidates; require reinforcement |
| New books rewrite history | User sees old entries change unpredictably | Selective/lazy backfill; stale cache markers |
| Supabase schema drift | Hot-path `run_sql` failures | Migrations only; no schema creation in request path |
| Future agent confusion | Mechanics are cross-cutting | Docs + agent guide + static verifier |

---

## Final Acceptance Criteria

The implementation is complete when:

- [ ] `docs/resonance/*` exists and explains the architecture clearly.
- [ ] Future agents have an `agent-guide.md` with required reading and pitfalls.
- [ ] New journal entries create durable events/nodes and cached resonance.
- [ ] Repeated `✦` views do not rebill embeddings or rescan the whole corpus unnecessarily.
- [ ] Highlights and notes influence future resonance through explicit user-action edges.
- [ ] New books are embedded once, versioned, and enter future search immediately.
- [ ] New books selectively/lazily backfill old entries instead of recomputing all history.
- [ ] Theme labels are snapshots with windows/evidence/expiry, not permanent identity.
- [ ] Live Journal load no longer fans out resonance calls for every historical entry.
- [ ] Build/typecheck pass.
- [ ] Live smoke tests confirm endpoints and UX behavior after deploy.

---

## Suggested Execution Discipline

1. Implement Phase 0 first and stop for review.
2. After docs are approved, implement Phase 1 schema.
3. Do not jump straight to UI or graph behavior until docs + schema + types are accepted.
4. After each phase:
   - update the relevant docs with what actually shipped
   - run verification
   - report changed files and evidence
   - wait for approval before the next phase unless Michael explicitly says to continue end-to-end.

