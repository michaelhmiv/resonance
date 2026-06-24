# Resonance Implementation Plan — June 24, 2026 (Master)

Status: **Approved**. Refer to this plan for all work in this session.

## What's done (Phase 1)

- Semantic vectors on Railway volume (GTE-small 384d, Perplexity 2560d, 653 MB)
- `/api/embed` via Transformers.js (real GTE-small, not hash)
- `/api/resonance` — semantic-vector primary, lexical fallback
- `WebDataLayer.findResonance()` embeds text before calling resonance
- Supabase schema applied, API routes wired
- Auth (password gate + middleware) working
- Bible books/chapters/search/verse-of-day endpoints
- Journal CRUD, bookmarks, highlights, annotations via Supabase
- Cross-reference data loaded from JSON
- Shared `WordScreen`, `ReadingView`, `SearchScreen`, `ScriptureBrowser`, `LibraryBrowser` in `packages/screens`
- UI components (`PassageCard`, `HighlightToolbar`, `CrossReferenceLinks`, `BookmarkButton`, `TranslationSelector`) in `packages/ui`

## Audit findings (gaps the original plan missed)

| # | Gap | Severity | File |
|---|-----|----------|------|
| 1 | Settings shows local-only models on web (BGE-small, MiniLM, Qwen) | 🔴 Critical | `apps/web/app/settings/page.tsx:115,135` |
| 2 | Journal page calls `/api/resonance` directly, bypassing embed→resonance pipeline | 🔴 Critical | `apps/web/app/journal/page.tsx:80-83` |
| 3 | Cross-references render but `onPress={() => {}}` — dead no-op | 🔴 Critical | `packages/screens/src/word/ReadingView.tsx:350` |
| 4 | Library search results can't be opened (gates on `translation != null`) | 🔴 Critical | `packages/screens/src/word/SearchScreen.tsx:90` |
| 5 | No "Send to Journal" from any surface | 🟠 High | DataLayer interface, ReadingView, SearchScreen |
| 6 | No shared Journal screen (web: entry list, mobile: continuous doc) | 🟠 High | `apps/web/app/journal/`, `apps/mobile/src/screens/JournalScreen.tsx` |
| 7 | No shared Patterns/Settings screens | 🟠 High | `apps/web/app/patterns/`, `apps/web/app/settings/`, mobile equivalents |
| 8 | No reading history — patterns can't show reading activity | 🟠 High | DataLayer interface, API routes |
| 9 | Settings save to Supabase but nothing reads them back | 🟡 Medium | ReadingView, Journal, WordScreen |
| 10 | Web Journal/Patterns pages call APIs directly, not through DataLayer | 🟡 Medium | `apps/web/app/journal/page.tsx`, `apps/web/app/patterns/page.tsx` |

## Guiding rules

1. Every feature lives in `packages/screens` once, consumed by thin platform wrappers.
2. Screens never import DB/API modules directly — only `useDataLayer()`.
3. Web is always premium. No non-premium user reaches web.
4. Deployment: push to GitHub main → Railway auto-deploys. Never `railway up`.
5. Verify: curl live endpoints with auth cookie. 200 with empty arrays is NOT working.
6. Design: cream #faf9f6, Cormorant Garamond serif / Inter sans, hairline borders, no drop shadows.

---

## Phase A — Fix critical bugs (gaps 1-4)

These make the app look broken to any user who touches them.
Must be fixed before anything else.

### A.1 — Filter models by platform (gap 1)

**Problem:** `EMBEDDING_MODELS` and `LLM_MODELS` in `packages/core` have no platform field. Web Settings page shows all models including local-only ones that can't run in a browser/server.

**Fix:**
1. Add optional `tier: 'local' | 'cloud'` field to `EmbeddingModelInfo` and `LlmModelInfo` in `packages/core/src/types.ts`
2. Update model catalogs:
   - `gte-small` → tier: `'cloud'` (runs via Transformers.js in Node)
   - `bge-small-en`, `all-minilm-l6` → tier: `'local'`
   - `qwen-2.5-1.5b` → tier: `'local'`
   - `deepseek-v4-pro` → tier: `'cloud'`
3. Export `CLOUD_EMBEDDING_MODELS` and `CLOUD_LLM_MODELS` filtered arrays
4. Update web Settings page to use cloud-filtered arrays

**Files:**
- `packages/core/src/types.ts` — add `tier` field
- `packages/core/src/embedding.ts` — add tier, export filtered array
- `packages/core/src/llm.ts` — add tier, export filtered array
- `apps/web/app/settings/page.tsx` — use `CLOUD_EMBEDDING_MODELS` / `CLOUD_LLM_MODELS`

**Verify:** Settings page on web shows only GTE-small and DeepSeek. No BGE, MiniLM, or Qwen options.

---

### A.2 — Journal uses DataLayer for resonance (gap 2)

**Problem:** Journal page calls `fetch('/api/resonance', {body: JSON.stringify({text})})` directly. The `WebDataLayer.findResonance()` method (which embeds text first for semantic search) is completely bypassed. Journal always gets lexical fallback.

**Fix:**
1. Convert Journal page to use `WebDataLayer` + `DataLayerProvider` (same pattern as WordPage)
2. Call `dataLayer.findResonance(entry.text)` instead of raw fetch
3. This automatically wires the embed→resonance pipeline

**Files:**
- `apps/web/app/journal/page.tsx` — wrap in DataLayerProvider, use dataLayer methods

**Verify:** Write "I feel weary and burdened, seeking rest" in Journal → Save → resonance cards appear with `method: semantic-vector` and relevant Scripture matches (e.g., Matthew 11:28).

---

### A.3 — Wire cross-reference navigation (gap 3)

**Problem:** `ReadingView` renders `CrossReferenceLinks` with `onPress={() => {}}` — cross-refs display but tapping does nothing.

**Fix:**
1. Parse cross-ref strings like `"John 3:16"`, `"Genesis 1:1"` into `{book, chapter, verse}`
2. Add `onNavigateRef(bookName, chapter)` handler in ReadingView
3. Pass it as `onPress` to `CrossReferenceLinks`
4. Navigate to the referenced chapter via `onNavigateChapter` prop
5. Track target verse in state, scroll to it after load

**Files:**
- `packages/screens/src/word/ReadingView.tsx` — add ref parser + navigation handler
- `packages/ui/src/CrossReferenceLinks.tsx` — (already supports `onPress`, no change needed)

**Verify:** In ReadingView, tap "↳ John 3:16" → navigates to John 3 → verse 16 highlighted.

---

### A.4 — Handle library search results (gap 4)

**Problem:** `SearchScreen.handleOpenHit` only opens Scripture hits. Library results (`translation === null`) are dead ends.

**Fix:**
1. Add `onOpenLibrary?: (bookId: string) => void` prop to SearchScreen
2. In `handleOpenHit`, when `hit.translation === null`, call `onOpenLibrary(hit.book_id)`
3. Wire WordScreen to pass `onOpenLibrary` → opens ReadingView in library mode
4. Ensure WebDataLayer.searchPassages returns library hits with proper `book_id`

**Files:**
- `packages/screens/src/word/SearchScreen.tsx` — add onOpenLibrary prop + handler
- `packages/screens/src/word/WordScreen.tsx` — pass onOpenLibrary callback

**Verify:** Search for "confessions" → scope Library → tap result → opens Augustine's Confessions in ReadingView.

---

## Phase B — Wire DataLayer everywhere (gap 10)

Before building new features, Journal and Patterns must use DataLayer so improvements apply universally.

### B.1 — Journal page uses DataLayer

**Problem:** Journal page calls `/api/journal/entries`, `/api/resonance`, `/api/reflect` directly.

**Fix:**
1. Wrap Journal page in `DataLayerProvider` (same as WordPage)
2. Replace `fetch('/api/journal/entries')` with `dataLayer.loadSegments()`
3. Replace `fetch('/api/journal/entries', {method:'POST'})` with `dataLayer.saveSegment()`
4. Replace `fetch('/api/resonance', ...)` with `dataLayer.findResonance()` (done in A.2)
5. Replace `fetch('/api/reflect', ...)` with `dataLayer.generateReflectionPrompt()`
6. Add `loadSegments` to `WebDataLayer` — convert journal entries to `JournalSegment[]`
7. Add `saveSegment` to `WebDataLayer` — create or update journal entry

**Files:**
- `apps/web/app/journal/page.tsx` — rewrite to use DataLayer
- `apps/web/lib/client-data-layer.ts` — implement `loadSegments`, `saveSegment`
- `packages/core/src/data-layer.ts` — verify interface has needed methods

**Verify:** Journal page renders entries via DataLayer. Save creates entry. Resonance uses semantic search.

---

### B.2 — Patterns page uses DataLayer

**Problem:** Patterns page calls `/api/journal/entries`, `/api/patterns/weekly`, `/api/patterns/themes` directly.

**Fix:**
1. Wrap Patterns page in `DataLayerProvider`
2. Replace `fetch('/api/journal/entries')` with `dataLayer.loadSegments()`
3. Replace `fetch('/api/patterns/weekly')` with `dataLayer.generateWeeklyRoundup()`
4. Replace `fetch('/api/patterns/themes')` with `dataLayer.clusterEntries()`
5. Replace `fetch('/api/reflect', ...)` with `dataLayer.generateReflectionPrompt()`

**Files:**
- `apps/web/app/patterns/page.tsx` — rewrite to use DataLayer

**Verify:** Calendar shows real entry dots. Weekly roundup shows real data. Themes cluster from real entries.

---

## Phase C — Send to Journal + Reading history (gaps 5, 8)

### C.1 — Add `appendQuoteToJournal` to DataLayer

**Fix:**
1. Add method to `DataLayer` interface: `appendQuoteToJournal(quote: string, source: string): Promise<void>`
2. Implement in `WebDataLayer` — creates journal entry with formatted quote
3. Add `SendToJournalButton` component in `packages/ui`
4. Wire into: ReadingView (text selection), SearchScreen (result cards), PassageCard

**Files:**
- `packages/core/src/data-layer.ts` — add method
- `apps/web/lib/client-data-layer.ts` — implement
- `packages/ui/src/SendToJournalButton.tsx` — new component
- `packages/screens/src/word/ReadingView.tsx` — add button
- `packages/screens/src/word/SearchScreen.tsx` — add button to search results

**Verify:** Select verse in ReadingView → "Send to Journal" appears → journal shows quoted passage.

---

### C.2 — Add reading history

**Fix:**
1. Add `recordReadingEvent` to DataLayer interface
2. Implement in WebDataLayer — POST to new `/api/reading/events` endpoint
3. Add `getReadingHistory` to DataLayer interface
4. Create `/api/reading/events` route (GET + POST)
5. Auto-record when user opens ReadingView (scripture mode only)
6. Show reading dots on Patterns calendar (different color from writing dots)

**Files:**
- `packages/core/src/data-layer.ts` — add methods
- `apps/web/lib/client-data-layer.ts` — implement
- `apps/web/app/api/reading/events/route.ts` — new endpoint
- `packages/screens/src/word/ReadingView.tsx` — record event on mount
- `apps/web/app/patterns/page.tsx` — show reading dots on calendar

**Verify:** Open Scripture chapter → refresh Patterns → calendar shows reading dot on today.

---

## Phase D — Settings consumption (gap 9)

### D.1 — ReadingView respects saved preferences

**Fix:**
1. Add `getSettings()` to DataLayer interface (returns key-value map)
2. ReadingView reads `translation` setting on mount, uses it as default
3. ReadingView reads `fontSize` setting, applies to verse text
4. WordScreen reads `translation` setting for initial translation selector state

**Files:**
- `packages/core/src/data-layer.ts` — add `getSettings` method
- `apps/web/lib/client-data-layer.ts` — implement (already has underlying function)
- `packages/screens/src/word/ReadingView.tsx` — read settings on mount
- `packages/screens/src/word/WordScreen.tsx` — read settings for default translation

**Verify:** Change translation to KJV in Settings → open Word → default translation is KJV.

---

## Phase E — Shared screens (gaps 6, 7)

### E.1 — Create shared JournalScreen

Move mobile's sophisticated JournalScreen (continuous document with segments, focus manager, auto-save, date dividers) into `packages/screens`.

**Fix:**
1. Create `packages/screens/src/journal/JournalScreen.tsx`
2. Port from `apps/mobile/src/screens/JournalScreen.tsx`
3. Replace platform-specific imports (FlashList, Feather icons, react-navigation) with shared equivalents
4. Navigation via callback props (not `useNavigation`)
5. Icons from `packages/ui/src/icons.tsx` (not `@expo/vector-icons`)
6. Both web and mobile consume this shared screen via thin wrappers

**Files:**
- `packages/screens/src/journal/JournalScreen.tsx` — new shared screen
- `apps/web/app/journal/page.tsx` — thin wrapper (already from B.1)
- `apps/mobile/src/screens/JournalScreen.tsx` — thin wrapper around shared

**Verify:** Web journal shows continuous document with auto-save. Mobile journal unchanged but using shared code.

---

### E.2 — Create shared PatternsScreen

**Fix:**
1. Create `packages/screens/src/patterns/PatternsScreen.tsx`
2. Port calendar grid, weekly roundup, themes, reflection section
3. Calendar shows both writing and reading dots
4. Navigation via callback props

**Files:**
- `packages/screens/src/patterns/PatternsScreen.tsx` — new
- `apps/web/app/patterns/page.tsx` — thin wrapper
- `apps/mobile/src/screens/PatternsScreen.tsx` — thin wrapper

---

### E.3 — Create shared SettingsScreen

**Fix:**
1. Create `packages/screens/src/settings/SettingsScreen.tsx`
2. Uses cloud-filtered model lists (from A.1)
3. All settings rows change actual behavior (from D.1)

**Files:**
- `packages/screens/src/settings/SettingsScreen.tsx` — new
- `apps/web/app/settings/page.tsx` — thin wrapper

---

## Execution order

```
A.1 (filter models) ──┐
A.2 (journal resonance)─┤  Fix critical bugs first
A.3 (cross-ref nav) ───┤  (can be parallel)
A.4 (library search) ──┘
         │
         ▼
B.1 (journal DataLayer) ──┐
B.2 (patterns DataLayer) ─┤  Foundation for everything
         │                  (can be parallel)
         ▼
C.1 (send to journal) ──┐
C.2 (reading history) ──┤  New features
         │                (can be parallel)
         ▼
D.1 (settings consumed) — Makes settings functional
         │
         ▼
E.1 (shared Journal) ──┐
E.2 (shared Patterns) ─┤  Platform unification
E.3 (shared Settings) ─┘  (can be parallel)
```

Each phase is independently shippable. Push and deploy after each.

## Verification gates

After every phase:
1. `npx tsc --noEmit` passes in affected package
2. Push to GitHub main → wait for Railway deploy
3. `curl` affected endpoints with auth cookie against production URL
4. Assert response bodies contain expected data
5. Browser-verify affected screens

## Anti-patterns

1. Never import DB/API modules directly in shared screens
2. Never use `@expo/vector-icons` in shared packages
3. Never call `useNavigation()` in shared screens
4. Never ship placeholder screens labeled as "done"
5. Never report "verified" until curl confirms real data
