# Word Tab Reading Experience Overhaul — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make the Word tab reading experience feel like a book, not a database dump. Fast to load, deep-linkable, navigable, and quiet — with cross-references as lazy marginal notes, not wall-breaking blockers.

**Architecture:** The ReadingView is the central reading surface shared between web and mobile. All changes stay within `packages/screens/src/word/`, `packages/ui/src/`, `packages/core/src/types.ts`, and a few web-specific wiring files.

**Tech Stack:** React Native (react-native-web for web), TypeScript, DataLayer contract, Supabase.

---

## Performance Root Cause

Cross-references are loaded **sequentially for every verse** before the page renders:

```typescript
// ReadingView.tsx:159-161 — the bottleneck
for (const ref of verseRefs) {           // Matthew 5 = 48 verses
  const refs = await dataLayer.getCrossReferences(ref);  // 48 sequential fetches
}
```

`setLoading(false)` only runs AFTER the loop finishes. 48 sequential API calls = **5+ seconds of blank spinner** before the user sees anything. This is Phase 0 — fixed before any feature work.

---

## Phases

### Phase 0 (PERFORMANCE): Don't Block Page Load on Cross-Refs

**Goal:** Pages load instantly. Cross-refs load in the background only when the user expands them.

#### Task 0.1: Remove blocking cross-ref loop from initial load
**Files:** `packages/screens/src/word/ReadingView.tsx:157-163`

Remove the `for (const ref of verseRefs)` loop from `loadData()`. Move `setLoading(false)` before cross-ref loading. Cross-refs become lazy — only loaded when the user taps the collapsible marker (Phase 2).

#### Task 0.2: Create batched cross-ref API endpoint
**Files:** `apps/web/app/api/bible/cross-refs/route.ts`

Add support for `POST` with `{ refs: string[] }` body. Returns `{ refs: Record<string, string[]> }` — a map of verse ref → cross-reference list. Reads from the seeded cross_references JSON file once, returns matching entries for all requested refs.

#### Task 0.3: Add batch method to DataLayer
**Files:** `packages/core/src/data-layer.ts`, `apps/web/lib/client-data-layer.ts`

Add `getCrossReferencesBatch(refs: string[]): Promise<Record<string, string[]>>` to the DataLayer interface. Web implementation calls `POST /api/bible/cross-refs` with the array. Single API call vs N sequential calls.

#### Task 0.4: Parallelize passages + highlights + annotations
**Files:** `packages/screens/src/word/ReadingView.tsx:117-167`

Currently: `getVerses()` → wait → then `getHighlightsForRefs()` + `getAnnotationsForRefs()` → wait → then cross-refs loop.

Change to: `Promise.all([getVerses(), getHighlightsForRefs(refs), getAnnotationsForRefs(refs)])` — all three in parallel. Passages, highlights, and annotations load simultaneously. Only cross-refs are deferred (lazy).

---

### Phase 1: Deep Linking — "Read in Word →" Actually Works

**Goal:** Tapping "Read in Word →" on a resonance card navigates to the exact verse.

#### Task 1.1: Add deep-link props to WordScreen
**Files:** `packages/screens/src/word/WordScreen.tsx`

Add optional `initialBook?: string` and `initialChapter?: number` props. On mount, if both are provided and surface is 'scripture', auto-navigate to the reading view for that book+chapter.

#### Task 1.2: Wire WordPage to read query params
**Files:** `apps/web/app/word/page.tsx`

Read `?book=` and `?chapter=` from URL search params. Parse bookId (e.g. `web_Matthew`) into book name and translation. Pass as `initialBook`/`initialChapter` to WordScreen.

#### Task 1.3: Pass chapter/verse from Journal resonance cards
**Files:** `apps/web/app/journal/page.tsx`, `packages/screens/src/journal/JournalScreen.tsx`

Update `handleNavigateToBook` to parse `bookId` and extract chapter + verse from the card's `source` field. Navigate to `/word?book=web_Matthew&chapter=5&verse=22`.

#### Task 1.4: Scroll to specific verse on load
**Files:** `packages/screens/src/word/ReadingView.tsx`

Add `initialVerse?: number` prop. After passages load, use FlatList's `scrollToIndex` to scroll to the target verse.

---

### Phase 2: Cross-References — Lazy Collapsible Marginal Notes

**Goal:** Cross-refs never block page load. Hidden by default, loaded on-demand, expandable inline, and navigable.

#### Task 2.1: Create CollapsibleCrossRefs component
**Files:** Create `packages/ui/src/CollapsibleCrossRefs.tsx`

Shows a small superscript `[N]` (count of refs). On first tap, lazily loads cross-refs via `getCrossReferencesBatch([verseRef])`. Caches result. Expands inline showing clickable refs styled as `↳ John 3:16`. Each ref navigates via `onPress`.

#### Task 2.2: Replace CrossReferenceLinks in ReadingView
**Files:** `packages/screens/src/word/ReadingView.tsx`

Swap `<CrossReferenceLinks>` for `<CollapsibleCrossRefs>`. Pass the verse ref and the existing `handleCrossRefPress` for navigation. Remove the old bulky `flexWrap` block.

#### Task 2.3: Batch-preload cross-refs for visible verses
**Files:** `packages/screens/src/word/ReadingView.tsx`

After initial render (passages visible, loading=false), fire a background `getCrossReferencesBatch(allVerseRefs)` to warm the cache. When the user taps `[N]`, data is likely already loaded.

---

### Phase 3: Translation Switcher in Reading Header

**Goal:** Switch translations without leaving the reading view.

#### Task 3.1: Add translation switcher to ReadingView header
**Files:** `packages/screens/src/word/ReadingView.tsx`

Add compact `TranslationSelector` to the reading header between back button and nav arrows. On change, call `onNavigateChapter(bookName, chapter, newTranslation)`.

#### Task 3.2: Wire translation change to parent
**Files:** `packages/screens/src/word/WordScreen.tsx`

Update `navigateChapter` to accept optional translation override. Parent updates its state and re-renders ReadingView with new translation.

---

### Phase 4: Chapter Picker — Jump to Any Chapter

**Goal:** Navigate to any chapter without clicking prev/next 23 times.

#### Task 4.1: Create ChapterPicker overlay
**Files:** Create `packages/ui/src/ChapterPicker.tsx`

Modal/grid overlay with all chapters for the current book. Highlights current chapter. Tap to navigate. Closes on selection or backdrop tap.

#### Task 4.2: Add ChapterPicker trigger to ReadingView header
**Files:** `packages/screens/src/word/ReadingView.tsx`

Add chapter number badge (`5 / 28`) between nav arrows that opens ChapterPicker. For library mode, show section nav instead.

---

### Phase 5: Library Reading — Read Like a Book

**Goal:** Library passages feel like reading a book, not scrolling 2000+ raw chunks.

#### Task 5.1: Show author and work title in reading header
**Files:** `packages/screens/src/word/ReadingView.tsx`

When mode is 'library', display `libraryBook.author` and `libraryBook.title` in the header. Show `libraryBook.era` as subtle subtitle if available.

#### Task 5.2: Group library passages into pseudo-chapters
**Files:** `packages/screens/src/word/ReadingView.tsx`

Use SectionList for library mode. Group passages into batches of ~25 with section headers ("Part 1", "Part 2", ...). Creates visual breaks and enables section navigation.

#### Task 5.3: Add section navigation for library
**Files:** `packages/screens/src/word/ReadingView.tsx`

Add prev/next section buttons in header for library mode. Navigate between pseudo-chapter sections.

---

### Phase 6: Quiet the "Send to Journal" Noise

**Goal:** Send to Journal is available but doesn't clutter every verse.

#### Task 6.1: Move SendToJournal into highlight toolbar
**Files:** `packages/ui/src/HighlightToolbar.tsx`, `packages/screens/src/word/ReadingView.tsx`

Add a "Send to Journal" button (small journal icon or text) to the HighlightToolbar. Only visible when a verse is long-pressed. Pass the verse text + ref from ReadingView.

#### Task 6.2: Remove per-verse SendToJournal from FlatList
**Files:** `packages/screens/src/word/ReadingView.tsx:386-388`

Remove `<SendToJournalButton>` from the FlatList renderItem. It now lives in the highlight toolbar, shown on selection.

---

### Phase 7: Reading Progress & "Continue Reading"

**Goal:** Track reading and show "Continue where you left off."

#### Task 7.1: Query last-read position per book
**Files:** `apps/web/lib/db.ts`

Use existing `reading_events` table. Add query: `getLastReadPosition()` → returns `{ bookId, chapter }` for the most recent reading event.

#### Task 7.2: Show "Continue Reading" on Word tab landing
**Files:** `packages/screens/src/word/WordScreen.tsx`

On browse view mount, fetch last-read position. If available, show a "Continue Reading: Matthew 5" card at top. Tap → opens directly.

---

### Phase 8: Library Highlighting & Annotations

**Goal:** Highlight and annotate library passages, not just Scripture.

#### Task 8.1: Enable highlight/annotation loading for library mode
**Files:** `packages/screens/src/word/ReadingView.tsx:147`

Remove the `mode.kind === 'scripture'` gate on highlight/annotation loading. For library, build `verseRefs` from passage IDs and load highlights/annotations the same way.

#### Task 8.2: Use passage ID as highlight key for library
**Files:** `packages/screens/src/word/ReadingView.tsx`

For library, the highlight key is `passage.id` (a number), not a verse ref string. Update `verseRefFor` and highlight save/remove to handle both Scripture (string refs) and Library (numeric IDs).

#### Task 8.3: Verify persistence across modes
**Files:** N/A (verification only)

Confirm: highlight a library passage → navigate away → come back → highlight still visible. Annotations persist the same way.

---

## File Manifest

| File | Phase | Action |
|---|---|---|
| `packages/screens/src/word/ReadingView.tsx` | 0-8 | Heavy modify — load order, scroll anchor, translation, chapter picker, library sections, cross-refs, send-to-journal, lib highlights |
| `packages/screens/src/word/WordScreen.tsx` | 1, 3, 7 | Modify — deep link props, translation state, continue reading |
| `apps/web/app/word/page.tsx` | 1 | Modify — read query params |
| `apps/web/app/journal/page.tsx` | 1 | Modify — parse ref for deep links |
| `apps/web/app/api/bible/cross-refs/route.ts` | 0 | Modify — add POST batch endpoint |
| `packages/core/src/data-layer.ts` | 0 | Modify — add `getCrossReferencesBatch` |
| `apps/web/lib/client-data-layer.ts` | 0 | Modify — implement batch cross-refs |
| `packages/ui/src/CollapsibleCrossRefs.tsx` | 2 | Create — lazy collapsible cross-ref component |
| `packages/ui/src/ChapterPicker.tsx` | 4 | Create — chapter grid overlay |
| `packages/ui/src/HighlightToolbar.tsx` | 6 | Modify — add Send to Journal action |
| `packages/ui/src/index.ts` | 2, 4 | Modify — export new components |
| `apps/web/lib/db.ts` | 7 | Modify — last-read position query |

---

## Verification

After all phases:
1. **Speed:** Open Matthew 5 → renders instantly (no cross-ref blocking). Cross-refs load in background.
2. **Deep-link:** "Read in Word →" on Matthew 5:22 card → opens Word to Matthew 5, scrolled to verse 22.
3. **Cross-refs:** Verse shows `[3]` superscript → tap → loads refs → `↳ Romans 8:28` → tap → navigates to Romans 8.
4. **Translation:** Reading in WEB → tap WEB badge → switch to KJV → reloads in KJV without leaving.
5. **Chapter picker:** Tap `5 / 28` badge → grid of 28 chapters → tap 28 → navigates.
6. **Library:** Open "On Loving God" → "Bernard of Clairvaux" header → Parts with section nav → highlights work.
7. **Send to Journal:** Reading shows no Send buttons → long-press verse → toolbar has highlight colors + Send to Journal.
8. **Continue Reading:** Word tab landing shows "Continue Reading: Matthew 5" → tap → opens.
