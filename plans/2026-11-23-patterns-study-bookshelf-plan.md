# Patterns Tab Enhancement Plan — Living Concordance & Study Bookshelf

**Date:** 2026-11-23  
**Branch:** `feat/patterns-study-bookshelf`  
**Principles:** [`docs/resonance/principles.md`](../docs/resonance/principles.md), [`docs/resonance/patterns-tab.md`](../docs/resonance/patterns-tab.md)

## Goal

Transform the Patterns tab from a minimal single-day calendar into a calm, offline-first **living concordance** that connects user-created traces (journal entries, readings, highlights, notes, bookmarks) with user-installed Scripture (66 books) and Christian literature (Voices).

## Root Causes Addressed

1. **Echoes filtered to zero:** `replaceResonanceEdges` writes 1 evidence entry per edge, while `mapEchoes` required `evidence.length >= 2` and never joined `resonance_edges.source_node_id` back to `resonance_nodes.source_id`.
2. **Single-day tunnel vision:** `buildPatternDayDetail(date)` only loaded `loadRawData(date, date)`, making cross-day echoes, returns, and trails invisible.
3. **Unused summary data & unwired loops:** `PatternsScreen` discarded `themes`, `echoes`, `returnedTo`, and `trails`, never called `/api/patterns/feedback`, had no navigation to `Word`, and did not allow answering `A Quiet Question` into the Journal.
4. **Offline/Mobile divergence:** `PatternsScreen` hardcoded `fetch('/api/patterns/...')` instead of using `DataLayer`, leaving `apps/mobile` on an older journal-only screen.

## Architecture & Phases

### Phase 1 — Shared Concordance Engine (`@resonance/core`)
- Add shared Patterns & Bookshelf types to `packages/core/src/types.ts` (`PatternTimeframe`, `PatternConnection`, `FindingYouSignal`, `BookshelfVolume`, `BookshelfSummary`, `BookBridgeItem`, `BookBridgeResult`, `PatternFeedbackInput`, `PatternsSummary`, `PatternDayDetail`).
- Add `packages/core/src/patterns-engine.ts` with pure, offline-capable concordance logic:
  - Canonical 7-section Scripture grouping (`Law`, `History`, `Wisdom`, `Prophets`, `Gospels`, `Epistles`, `Revelation`) and 66-book spine abbreviations + reference parser.
  - Literature era grouping (`Fathers`, `Medieval`, `Reform`, `Devotional`) mapped from manifest `package_id`/`era`.
  - Pure builders for `FindingYouSignal` ("What Kept Finding You"), cross-day `PatternConnection` indexing, multi-hop `PatternTrail` assembly, `BookshelfSummary` aggregation, and book-scoped lexical/cross-ref bridge helpers.
- Extend `DataLayer` (`packages/core/src/data-layer.ts`) with optional methods: `getPatternsSummary`, `getPatternDayDetail`, `getBookBridges`, `recordPatternFeedback`.

### Phase 2 — Web Backend & API Fixes (`apps/web`)
- Update `apps/web/lib/patterns-summary.ts`:
  - Join `resonance_nodes` with `resonance_edges` so edges resolve back to `source_id` (`journal_entries.id`, `highlights.id`, etc.) and attach to day-detail items.
  - Fix `mapEchoes` threshold (`evidence.length >= 1`) and include `findingYou` + `bookshelf` in `PatternsSummary`.
  - Support `timeframe=30d|90d|all` on `GET /api/patterns/summary`.
  - Expand `buildPatternDayDetail(date)` to query a 30-day rolling context window so cross-day echoes, returns, and trails surface on individual days.
  - Add `buildBookBridge(kind, id, timeframe, bookId?)` combining visited traces, canonical `cross_references.json` bridges from highlights, and book-scoped passage resonance over `bible_passages.json` / `voice_passages.json`.
- Add `GET /api/patterns/book-bridge` route.
- Wire the new `DataLayer` methods into `WebDataLayer` (`apps/web/lib/client-data-layer.ts`) and add `onNavigateToBook` in `apps/web/app/(app)/patterns/page.tsx`.

### Phase 3 — Offline Mobile Parity (`apps/mobile`)
- Implement `getPatternsSummary`, `getPatternDayDetail`, `getBookBridges`, `recordPatternFeedback`, plus `loadSegments`, `saveSegment`, `recordReadingEvent`, and `getReadingHistory` in `MobileDataLayer` (`apps/mobile/src/data/mobileDataLayer.ts`) backed 100% by local SQLite tables (Migration v2).
- Update `apps/mobile/src/screens/PatternsScreen.tsx` to wrap the shared `@resonance/screens` `PatternsScreen` inside `DataLayerProvider` with navigation callbacks to the `Word` and `Journal` tabs.

### Phase 4 — Shared 3-Lens Patterns UI (`packages/screens/src/patterns/`)
- **`PatternsScreen.tsx`**: Top bar with `30d | 90d | All` timeframe pill + `?` Spine Key button, 3-lens switcher (`Threads · Explore · Activity`), and Spine Key popover modal (no developer activity log).
- **`ExploreBookshelfLens.tsx`**:
  - Gentle `✓ Group` toggle switching between canonical/era category volumes standing on wooden shelves (`Law, History, Wisdom, Prophets, Gospels, Epistles, Revelation`; `Fathers, Medieval, Reform, Devotional`) that expand into their individual books below when tapped vs. the ungrouped full bookcase.
  - Uniform book heights per shelf, symmetric 3-zone fine-press clothbound spine styling (top crest `✦`, auto-scaled centered serif title plate so long labels never clip, bottom colophon count/note dot, centered silk ribbon for highlights), and warm wooden shelf planks.
  - Inline Bridge Card listed cleanly below the shelves for any tapped book (visited or unread) showing traces/bridges + `Open →`.
- **`ThreadsLens.tsx`**: `Recently` card, hero `✦ What Kept Finding You` cards with evidence + `Keep` / `Not quite` feedback + `Open →`, `Trails Across Days`, and `A Quiet Question` with inline Journal reply.
- **`ActivityLens.tsx`**: Monthly multi-dot activity calendar + inline day detail with cross-day connections + `A Quiet Question` inline reply.
- **`SpineKeyModal.tsx`**: Clean `?` modal triggered next to the timeframe controls explaining the cloth colors, `✦` echo mark, silk highlight ribbon, and note ink dot.

### Phase 5 — Docs, Verification & PR
- Update `docs/resonance/patterns-tab.md` to reflect the 3-lens architecture, book-bridge contract, and timeframe support.
- Run `npm run typecheck:packages`, `npm run typecheck:web`, `npm run typecheck:mobile`, and a verification test script exercising the shared concordance engine (`packages/core/src/patterns-engine.ts`).
- Push `feat/patterns-study-bookshelf` and open a PR.
