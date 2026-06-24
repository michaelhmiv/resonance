# Resonance Implementation Plan — Complete Feature Roadmap

Date: 2026-06-24
Status: Plan only — no action until user says "proceed"

## Guiding rules

1. Every feature lives in `packages/screens` once, consumed by thin platform wrappers in `apps/mobile` and `apps/web`.
2. Screens never import DB/API modules directly — only `useDataLayer()` from `packages/core`.
3. Web is always premium. No non-premium user reaches web. No signup on web yet.
4. Deployment: push to GitHub main → Railway auto-deploys. Never `railway up`.
5. LLM model: `RESONANCE_LLM_MODEL` env var; default `deepseek/deepseek-v4-pro`. Do not use generic `LLM_MODEL`.
6. Embedding: GTE-small family, 384-dim. Real model, not hash. Vectors pre-computed at build time.
7. Verify: curl live endpoints with auth cookie. 200 with empty arrays is NOT working.

## Current state summary

| Area | Status |
|---|---|
| Shared Word tab via DataLayer | Deployed and working |
| Web Bible reading, search, highlights, bookmarks | Working |
| Web Journal CRUD | Working (JSON store) |
| Web Settings | Working |
| Web Patterns themes + calendar | Working |
| Web resonance | Lexical fallback (vectors not deployed) |
| Web reflect | DeepSeek V4 Pro + deterministic fallback |
| Mobile DataLayer resonance/pattern/LLM stubs | Now delegate to real mobile services |
| DeepSeek project-specific env isolation | Fixed (`RESONANCE_LLM_MODEL`) |

---

## Phase 1 — Deploy real semantic vectors (core magic)

**Why:** Resonance returns non-empty cards now, but they're lexical, not semantic. The app's core differentiator doesn't work yet.

### 1.1 Quantize and shard the vector file

Source: `/data/resonance/build/output/seeded_library/vectors_gte-small.bin`
- 389 MB, 265,068 passages × 384 dim float32
- Quantize to int8 (97 MB) or float16
- Split into shards ≤ 95 MB each (GitHub file limit)
- Place under `apps/web/data/seeded_library/vectors/`

### 1.2 Create vector manifest

File: `apps/web/data/seeded_library/vectors/manifest.json`

```json
{
  "model": "gte-small",
  "dim": 384,
  "dtype": "int8",
  "passage_count": 265068,
  "scale": 0.0125,
  "shards": [
    {"file": "shard_000.bin", "start": 0, "count": 100000},
    {"file": "shard_001.bin", "start": 100000, "count": 100000},
    {"file": "shard_002.bin", "start": 200000, "count": 65068}
  ],
  "passage_order": "bible_passages.json then voice_passages.json, both sorted by id ascending"
}
```

### 1.3 Update `/api/resonance` to load shards

- Read manifest on first request
- Lazy-load shards on demand or load all at startup
- De-quantize int8 → float32 for cosine similarity
- Preserve the existing lexical fallback as backup path
- Add `vectorsLoaded`, `vectorCount`, `dtype` to health endpoint

### 1.4 Replace `/api/embed` with real GTE-small

Options (in priority order):
1. Transformers.js server-side (`@xenova/transformers` — `Xenova/gte-small`, runs in Node)
2. ONNX Runtime server-side with GTE-small ONNX model
3. Python sidecar via Railway (heavier, avoid if possible)

### 1.5 Verification

```bash
# Health reports vectorCount > 0
# Embed produces 384 non-zero float values
# Resonance for "I'm exhausted" returns Matthew 11:28 or Exodus 33:14 as top Scripture
# Same input with different seed produces some variety
# Repeated identical input does not return exact same cards every time (weighted random)
```

---

## Phase 2 — Complete Reader feature set

**Why:** The Word tab has barebones reading. Cross-refs are dead, library search hits don't open, no "Send to Journal," translation selector not in reading header.

### 2.1 Cross-reference navigation

- Parse cross-ref strings (`"Genesis 1:1"`, `"John 3:16"`) to book + chapter + verse
- Wire `CrossReferenceLinks.onPress` to navigate to the referenced passage
- Handle same-translation and cross-translation refs (ref points to verse, current translation renders it)
- Scroll to or highlight target verse when possible

### 2.2 Library search result navigation

- `SearchScreen` already has `onOpenScripture` for scripture hits
- Add `onOpenLibrary` prop for library hits
- Map voice passage → `bookId` → `LibraryBrowser.onOpenBook`
- Open `ReadingView` in `kind: 'library'` mode

### 2.3 Send quote to Journal

- Add `appendQuoteToJournal(quote)` to `DataLayer` interface
- Add `SendToJournalButton` component in `packages/ui`
- Wire from: ReadingView, SearchScreen, ResonanceCardGroup
- Show quiet confirmation: "Sent to Journal"
- On mobile: inserts a quote segment into continuous document
- On web: same once Journal becomes shared segment model; for now, creates an entry

### 2.4 Translation selector in reading header

- `ReadingView` prop `onChangeTranslation` exists but unused
- Add `TranslationSelector` to reading header (not just browse header)
- Switching translation reloads same book/chapter in selected translation
- Default: `WEB`, also supports `KJV`

### 2.5 Prev/next across book boundaries

- Genesis 50 → tap next → Exodus 1
- Matthew 1 → tap prev → Malachi 4
- Use canonical book order from `packages/core/src/bible-canon.ts`

### 2.6 Bookmark semantics

- Dedupe bookmarks by `verse_ref`
- Support bookmarking at verse, chapter, and library passage levels
- Add bookmarks list screen accessible from Word header
- Consistent labels: `"Genesis 1:1"` for verse, `"Genesis 1"` for chapter, `"Confessions"` for library

### 2.7 Annotation polish

- Add annotation icon/indicator in verse block when annotation exists
- Make annotation modal keyboard-safe on web
- Support per-translation annotations (already in DataLayer)

### 2.8 Verification

- Tap cross-ref → navigates to correct chapter and highlights verse
- Library search result → opens library book reading view
- "Send to Journal" button → journal shows quoted passage
- Translation selector in reading header → switches translation
- Genesis 50 → next → Exodus 1
- Bookmarks deduplicated and reviewable

---

## Phase 3 — Shared Journal screen (continuous document)

**Why:** Mobile Journal is a sophisticated continuous-document with segments, focus manager, auto-save, date dividers, verse-of-day. Web Journal is a simple entry list with a textarea. They need to be the same screen.

### 3.1 Create shared JournalScreen

- Move journal segment model, store, focus manager into shared location
- Create `packages/screens/src/journal/JournalScreen.tsx`
- React Native specifics: `FlashList`, `TextInput` (both work via react-native-web)
- Navigation via props: `onOpenSettings`, `onOpenWord`, `onSearch`
- DataLayer provides: `loadSegments`, `saveSegment`, `deleteSegment`, `searchJournal`

### 3.2 Implement continuous document web side

- `WebDataLayer.loadSegments()` reads from journal entries API and converts to segments
- `WebDataLayer.saveSegment()` upserts by ID with auto-save debounce
- `WebDataLayer.deleteSegment()` removes by ID
- One active segment (TextInput) at a time
- Date dividers between calendar-day boundaries
- Verse-of-day card inserted at today's boundary

### 3.3 Add ambient resonance footnotes

- After sentence boundary or pause (debounce 800ms after last keystroke)
- Embed segment text → find resonance → insert ✦ footnote segment
- Tap ✦ → expand inline cards: one Scripture + one voice + one past entry
- Use shared `ResonanceCardGroup` component
- Cards have actions: "Read in Word", "Send quote to Journal"

### 3.4 Add past-entry "where you were" cards

- `storeSegmentVector()` called after auto-save flush
- `findResonance()` includes past entry similarity search
- Past entry cards show date + excerpt
- Tapping scrolls to that past entry or opens it

### 3.5 Add journal search

- Pull-down or header search icon
- Full-text search over segments
- Results show date + snippet
- Tap to scroll to result

### 3.6 Verification

- Write text on web → auto-saves → refresh → text persists
- Write text on mobile → auto-saves
- Sentence pause → ✦ footnote appears
- Tap ✦ → 3 cards appear
- Scripture card opens Word at correct verse
- Voice card opens Library at correct work
- Past-entry card links to past journal date
- Journal search returns results

---

## Phase 4 — Shared Patterns screen

**Why:** Patterns should reflect both writing and reading behavior, not just journal entries. Web and mobile should show the same patterns.

### 4.1 Move Patterns to shared

- `packages/screens/src/patterns/PatternsScreen.tsx`
- DataLayer provides: `getCalendarDays`, `clusterEntries`, `generateWeeklyRoundup`, `generateShiftReport`, `getReadingHistory`

### 4.2 Add reading + resonance history

- Record reading events: `recordReadingEvent(bookId, chapter, verseRef, timestamp)`
- `getReadingHistory(startDate, endDate)` returns reading events
- `getResonanceHistory(startDate, endDate)` returns surfaced resonance cards
- Calendar shows writing dots + reading dots (different color/shape)

### 4.3 Add missing pattern displays

- **Passages that linger**: most-resonated Scripture passages in past 30 days
- **Voices that returned**: most-resonated voice passages
- **Time-of-day texture**: when user typically writes (morning/afternoon/evening clusters)
- **What shifted**: compare two time periods, show narrative or side-by-side excerpts

### 4.4 DeepSeek-powered pattern features

- `generateWeeklyRoundup` → DeepSeek naturalizes the roundup text (not just keywords)
- `generateClusterLabel` → DeepSeek gives meaningful 2-3 word cluster labels
- `generateShiftNarrative` → DeepSeek writes 2-3 sentence "what shifted" narrative
- All fall back to deterministic/TF-IDF when DeepSeek unavailable
- Results cached, recomputed daily/weekly

### 4.5 Verification

- Calendar matches real entry dates
- Reading dots appear on days user read Scripture
- Themes change when journal content changes
- Weekly roundup returns natural text (not just keywords)
- DeepSeek failure falls back gracefully

---

## Phase 5 — Shared Settings screen

**Why:** Settings need to work on both platforms with the same code. Model selection needs to be real (switch models, not just UI).

### 5.1 Move Settings to shared

- `packages/screens/src/settings/SettingsScreen.tsx`
- DataLayer provides all settings read/write methods

### 5.2 Split local vs cloud model settings

- Embedding model: local (GTE-small, BGE-small, MiniLM)
- Local LLM: Qwen 2.5 1.5B (mobile only)
- Cloud LLM: DeepSeek V4 Pro (web + premium mobile)
- Premium mode toggle (future)
- Model switch flow: download new model/vectors → re-embed user entries → swap → delete old

### 5.3 Implement real package management in Settings

- List installed packages with size + status
- List available packages with size + description
- Install: download text + vectors, verify checksum, activate
- Uninstall: remove passages + vectors + reading marks (or preserve)
- Storage breakdown: text, vectors, user entries, reading marks

### 5.4 Verification

- Every settings row changes actual app behavior
- Refresh preserves settings
- Export file contains real data
- Clear data actually clears data
- Install a package → appears in Library → passages searchable → vectors in resonance
- Uninstall removes everything

---

## Phase 6 — Premium / cloud foundation

**Why:** Web is running on a temporary JSON file store. No real accounts, no sync, no persistence guarantee.

### 6.1 Supabase setup

- Create Supabase project
- Tables: profiles, journal_segments, journal_segment_vectors, highlights, annotations, bookmarks, reading_events, resonance_cache, settings, installed_packages
- Enable pgvector extension
- Set up RLS policies: user can only access own data
- Storage bucket for Book Package files

### 6.2 Replace JSON store with Supabase

- `WebDataLayer` → `CloudDataLayer` (wraps Supabase client)
- Journal: supabase insert/update/delete with RLS
- Reading state: highlights/annotations/bookmarks in Supabase
- Vectors: store user entry vectors in `journal_segment_vectors` table
- Settings: per-user key/value in `settings` table

### 6.3 Web premium-only gate

- Middleware: check auth cookie
- Login page: Supabase Auth (email/password or magic link)
- Only premium-tier accounts can log in
- No signup flow on web yet (account creation via mobile or direct Supabase dashboard)

### 6.4 Mobile cloud DataLayer

- Free tier: `LocalMobileDataLayer` (SQLite + local models) — current behavior
- Premium tier: `CloudMobileDataLayer` (Supabase + API) — syncs with web
- Auth state determines which implementation is active
- Journal sync: cloud is source of truth, mobile pushes/pulls
- Conflict: server-authoritative, last-write-wins for segments

### 6.5 Verification

- Non-auth web visitor cannot access any app route
- Non-premium account cannot log in on web
- Premium user sees same journal on web and mobile
- RLS prevents cross-user data access
- Writing on web appears on mobile premium within seconds

---

## Phase 7 — Book Package system

**Why:** Library is currently hardcoded seed data. No way to add content without code changes.

### 7.1 Package manifest format

```json
{
  "id": "church-fathers",
  "label": "The Church Fathers",
  "description": "Writings from the early Church Fathers.",
  "size_mb": 45,
  "type": "voice",
  "license": "Public Domain",
  "books": [...],
  "vector_sets": {
    "gte-small": {"size_mb": 12, "url": "..."},
    "bge-small-en": {"size_mb": 12, "url": "..."}
  },
  "checksum": "sha256:..."
}
```

### 7.2 Deployable package catalog

- Move from absolute build path to `apps/web/data/packages/available_packages.json`
- Or Supabase Storage bucket with manifest
- Initially hardcode 4 packages (Additional Translations, Church Fathers, Medieval Mystics, Reformation)

### 7.3 Install flow

1. User taps "Install" in Settings or Library package discovery
2. Download package text JSON
3. Download vectors matching active embedding model
4. Verify checksum
5. Insert books + passages into DB
6. Activate: passages become searchable, vectors participate in resonance
7. Show progress and "Installed" confirmation

### 7.4 Uninstall flow

1. Remove passages for package's books
2. Remove books
3. Remove vector files
4. Remove or preserve reading marks (user choice)
5. Update installed_packages table
6. Reload Library vector store

### 7.5 Package discovery surface

- Library icon in Word header
- Opens package browser: installed + available
- Shows size, license, book count, description
- Install/uninstall from this surface

### 7.6 Verification

- Install a package → appears in Library
- Passages are searchable
- Vectors participate in resonance
- Uninstall removes everything
- Re-install restores

---

## Execution order

Each phase is independently shippable (no phase blocks another's deploy).

| Phase | Priority | Why |
|---|---|---|
| 1 — Vectors + embedding | **Highest** | Core differentiator doesn't work without this |
| 2 — Reader completeness | **High** | Cross-refs dead, search broken, no send-to-journal — user-facing gaps |
| 3 — Shared Journal | **High** | Web journal is a completely different (worse) product than mobile |
| 4 — Shared Patterns | **Medium** | Already functional but separate implementations |
| 5 — Shared Settings | **Medium** | Works but model selection isn't real |
| 6 — Premium/cloud | **Medium** | Depends on Supabase project creation (user action) |
| 7 — Book packages | **Low** | Seed library is sufficient for now |

---

## Verification gates for every phase

Before declaring any phase done:

1. `npm run typecheck:packages && npm run typecheck:mobile && npm run typecheck:web` passes
2. `npm run build` passes (same benign react-native-web warnings acceptable)
3. `git diff --check` clean
4. Push to GitHub main
5. Wait for Railway auto-deploy to pick up new SHA
6. `curl` all affected endpoints with auth cookie against production URL
7. Assert response bodies contain expected data (not empty arrays, not error messages)
8. Browser-verify affected screens respond correctly

---

## Anti-patterns to avoid

1. **Never** import DB/API modules directly in shared screens — only `useDataLayer()`
2. **Never** use `@expo/vector-icons` in shared packages — only `packages/ui/src/icons.tsx`
3. **Never** call `useNavigation()` in shared screens — navigation via callback props
4. **Never** write platform-specific code (`Platform.OS`, `window`, `document`) in shared screens
5. **Never** report "verified" until curl confirms real data in response body
6. **Never** use generic `LLM_MODEL` env var for Resonance — only `RESONANCE_LLM_MODEL`
7. **Never** deploy vectors as a single 389 MB file — always quantize + shard
