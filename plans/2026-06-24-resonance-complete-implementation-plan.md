# Resonance Implementation Plan — Updated June 24, 2026

Status: **Reviewed**. Awaiting "proceed" to execute Phase 2.

## What changed since the original plan

**Phase 1 is fully deployed and verified:**
- Semantic vectors (GTE-small 384d float32, Perplexity 2560d int8) on Railway volume (653 MB total)
- `/api/embed` — real GTE-small via Transformers.js (33 MB model, normalized vectors)
- `/api/resonance` — semantic-vector as primary path, lexical fallback as backup
- Vector loading correctly detects `manifest.dtype` (float32 vs int8)
- Embed→resonance pipeline wired in `WebDataLayer.findResonance()`
- Verified: "weary and burdened, seeking rest" → Job 10:1 (0.902 cosine similarity)
- Health endpoint public, all smoke tests pass
- Supabase schema applied, API routes wired to PostgreSQL

**Frontend audit findings (folded into the plan below):**
- Calendar view shows arbitrary data, not a real calendar grid with entry dots
- Settings screen rows don't change actual app behavior (model switches, translation prefs, etc.)
- Resonance cards in Word tab are static/placeholder — not interactive
- Library reading surface is bare — no passage navigation, no highlight/annotate toolbar
- Word tab lacks the serif reading experience described in design spec (Cormorant Garamond, cream, verse superscripts)
- Cross-references are dead links
- No "Send to Journal" from any surface

## Guiding rules

1. Every feature lives in `packages/screens` once, consumed by thin platform wrappers in `apps/mobile` and `apps/web`.
2. Screens never import DB/API modules directly — only `useDataLayer()` from `packages/core`.
3. Web is always premium. No non-premium user reaches web. No signup on web yet.
4. Deployment: push to GitHub main → Railway auto-deploys. Never `railway up`.
5. LLM model: `RESONANCE_LLM_MODEL` env var; default `deepseek/deepseek-v4-pro`. Do not use generic `LLM_MODEL`.
6. Embedding: GTE-small family, 384-dim. Real model, not hash. Vectors pre-computed at build time.
7. Verify: curl live endpoints with auth cookie. 200 with empty arrays is NOT working.
8. Design: cream #faf9f6, Cormorant Garamond serif / Inter sans, hairline borders, no drop shadows, accent #8b7355.

## Current state summary

| Area | Status |
|---|---|
| Semantic vectors (Phase 1) | ✅ Deployed and verified |
| Real embedding endpoint | ✅ GTE-small via Transformers.js |
| Lexical fallback | ✅ Backup path working |
| Supabase schema + wiring | ✅ Journal, bookmarks, highlights, annotations, settings |
| Auth (password gate + middleware) | ✅ Working |
| Web Bible reading, search | ✅ Working (JSON store) |
| Web Journal CRUD | ✅ Working (Supabase) |
| Web resonance | ✅ Semantic-vector primary, lexical fallback |
| Web reflect | ✅ DeepSeek V4 Pro + deterministic fallback |
| **Reader completeness (Phase 2)** | ⬜ Many gaps |
| **Shared screens (Phases 3-5)** | ⬜ Not started |
| **Cloud auth/RLS (Phase 6)** | ⬜ Schema only, no RLS or accounts |
| **Book packages (Phase 7)** | ⬜ Not started |

---

## Phase 1 — Deploy real semantic vectors ✅ DONE

Completed June 24, 2026. See smoke test results above. Key deliverables:
- GTE-small (384d float32, 388 MB) and Perplexity (2560d int8, 647 MB) on Railway `/data/vectors/`
- `/api/embed` — real GTE-small via `@xenova/transformers`
- `/api/resonance` — semantic-vector with cosine similarity, lexical fallback when no vector provided
- `WebDataLayer.findResonance()` embeds text before calling resonance
- Vector loading handles both float32 (Buffer→Float32Array) and int8 (/127 dequant) dtypes

---

## Phase 2 — Complete Reader feature set (CURRENT PRIORITY)

**Why:** The Word tab has critical user-facing gaps. Cross-refs dead, no send-to-journal, reading surface doesn't match design spec, calendar placeholder, settings non-functional.

### 2.1 Reading surface: serif experience
- Ensure `ReadingView` uses Cormorant Garamond for body text, Inter for UI chrome
- Cream background (#faf9f6)
- Verse numbers as small superscripts
- Hairline borders on cards, no drop shadows
- Translation selector (WEB ▾) in reading header
- Prev/next navigation across book boundaries (Genesis 50 → Exodus 1)

### 2.2 Cross-reference navigation
- Parse cross-ref strings (`"Genesis 1:1"`, `"John 3:16"`) to book + chapter + verse
- Wire `CrossReferenceLinks.onPress` to navigate to the referenced passage
- Scroll to or highlight target verse when possible
- Handle same-translation and cross-translation refs

### 2.3 Library search result navigation
- Library search hits should open the library reading surface (not dead-end)
- Map voice passage → `bookId` → `LibraryBrowser.onOpenBook`
- Open `ReadingView` in `kind: 'library'` mode

### 2.4 Send quote to Journal
- Add `appendQuoteToJournal(quote)` to `DataLayer` interface
- Wire from: ReadingView (text selection), SearchScreen, Resonance cards
- Show quiet confirmation: "Sent to Journal"
- On web: creates a journal entry with quoted passage

### 2.5 Translation selector in reading header
- Add `TranslationSelector` to reading header (not just browse header)
- Switching translation reloads same book/chapter in selected translation
- Default: `WEB`, also supports `KJV`

### 2.6 Bookmark and annotation polish
- Dedupe bookmarks by `verse_ref`
- Add bookmark list screen accessible from Word header
- Support bookmarking at verse, chapter, and library passage levels
- Add annotation icon/indicator in verse block when annotation exists

### 2.7 Calendar view (real data, not arbitrary)
- Replace placeholder calendar with real grid showing entry dots
- Days with journal entries show dot indicator
- Days with reading activity show different indicator
- Month navigation (prev/next)
- Tap day to see entries from that date

### 2.8 Settings screen (functional, not placeholder)
- Every settings row changes actual app behavior
- Translation preference (WEB/KJV) persists and affects Bible display
- Model selection shows real available models
- Export produces real data
- Clear data actually clears data

### 2.9 Verification
- Tap cross-ref → navigates to correct chapter and highlights verse
- Library search result → opens library book reading view
- "Send to Journal" button → journal shows quoted passage
- Translation selector in reading header → switches translation
- Genesis 50 → next → Exodus 1
- Calendar shows correct entry dots for dates with journal content
- Settings rows produce observable changes in app behavior

---

## Phase 3 — Shared Journal screen (continuous document)

**Why:** Mobile Journal is a sophisticated continuous-document with segments, focus manager, auto-save, date dividers, verse-of-day. Web Journal is a simple entry list with a textarea.

### 3.1 Create shared JournalScreen
- Move journal segment model, store, focus manager into shared location
- Create `packages/screens/src/journal/JournalScreen.tsx`
- React Native specifics: `FlashList`, `TextInput` (both work via react-native-web)
- Navigation via props: `onOpenSettings`, `onOpenWord`, `onSearch`
- DataLayer provides: `loadSegments`, `saveSegment`, `deleteSegment`, `searchJournal`

### 3.2 Implement continuous document web side
- `WebDataLayer.loadSegments()` reads from journal entries API and converts to segments
- `WebDataLayer.saveSegment()` upserts with auto-save debounce
- One active segment (TextInput) at a time
- Date dividers between calendar-day boundaries
- Verse-of-day card inserted at today's boundary

### 3.3 Ambient resonance footnotes
- After sentence boundary or pause (debounce 800ms)
- Embed segment text → find resonance → insert ✦ footnote segment
- Tap ✦ → expand inline cards
- Cards have actions: "Read in Word", "Send quote to Journal"

### 3.4 Verification
- Write text on web → auto-saves → refresh → text persists
- Sentence pause → ✦ footnote appears
- Tap ✦ → 3 cards appear with actions

---

## Phase 4 — Shared Patterns screen

**Why:** Patterns should reflect both writing and reading behavior. Web and mobile should show the same patterns.

### 4.1 Move Patterns to shared
- `packages/screens/src/patterns/PatternsScreen.tsx`
- DataLayer provides all pattern methods

### 4.2 Add reading + resonance history
- Record reading events: `recordReadingEvent(bookId, chapter, verseRef, timestamp)`
- Calendar shows writing dots + reading dots (different indicators)
- Passages that linger, voices that returned, time-of-day texture

### 4.3 DeepSeek-powered pattern features
- `generateWeeklyRoundup` → naturalized roundup text
- `generateClusterLabel` → meaningful 2-3 word cluster labels
- `generateShiftNarrative` → "what shifted" narrative
- All fall back to deterministic when DeepSeek unavailable

### 4.4 Verification
- Calendar matches real entry dates
- Reading dots appear on days user read Scripture
- Themes change when journal content changes
- DeepSeek failure falls back gracefully

---

## Phase 5 — Shared Settings screen

**Why:** Settings need to work on both platforms. Model selection needs to be real.

### 5.1 Move Settings to shared
- `packages/screens/src/settings/SettingsScreen.tsx`
- DataLayer provides all settings read/write methods

### 5.2 Real settings behavior
- Model selection: switch between available embedding models
- Translation preference: WEB/KJV persists across app
- Export: real data export
- Clear data: actually clears user data
- Storage breakdown: text, vectors, user entries

### 5.3 Verification
- Every settings row changes actual app behavior
- Refresh preserves settings
- Export file contains real data
- Clear data actually clears data

---

## Phase 6 — Premium / cloud foundation

**Why:** Supabase schema is applied but RLS, real accounts, and mobile cloud sync remain.

### 6.1 Supabase auth
- Replace password gate with Supabase Auth (email/password)
- Only premium-tier accounts can log in on web
- No signup flow on web yet

### 6.2 RLS policies
- Enable Row Level Security on all tables
- User can only access own data
- Service role bypasses RLS for server-side operations

### 6.3 Mobile cloud DataLayer
- Free tier: `LocalMobileDataLayer` (SQLite + local models)
- Premium tier: `CloudMobileDataLayer` (Supabase + API)
- Auth state determines which implementation is active

### 6.4 Verification
- Non-auth web visitor cannot access any app route
- RLS prevents cross-user data access
- Writing on web appears on mobile premium within seconds

---

## Phase 7 — Book Package system

**Why:** Library is currently hardcoded seed data.

### 7.1 Package manifest format
### 7.2 Install/uninstall flow
### 7.3 Package discovery surface

(Details unchanged from original plan — low priority.)

---

## Execution order

| Phase | Priority | Status |
|---|---|---|
| 1 — Vectors + embedding | Highest | ✅ Done |
| 2 — Reader completeness | **Current** | ⬜ In progress |
| 3 — Shared Journal | High | ⬜ |
| 4 — Shared Patterns | Medium | ⬜ |
| 5 — Shared Settings | Medium | ⬜ |
| 6 — Premium/cloud | Medium | ⬜ |
| 7 — Book packages | Low | ⬜ |

---

## Verification gates for every phase

1. Typecheck passes: `npm run typecheck:packages && npm run typecheck:web`
2. `npm run build` passes
3. Push to GitHub main → Railway auto-deploys
4. `curl` all affected endpoints with auth cookie against production URL
5. Assert response bodies contain expected data (not empty arrays, not error messages)
6. Browser-verify affected screens respond correctly
7. **New:** Frontend responsiveness — settings change behavior, calendar shows real data, cards are interactive

---

## Anti-patterns to avoid

1. **Never** import DB/API modules directly in shared screens — only `useDataLayer()`
2. **Never** use `@expo/vector-icons` in shared packages — only `packages/ui/src/icons.tsx`
3. **Never** call `useNavigation()` in shared screens — navigation via callback props
4. **Never** write platform-specific code in shared screens
5. **Never** report "verified" until curl confirms real data in response body
6. **Never** use generic `LLM_MODEL` — only `RESONANCE_LLM_MODEL`
7. **Never** ship placeholder screens labeled as "done"
