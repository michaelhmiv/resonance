# Resonance — Implementation Plan

> **For implementer:** This is a feature-level plan. It describes what to build and why,
> not line-by-line code. You are expected to make implementation choices within each task.
> The app is a private, offline-first Christian spiritual app with three tabs (Journal · Word · Patterns),
> a continuous journal document, ambient resonance footnotes, pre-computed multi-vector library,
> and reading features. Everything runs locally. Nothing leaves the device.
>
> **Design spec:** `/data/resonance/plans/2026-06-24-resonance-design-spec.md`

**Goal:** Build a complete, offline-first Christian spiritual app for Android (first) and iOS (later) with three tabs — Journal (continuous writing surface with ambient resonance), Word (sacred reading surface), and Patterns (reflective trends over time).

**Architecture:** Build-machine pipeline pre-computes all Library vectors (per embedding model) and ships them as static app assets + downloadable Book Packages. The phone only embeds user text at runtime (~50ms per sentence). Multi-vector system: each Book Package ships separate vector files per supported model. Zero on-device re-embedding of Library content ever.

**Tech Stack:** React Native (Expo bare workflow), TypeScript, FlashList, Zustand, react-native-quick-sqlite, ONNX Runtime Mobile (`onnxruntime-react-native`), Python build pipeline. All architecture decisions locked — see Architecture Decisions below.

---

## Architecture Decisions (All Locked — Approved by Michael 2026-06-24)

### AD-1: Framework — React Native (Expo bare workflow) ✅

**Decision:** React Native with Expo, bare workflow.

**Why:**
- TypeScript ecosystem — aligns with existing expertise
- `onnxruntime-react-native` is Microsoft's official ONNX Runtime React Native binding — proven, maintained
- `react-native-quick-sqlite` or `expo-sqlite` for local database
- Single codebase for Android + iOS (iOS needed ~1 week after Android — no rewrite)
- Good text rendering with custom serif fonts
- Zustand for state management (familiar pattern)

**Key constraint:** iOS may ship as soon as one week after Android. Native Kotlin was rejected because it would require a full rewrite for iOS. React Native shares the entire codebase across platforms.

**Bare workflow from the start** — managed workflow won't support the native modules (ONNX Runtime, SQLite) we need. This is expected, not a blocker.

### AD-2: Continuous Journal — FlashList + Segment Model ✅

**Decision:** Custom renderer built on FlashList with a segment-based document model. Focus manager built as a first-class module before the editor itself.

**The journal is a scrolling list of typed segments:**
```
[ date_divider ]     — non-editable rendered cell
[ text segment ]     — editable via TextInput (only one active at a time)
[ footnote ✦ ]       — non-editable rendered cell
[ resonance cards ]  — expandable, attached to a footnote
[ text segment ]     — editable
[ verse_of_day ]     — non-editable rendered cell
```

**Key insight:** Only one text segment is editable at a time — the one the user is actively typing in. Everything else is static. This isn't "build a rich text editor." It's "build a high-performance list where one item has a TextInput and the rest are rendered cells." This pattern is used by Discord's mobile app and major chat apps in production RN.

**Focus manager (critical path — built first):**
- Tracks which text segment is active
- Handles cursor position when user taps between segments
- Splits segments when the user types into a non-text boundary
- Merges adjacent text segments when content between them is removed
- Manages keyboard avoidance (the active input stays visible above the keyboard)
- Handles paste (splitting at cursor position, inserting text segment between others)

**Rejected alternatives:**
- WebView + TipTap/ProseMirror: WebView boundary makes ONNX integration harder, typography is indirect (CSS), performance degrades on Android with long documents. Wrong trade for a writing-first app.
- Single TextInput + overlay: Can't insert non-editable elements into text flow. Footnotes can't sit inside the text at a specific position. Fundamentally doesn't support the mixed-content model.

### AD-3: Vector Storage Strategy

**Recommendation:** In-memory vector store for the Library, SQLite blobs for user entries.

| Data | Storage | Why |
|---|---|---|
| Library vectors (seeded) | Binary file bundled as app asset, loaded into memory at startup | 50K passages × 384 dims × 4 bytes = ~77MB. Fits in memory on modern phones. Cosine similarity is fast against in-memory arrays. |
| Library vectors (package downloads) | Binary file on disk, loaded into memory at app startup / package install | Same — merge into the in-memory store |
| User entry vectors | SQLite blob columns | Small, grows over time, needs persistence with the entry |

**Cosine similarity:** Pure JS/TypeScript implementation for the similarity computation. For 50K+ vectors at 384 dims, this is a simple dot-product + norm — ~5-10ms on modern phone CPUs. No native extension needed for v1. If performance becomes an issue, add `react-native-ml-kit` or a native vector search library later.

### AD-4: Build Pipeline Location

**Recommendation:** Python, living in a `build/` directory within the app repository.

**Why:**
- Build pipeline runs once per model + corpus update, not at runtime
- Python has the best embedding ecosystem (sentence-transformers, HuggingFace Hub)
- Produces artifacts that get bundled into the app or served as package downloads
- No need for a separate service or infrastructure

---

## Data Model

### Library Data (bundled / downloaded, read-only at runtime)

```
books
  id, title, author, era, package_id, type [bible|voice], translation [null for non-bible]

passages
  id, book_id, chapter, verse_start, verse_end, text, chunk_type [phrase|paragraph]

Library vectors (NOT in SQLite — binary files)
  Per model: vectors_<model_id>.bin (raw float32 array, 384-dim per passage)
  Loaded into memory at startup, indexed by passage_id

cross_references
  from_ref, to_ref  (e.g. "John 3:16" → "1 John 4:9")
```

### User Data (local SQLite, read-write)

```
journal_segments
  id, created_at, updated_at, segment_type [text|date_divider|verse_day|footnote|resonance_cards],
  text, position_index, parent_date

journal_segment_vectors
  segment_id, vector_blob  (for text segments that have been embedded)

resonance_history
  id, segment_id, passage_id, surfaced_at
  (tracks what surfaced, for recency penalty)

highlights
  id, verse_ref, color, created_at
  (shared across translations — keyed by verse reference)

annotations
  id, verse_ref, translation, text, created_at
  (per-translation — keyed by verse ref + translation)

bookmarks
  id, verse_ref, created_at, label

app_settings
  key, value  (model_id, default_translation, font_size, theme, app_lock, etc.)

installed_packages
  package_id, version, model_id, installed_at
```

### Verse of the Day

Pre-built curated sequence (not a database table). A JSON file with 365 entries, each containing a passage reference. Indexed by day-of-year. Drawn from Psalms, Gospels, Epistles, and select prophetic passages. Avoids genealogies, censuses, and distressing passages out of context.

---

## Data Flow

### Runtime Resonance Flow

```
User writes in Journal
       │
       ▼
Sentence boundary detected (period, question mark, or brief pause)
       │
       ▼
Embed the sentence/phrase (~50ms, ONNX Runtime, on-device)
       │
       ├── Cosine vs Library vectors (in-memory, ~5-10ms)
       │   ├── Scripture vectors → top candidates
       │   └── Voice vectors → top candidates
       │
       └── Cosine vs user's own past entry vectors (SQLite blobs, ~1-2ms)
           └── Top candidate (including "where you were" connections)
                    │
                    ▼
              Selection Algorithm
              ├─ Recency penalty (× 0.3 if < 7 days, × 0.6 if < 30 days)
              ├─ Category diversity ( Psalm + Gospel + Epistle + Prophet mix)
              ├─ Weighted random (top 15 → probability distribution → pick 3)
              └─ Seed determinism (hash of sentence text → reproducible)
                    │
                    ▼
              ✦ footnote mark settles at sentence end
              (user taps to expand cards inline)
```

### Book Package Download Flow

```
User taps "Add" on a package in Word → Library browser
       │
       ▼
Download package file: text.json + vectors_<active_model>.bin
       │
       ▼
Parse text + metadata → insert into books + passages tables
       │
       ▼
Load vectors into in-memory vector store (merge with existing)
       │
       ▼
Mark package as installed in installed_packages table
       │
       ▼
Text immediately available in Library + resonance
```

### Cross-Tab Bridge Flows

```
[Journal → Word]
Resonance card → "Read in Word" action
       │
       ▼
Navigate to Word tab → Scripture view → book/chapter/verse
(Passage opens in full context: surrounding verses, full chapter)

[Word → Journal]
Reading view → "Send to Journal" action
       │
       ▼
Navigate to Journal tab → insert quoted block at cursor position
(Quoted passage appears as a styled block in the continuous document)
```

---

## Phase 0: Build Pipeline (Python, Build Machine)

### Task 0.1: Bible ingestion + phrase-level chunking

**Objective:** Take Bible JSON (BibleSuperSearch format) and produce chunked passages with metadata.

**What to build:**
- Script that reads Bible JSON files (KJV, WEB initially)
- Chunks Bible into phrase-level passages (verse clauses split at natural punctuation — "Come to me, all who labor" and "I will give you rest" as separate chunks for Matthew 11:28)
- Outputs: `bible_passages.json` — `[{id, book, chapter, verse_start, verse_end, text, translation, chunk_id}]`
- Also outputs a `books` metadata file: `[{id, title, author (null for Bible), type: bible, translation}]`

**Acceptance:** Run script on KJV + WEB. Output JSON files contain all 66 books, ~31K verses, ~50K+ phrase-level chunks per translation. Each chunk has a stable ID.

### Task 0.2: Voices (saints/mystics) ingestion + paragraph-level chunking

**Objective:** Take the public-domain Christian text collection (already staged on the build machine) and produce chunked passages.

**What to build:**
- Script that reads text files from the corpus directory (Gutenberg/CCEL/IA downloads)
- Chunks into paragraph-level passages (natural paragraph breaks, not fixed-size)
- Extracts author + work title from filename/metadata
- Outputs: `voice_passages.json` — `[{id, author, work, text, chunk_id}]`
- Also outputs `books` metadata: `[{id, title, author, era, type: voice, translation: null}]`

**Acceptance:** Run script on the staged corpus. Output JSON contains all authors + works, ~50K+ paragraph-level passages. Each passage has author, work, and stable ID.

### Task 0.3: Cross-reference ingestion

**Objective:** Ingest the Treasury of Scripture Knowledge (340K+ cross-reference pairs).

**What to build:**
- Script that reads TSK data (CSV/JSON from scrollmapper/bible_databases)
- Normalizes verse references to a consistent format ("John 3:16", not "Jn 3:16" or "43:3:16")
- Outputs: `cross_references.json` — `[{from_ref, to_ref}]`

**Acceptance:** Cross-references file contains 340K+ pairs. Spot-check known references (e.g., John 3:16 → 1 John 4:9).

### Task 0.4: Embedding generation pipeline

**Objective:** Run the embedding model against all chunked passages and produce vector files. One run per model.

**What to build:**
- Script that loads a passage JSON file (bible + voices) and an embedding model (via sentence-transformers)
- Embeds each passage text → 384-dim (or model-specific dim) vector
- Outputs binary vector file: `vectors_<model_id>.bin` (raw float32 array, row-major, one row per passage in ID order)
- Also outputs a manifest: `vectors_<model_id>_manifest.json` — `{model_id, num_passages, dimensions, passage_ids: [...]}` (so the app can verify vector file matches passage set)
- Script accepts a `--model` flag so it can be run for each supported model
- Script accepts `--source [seeded|package:<id>]` to generate vectors for the seeded library or a specific Book Package

**Supported models for v1:**
- `embedding-gemma-300m` (default, 300MB)
- `gte-small` (70MB, lighter alternative)
- (Additional models added later — the pipeline supports it)

**Acceptance:** Run for seeded library with default model. Output binary file + manifest. Verify by loading vectors in a test script and checking that embedding the query "I am tired" returns Matthew 11:28-30 in the top 15.

### Task 0.5: Book Package assembly

**Objective:** Package the seeded library and individual Book Packages into the file format the app expects.

**What to build:**
- For the seeded library: assemble `seeded_library.zip` containing `bible_passages.json`, `voice_passages.json`, `cross_references.json`, `vectors_embedding-gemma-300m.bin`, `vectors_embedding-gemma-300m_manifest.json`, `verse_of_day.json`
- For each Book Package: assemble `<package_id>.zip` containing `passages.json`, `books.json`, `vectors_<model_id>.bin` (one per supported model), `vectors_<model_id>_manifest.json`, `package.json` (metadata: id, name, description, size, author_count)
- Output seeded library to `app/assets/seeded_library/` (bundled in app)
- Output Book Packages to `packages/` directory (served via static file host)

**Acceptance:** Seeded library zip contains all expected files. A Book Package zip (e.g., "Church Fathers") contains passages + vectors for each model. File sizes are within expected budgets (see storage budget reference).

### Task 0.6: Verse of the Day sequence generation

**Objective:** Produce a curated 365-day verse sequence.

**What to build:**
- A JSON file with 365 entries, each containing: `{day_of_year, verse_ref, translation}`
- Drawn from Psalms, Gospels, Epistles, and select prophetic passages
- No two consecutive days from the same book
- Avoids: genealogies (Num 3, 1 Chr 1-9), censuses, imprecatory psalms (Ps 58, 69, 109:6-20), and distressing passages out of context (Judges 19, etc.)
- Curated manually or semi-automatically with human review

**Acceptance:** 365 entries, each references a real verse. No genealogies or censuses. No same-book consecutive days. Spot-check specific passages are appropriate.

---

## Phase 1: App Shell + Foundation

### Task 1.1: Project scaffold with Expo

**Objective:** Create the React Native (Expo) project with the bare workflow, TypeScript, and base configuration.

**What to build:**
- Initialize Expo project with TypeScript template
- Configure bare workflow (not managed — we need native modules for ONNX Runtime + SQLite)
- Install core dependencies: `expo-sqlite` (or `react-native-quick-sqlite`), `onnxruntime-react-native`, `zustand`, `react-navigation` (bottom tabs + stack)
- Set up folder structure: `src/` (app code), `src/tabs/` (Journal, Word, Patterns), `src/components/`, `src/store/`, `src/db/`, `src/theme/`, `assets/` (fonts, seeded library)
- Bundle serif font (e.g., a readable serif like Source Serif Pro or Crimson Text) + sans-serif font for UI chrome
- Configure app permissions: zero network permissions needed for core functionality (only network for package downloads — declare but don't request upfront)

**Acceptance:** App builds and runs on Android emulator. TypeScript compiles clean. No native module errors.

### Task 1.2: Theme system

**Objective:** Implement the cream-and-serif visual language.

**What to build:**
- Theme constants: cream background `#faf9f6`, card surface white, brown accent `#8b7355`, highlight palette (2-3 soft tones)
- Typography system: serif font for body/quotes, sans-serif for UI chrome, serif italic for Scripture/voice quotes
- Reusable styled components: `CreamBackground`, `SerifText`, `SerifItalicText`, `SansText`, `Card` (white tile, hairline border, no shadow)
- Global stylesheet / ThemeProvider

**Acceptance:** A test screen renders cream background with serif text and a sample card. Fonts load correctly. No system font fallbacks visible.

### Task 1.3: Navigation structure

**Objective:** Three-tab bottom navigation + settings in header.

**What to build:**
- Bottom tab navigator with: Journal (default), Word, Patterns
- Header with app title ("Resonance") + settings gear icon (right side)
- Settings icon navigates to a full-screen Settings screen (via stack navigator)
- Tab icons: minimal, line-style (not filled). Journal: a simple line/paper icon. Word: an open book. Patterns: a subtle wave or circle.
- Tab bar styling: cream background, brown active indicator, sans-serif labels, no badges by default

**Acceptance:** App launches on Journal tab. Tap between all three tabs. Tap settings gear → full-screen Settings screen appears. Back returns to previous tab.

### Task 1.4: SQLite database setup

**Objective:** Initialize the local database with the full schema.

**What to build:**
- Database initialization module that creates all tables (see Data Model above)
- Migration system (version-based) for future schema changes
- Seed the database from the bundled seeded library assets on first launch
- Load the Library vectors binary file into memory (in-memory Float32Array)
- Store the vector manifest for verification
- Zustand store for database connection state (ready / loading / error)

**Acceptance:** App launches, database initializes without errors. Query books table → returns expected Bible books + voice works. In-memory vector store has correct passage count per manifest.

### Task 1.5: Library loading + verification

**Objective:** On first launch, load the seeded library into the database and verify integrity.

**What to build:**
- On first launch (detected by empty database), read bundled seeded library assets
- Insert books + passages into SQLite
- Load vectors binary into in-memory store
- Verify: passage count matches manifest, vector dimensions correct, no missing IDs
- If verification fails, show a quiet error state (not a crash)
- Subsequent launches: skip loading (database already populated), just load vectors into memory

**Acceptance:** First launch populates database. Second launch skips population but loads vectors. Query passage by ID returns text. In-memory vector store accessible.

---

## Phase 2: Word Tab (Reading Surface)

### Task 2.1: Scripture browser

**Objective:** Browse the Bible by book → chapter, with a translation selector.

**What to build:**
- Book list: 66 books (Old Testament + New Testament), grouped by testament
- Chapter grid: tap a book → see numbered chapters
- Reading view: tap a chapter → see all verses, one per line (verse-per-line toggle in settings)
- Translation selector in the reading view header (WEB ▾ / KJV ▾) — defaults to WEB
- Verse numbers as superscript or small inline numbers
- Navigation: next/previous chapter buttons, jump-to-book menu
- Serif font, generous line-height, cream background

**Acceptance:** Browse to Matthew 11. See verses 1-30 rendered in WEB. Switch to KJV. Navigate to Matthew 12. Navigate back.

### Task 2.2: Library browser (Book Packages)

**Objective:** Browse the Library by Book Package, showing seeded packages as present and additional packages as available.

**What to build:**
- Library icon in the Word tab header (discrete, not in Settings)
- Library browser opens when tapped
- Two sections: "Installed" (seeded packages + any downloaded packages, with item counts) and "Available" (packages not yet installed, with size + one-line description)
- Available package categories: Mystics & Contemplatives, Church Fathers, Reformation Classics, Devotional & Poetic, Additional Translations
- Gentle, dismissible indicator on the library icon when new packages are available (opt-out in Settings)
- Tapping an installed package → browse by author/work → open a text in reading view
- Tapping an available package → preview with description + size → "Add" button (deliberate action, no background fetching)

**Acceptance:** Library icon in header. Tap → see installed packages (Bible: WEB, Bible: KJV, seeded voices). See available packages listed. Open an installed voice work → reading view shows the text.

### Task 2.3: Reading view for Library texts

**Objective:** Render voice/Libary texts in the reading view, with passage navigation.

**What to build:**
- Reading view for non-Bible texts: author + work title in header, paragraph-level passages rendered in serif font
- Chapter/section navigation for works that have natural divisions
- Progress indicator (subtle — how far through the work)
- Same reading features as Bible (highlight, annotate, bookmark — built in Task 2.4)

**Acceptance:** Open Teresa of Ávila's "Interior Castle" → see text rendered in serif, paragraph by paragraph. Navigate forward/backward through sections.

### Task 2.4: Highlight, annotate, and bookmark

**Objective:** Implement the three reading interaction features.

**What to build:**

**Highlight:**
- Long-press or select text → highlight toolbar appears
- Choose from a small curated palette of 2-3 soft tones (e.g., warm gold, soft sage, muted rose)
- Highlight is stored keyed by `verse_ref` (for Bible) or `passage_id + char_range` (for Library texts)
- **Cross-translation for Bible:** highlight on John 3:16 in WEB also appears in KJV (keyed by verse reference)
- Highlights aggregate into Patterns tab

**Annotate:**
- Long-press or select text → "Annotate" option
- Opens a small margin note input
- **Per-translation for Bible:** annotation on John 3:16 in WEB does NOT appear in KJV
- Annotation marker (small ✎) appears in the margin next to annotated text
- Tap marker to read/edit the note

**Bookmark:**
- Bookmark icon in reading view header
- Marks current passage/chapter for return
- Bookmarks gather in a quiet list accessible from a bookmark icon

**Acceptance:** Highlight a verse in WEB, switch to KJV → highlight persists. Annotate a verse in WEB, switch to KJV → annotation not shown. Bookmark Matthew 11 → see it in bookmarks list → tap to return.

### Task 2.5: Cross-references (inline marginal links)

**Objective:** Show cross-references as understated marginal links, inline — not a side panel.

**What to build:**
- After each verse, check cross_references table for matching `from_ref`
- If cross-references exist, show a small subtle margin link (e.g., "✦ 3 refs" or a small linked number)
- Tapping the link shows a gentle expandable list of referenced verses below
- Each cross-reference verse shows: text (serif italic) + reference + "Open" (navigates to that passage in context)
- Visually quiet — does not compete with the reading text

**Acceptance:** Reading John 3:16 → see a small margin indicator for cross-references. Tap → see 1 John 4:9 and others listed below. Tap "Open" on one → navigate to that verse in context.

### Task 2.6: Search

**Objective:** Search within Scripture or across Library texts.

**What to build:**
- One calm search field, accessible from the Word tab
- Scope toggle: "Scripture" or "Library" (or "All")
- Results are passage cards (same anatomy as resonance cards): text (serif italic), source line, "Read in Word" action
- Results ranked by relevance (text search, not semantic)
- Tapping a result → navigates to the passage in reading view
- No autocomplete, no suggestions — just plain text search of what the user owns

**Acceptance:** Search "shepherd" in Scripture → see Psalm 23, John 10, Ezekiel 34, etc. as passage cards. Tap one → opens in reading view. Search "interior castle" in Library → see matching Teresa passages.

### Task 2.7: Send to Journal

**Objective:** While reading, send a passage into the Journal as a quoted block.

**What to build:**
- In the reading view, an action (e.g., in a share/menu affordance) labeled "Send to Journal"
- Tapping it navigates to the Journal tab and inserts the passage as a styled quoted block at the current writing position
- The quoted block is visually distinct (serif italic, indented, with source line) — clearly not the user's own words
- The user can then write toward or around the quoted passage

**Acceptance:** Reading Psalm 23 → select "Send to Journal" → Journal tab opens with Psalm 23 inserted as a quoted block at the cursor. Continue writing around it.

---

## Phase 3: Journal Tab (Writing Surface)

### Task 3.1: Focus manager (critical path — build first)

**Objective:** The foundational module that manages which text segment is active, handles cursor continuity between segments, and manages segment splitting/merging. This is the spine of the continuous journal — build it before the editor itself.

**What to build:**
- **Active segment tracking:** a Zustand store that knows which `segment_id` is currently editable (only one at a time)
- **Focus transition:** when the user taps into a different text segment, focus moves cleanly — the old segment becomes a static cell, the new one becomes an active TextInput. Cursor lands at the tap position.
- **Segment splitting:** when the user types into a position adjacent to a non-text segment (e.g., a footnote), the text segment splits at the cursor — content before the cursor stays in the current segment, content after goes into a new text segment on the other side.
- **Segment merging:** when the user backspaces through a non-text segment boundary (e.g., deletes backward into a footnote), the non-text segment is removed and the two adjacent text segments merge into one. Cursor lands at the merge point.
- **Paste handling:** when the user pastes multi-paragraph text, it splits into multiple text segments at paragraph boundaries. Inserted between surrounding segments cleanly.
- **Keyboard avoidance:** the active TextInput stays visible above the keyboard. When a footnote or card expands, the view scrolls to keep it visible.
- **Return key behavior:** pressing Enter creates a new text segment (line break within the same segment — not a new segment per line, since the journal is continuous prose, not line-by-line)
- **Cursor position API:** `getCursorPosition(): {segment_id, offset}` and `setCursorPosition(segment_id, offset)` — used by the embedding system to know where to insert footnotes

**Acceptance:**
- Tap between two text segments → focus transitions cleanly, cursor at tap position
- Type at a boundary → segments split correctly
- Backspace through a footnote → footnote removed, text segments merge
- Paste a 3-paragraph text → splits into 3 segments
- Keyboard appears → active input stays visible
- Cursor position API returns correct values after each interaction

### Task 3.2: Continuous document renderer (FlashList)

**Objective:** The visible journal surface — a FlashList rendering typed segments with the focus manager powering the active text segment.

**What to build:**
- Segment-based document model: an ordered list of typed segments stored in Zustand + SQLite
- Segment types: `text` (editable via TextInput when active), `date_divider` (non-editable), `verse_of_day` (non-editable card), `footnote` (non-editable ✦ mark), `resonance_cards` (expandable, attached to a footnote)
- FlashList renders segments lazily (only visible + buffer) — handles months/years of entries without lag
- The active text segment renders a `TextInput` with the serif font; inactive text segments render as static `Text` cells (so they're not interactive — only the focused one is)
- **Opens at "now"** — scrolls to the bottom (most recent writing point) on launch
- Scroll up to look back at previous days
- Placeholder text "Whatever is real." when the document is empty
- Relies on the focus manager (Task 3.1) for all active-input transitions

**Acceptance:** Open Journal tab → see "Whatever is real." placeholder. Type text → it appears. Close app → reopen → lands at the same position, text preserved. Scroll up → see earlier writing. Type in one segment, tap to another → focus transitions via the focus manager.

### Task 3.3: Auto-save (every keystroke, debounced)

**Objective:** The journal never has a "save" moment because it's always saved.

**What to build:**
- Debounced auto-save: writes to SQLite every ~1-2 seconds after the last keystroke
- Saves the active text segment's content + position
- On app crash or force-kill, at most ~2 seconds of writing is lost (the debounce window)
- On relaunch, the user lands exactly where they were — mid-sentence if necessary
- No visible saving indicator — it's invisible

**Acceptance:** Type a sentence, immediately force-kill the app. Reopen → the text is there (or at most the last 1-2 seconds of typing is missing). Type continuously for 5 minutes → no data loss.

### Task 3.4: Date dividers

**Objective:** Automatically insert soft date dividers at calendar day boundaries.

**What to build:**
- When a new calendar day begins (midnight), a `date_divider` segment is auto-inserted into the document
- Date divider renders as: quiet serif date inline in the text flow, separated by em-dashes (e.g., "── Wednesday, June 24 ────────")
- If the user writes at 11:50 PM and continues at 12:10 AM, the divider appears inline between the two text segments — writing continues seamlessly
- On reopening the app on a new day, a fresh date divider + verse of the day await at the end of the document

**Acceptance:** Write a sentence at 11:58 PM. Wait 2 minutes. Write another sentence. A date divider appears between them. Close and reopen the next day → new date divider at the end.

### Task 3.5: Calendar navigation

**Objective:** Calendar icon in the Journal header → tap a date → smooth scroll to that day.

**What to build:**
- Calendar icon in the Journal header (left side)
- Tap → month grid overlay appears (cream paper texture matching the app)
- Days with writing carry a soft dot; days without stay open and calm
- Previous/next month navigation
- Tap a day with writing → overlay closes → document smoothly scrolls to that day's date divider
- Tap a day without writing → does nothing (or scrolls to nearest day with writing)
- No "X days in a row" language, no streaks, no counts

**Acceptance:** Write on June 23 and June 24. Open calendar → see dots on those days. Tap June 23 → document scrolls to that day's divider. June 22 (no writing) has no dot and does nothing on tap.

### Task 3.6: Verse of the day

**Objective:** Display a verse of the day in the quiet space at new day dividers.

**What to build:**
- Load the verse-of-the-day sequence (365 entries, indexed by day-of-year)
- At each new day's date divider, show a verse-of-the-day card: quote (serif italic), source line, "Read in Word" action
- Same card anatomy as a resonance card
- Verse is deterministic to the date — every device sees the same verse on the same day
- **Recedes as writing fills:** once the user starts writing after the divider, the verse card visually retreats (fades to a smaller, quieter form or collapses to a minimal reference line)
- The verse is NOT personalized — it belongs to the calendar, not to the user's data
- Tapping "Read in Word" navigates to the passage in the Word tab

**Acceptance:** Open the app on a new day → see verse of the day card at the new day divider. Start writing → verse card recedes. Tap "Read in Word" → navigates to that verse in the Word tab.

### Task 3.7: Journal search (pull-down)

**Objective:** Search the user's own past writing for a word or phrase.

**What to build:**
- Pull down from the top of the Journal → a quiet search field appears (not persistent)
- Simple text search of the user's own words — no semantic search, no embeddings
- Matching text highlights inline in the scroll
- Up/down arrows to jump between matches
- Search closes when the user pulls back up or taps "done"
- Only searches `text` segments, not dividers/cards/footnotes

**Acceptance:** Write "exhausted" on multiple days. Pull down → search "exhausted" → matches highlight inline. Use up/down arrows to jump between them. Pull up → search closes.

---

## Phase 4: Embedding + Resonance

### Task 4.1: First-launch embedding prompt

**Objective:** The only prompt in the entire app — offer to download the embedding model.

**What to build:**
- On first launch, if no embedding model is present, show the prompt (see design spec §9.2)
- Prompt text: plain language, no jargon. "Resonance can find Scripture and voices that echo what you write." + "This works by reading your words locally on your device — nothing you write ever leaves your phone." + "To enable this, a small file (~70MB) downloads once and stays on your device."
- Two buttons: "Not now" and "Enable resonance"
- "Not now" is a real choice — Journal is fully functional without resonance, just no footnotes
- If declined: a one-line offer appears in Settings: "Enable resonance to find echoes in your Library."
- If enabled: model downloads in background. Journal is immediately writable. A quiet line appears once ready: "Resonance is ready."
- Prompt never reappears in the Journal after being shown once (whether accepted or declined)

**Acceptance:** First launch → prompt appears. Tap "Not now" → Journal works without footnotes. Settings shows the one-line offer. Tap "Enable resonance" → model downloads → "Resonance is ready" appears → footnotes begin appearing.

### Task 4.2: ONNX Runtime integration

**Objective:** Load the embedding model and embed user text on-device.

**What to build:**
- Load the embedding model (ONNX format) into ONNX Runtime Mobile at app startup (~1 second)
- Function: `embed(text: string): Float32Array` — takes a string, returns a vector
- Performance target: ~50ms per embedding on a typical phone
- No visible loading state — the model loads silently in the background at startup
- If model isn't downloaded (user declined), `embed()` is a no-op — no crash, no error
- Store model file in app-local storage

**Acceptance:** Model loads at app startup without visible delay. Call `embed("I am tired")` → returns a 384-dim Float32Array in <100ms on a modern phone. If model is absent, function gracefully no-ops.

### Task 4.3: Cosine similarity engine

**Objective:** Find the most relevant Library passages and user past entries for a given vector.

**What to build:**
- `cosineSimilarity(queryVec: Float32Array, matrix: Float32Array): Float32Array` — batched dot-product + L2 norm against an in-memory vector matrix
- Run against Library vectors (Scripture + voices) — returns top 15 candidates with scores
- Run against user entry vectors (from SQLite) — returns top 5 candidates
- Performance target: <10ms for 50K+ Library vectors
- Return structured results: `[{passage_id, score, type: scripture|voice|past_entry}]`

**Acceptance:** Embed "I am tired" → cosine similarity returns Matthew 11:28 ("Come to me, all who labor…") in the top 5 Library results. Execution completes in <15ms total.

### Task 4.4: Selection algorithm

**Objective:** Transform raw similarity scores into a varied, non-repetitive set of 3 resonance cards.

**What to build:**
- Input: top 15 Library candidates (scripture + voices) + top 5 user past entries
- **Recency penalty:** passage surfaced in last 7 days → score × 0.3; last 30 days → score × 0.6. Track via `resonance_history` table.
- **Category diversity:** ensure at least one Psalm + one Gospel + one Epistle + one Prophet when possible. After picking a Psalm, next Psalm candidate gets × 0.7 penalty. For voices, ensure different authors.
- **Weighted random:** convert top 15 adjusted scores to probability distribution, pick 3 without replacement
- **Seed determinism:** seed = hash of the sentence text → same sentence always gathers the same results
- Output: 3 selected passages — one Scripture, one voice, one past entry (when available)

**Acceptance:** Write "I am exhausted and overwhelmed" twice → same 3 cards both times (determinism). Write "I am grateful for today" → different cards. Write the same sentence 3 times over a week → not always the same Scripture (recency penalty + weighted random introduce variety over time).

### Task 4.5: Ambient resonance footnotes

**Objective:** The core interaction — ✦ marks appear after sentence boundaries, expandable to resonance cards.

**What to build:**
- **Sentence boundary detection:** monitor the user's text input for sentence-ending punctuation (period, question mark, exclamation mark) or a brief pause (~2-3 seconds of no typing)
- When a sentence boundary is detected:
  1. Take the completed sentence text
  2. Call `embed()` (~50ms)
  3. Call `cosineSimilarity()` + `selectionAlgorithm()` (~15ms)
  4. If results are found above a minimum threshold, insert a `footnote` segment into the document at the sentence's end position
  5. The footnote renders as a small ✦ mark — quiet, never modal, never a pop-up
- **The mark never appears mid-phrase** — it always lands at a natural breath
- If the user continues typing past the footnote, it stays in place
- Multiple footnotes per entry are encouraged — a longer entry with several ✦ marks becomes a layered reading experience
- The footnote never narrates a connection — no "this relates because…" text

**Acceptance:** Type "I've been carrying so much lately, and I don't know how to set it down." → after the period, a ✦ mark appears at the sentence end. Continue typing → the mark stays. Type more sentences → more marks appear. Marks never appear while mid-sentence.

### Task 4.6: Resonance card expansion

**Objective:** Tapping a ✦ footnote expands resonance cards inline beneath it.

**What to build:**
- Tap a ✦ footnote → the footnote segment transitions to `resonance_cards` type
- Three cards expand inline (in the document flow, not a modal/popup):
  1. **Scripture card:** quote (serif italic), reference, "Read in Word" action
  2. **Voice card:** author + work + quote (serif italic), "Read in Word" action
  3. **"Where you were" card:** past entry text, "9 days ago" (or similar), caption "where you were"
- Cards have two actions only: linger/save mark (✦) and "Read in Word"
- Saved cards (✦ pressed) are tracked for "Verses that linger" in Patterns
- Tapping the footnote again → cards collapse back to just the ✦ mark
- Footnote expansion state persists across app sessions (expanded stays expanded)

**Acceptance:** Type a sentence → ✦ appears → tap → three cards expand inline. Tap "Read in Word" on the Scripture card → navigates to Word tab with that passage in context. Close and reopen app → the footnote is still expanded.

### Task 4.7: Resonance history tracking

**Objective:** Record what surfaced for each footnote, powering the recency penalty and Patterns.

**What to build:**
- When a footnote is created, insert a row into `resonance_history`: `segment_id, passage_id, surfaced_at`
- When the selection algorithm runs, it queries `resonance_history` for passages surfaced in the last 7/30 days
- This data also feeds Patterns: recurring passages, recurring voices, verses that linger

**Acceptance:** Write several sentences over a few days. Query `resonance_history` → see all surfaced passages with timestamps. The selection algorithm does not re-surface the same passage within 7 days for similar writing.

---

## Phase 5: Patterns Tab

### Task 5.1: Calendar view (primary lens)

**Objective:** A calendar showing writing rhythm — soft dots on days with writing, no streaks.

**What to build:**
- Month grid view, cream paper texture matching the app
- Days with journal writing carry a **soft dot or texture** — never numbered, never counted
- Days without writing stay open and calm
- Previous/next month navigation (arrows)
- Tap a day with writing → gentle list of that day's journal segments (with one-line excerpts)
- No "X days in a row" language, no streak counters, no break indicators
- Also shows reading activity (from Word: highlights, bookmarks) as secondary texture — e.g., a slightly different dot color or inner ring

**Acceptance:** Write on June 23 and 24. Open Patterns → calendar shows dots on those days. Tap June 23 → see that day's writing excerpts. June 22 has no dot and doesn't respond to tap.

### Task 5.2: Recurring themes

**Objective:** Show what the user keeps returning to, as plain-named clusters.

**What to build:**
- Cluster journal entry vectors (from `journal_segment_vectors`) using K-means or DBSCAN
- Re-cluster periodically (weekly, in the background — not on every Patterns tab open)
- Assign plain-language labels to clusters: derived from TF-IDF keywords of the cluster's entries (e.g., "rest," "weariness," "longing")
- Display as soft word-weight or dot-cluster — no bar charts
- Each theme is tappable → shows the entries in that cluster with timestamps, so the user can read them in sequence
- **No "mood improvement" labels** — no clinical assessment, no trends graph. Just the entries gathered, for the user to notice shifts themselves.

**Acceptance:** After 2+ weeks of writing, open Patterns → see theme clusters like "rest" (5 entries), "longing" (3 entries). Tap "rest" → see those entries listed by date with excerpts. User can read them and notice how their writing about rest has changed over time.

### Task 5.3: Recurring passages & voices

**Objective:** Show which Scripture and Library texts appear most often in the user's resonance.

**What to build:**
- Query `resonance_history` for the most frequently surfaced passages and voices
- Display as a quiet list: passage text (serif italic, excerpted), source/author, frequency shown as **soft dots** (●●●○○ style), not numbers or progress bars
- Never a leaderboard — no ranking by count, no "most popular" header
- Caption in plain language: "You've lingered here before"
- Tapping a passage → opens in Word tab

**Acceptance:** After using resonance for several days, open Patterns → see a list of frequently surfaced passages. Each shows soft dots for frequency, not a number. Tap one → opens in Word.

### Task 5.4: Time-of-day texture

**Objective:** A faint visualization of when the user tends to write.

**What to build:**
- Bucket journal segment timestamps by hour of day
- Render as a faint dawning/dusk visualization — light marks distributed across a day arc, denser where the user writes more frequently
- No bar charts, no axis labels, no "average time" stat
- Visual feel is a soft gradient of dots across a horizontal day span (dawn to dusk to night), with more dots in the hours when the user writes
- Caption: "When you write" or similar quiet label

**Acceptance:** Write mostly at 7 AM and 10 PM over two weeks. Open Patterns → time-of-day visualization shows denser dots at morning and evening, sparse at midday.

### Task 5.5: Verses that linger

**Objective:** Gather the user's most-saved resonance cards in one quiet list.

**What to build:**
- Query resonance cards where the user pressed the save/linger mark (✦)
- Display as a quiet list: passage text (serif italic), source, when saved
- This is a personal collection — passages the user chose to return to
- Tapping → opens in Word tab

**Acceptance:** Tap the ✦ save mark on 5 different resonance cards. Open Patterns → "Verses that linger" section shows those 5 passages. Tap one → opens in Word.

### Task 5.6: Reflection moments (optional weekly gathering)

**Objective:** A gentle weekly word, offered quietly — template-filled, not generated.

**What to build:**
- Once per week (e.g., Sunday), compile a short reflection moment using templates:
  - "This week you wrote about [top theme] [N] times."
  - "You lingered on [most-saved verse reference]."
  - "You've been writing for [N] weeks."
- Inserted as a quiet card in the Patterns tab (not pushed into the Journal — the Journal is sacred space)
- Template-filled, not LLM-generated — no AI involvement
- The user can dismiss or read it
- Never a notification — just appears in Patterns when the user opens it

**Acceptance:** After one week of use, open Patterns on Sunday → see a reflection moment card with template-filled text about the week's themes and writing. It's quiet and gentle, not a dashboard summary.

---

## Phase 6: Book Package System

### Task 6.1: Package download + merge

**Objective:** Download a Book Package and merge its text + vectors into the local library.

**What to build:**
- Network module: download a package zip from static file host
- Download includes: `passages.json` + `books.json` + `vectors_<active_model>.bin` + manifest
- On download complete:
  1. Insert books + passages into SQLite (books + passages tables)
  2. Load vectors into the in-memory vector store (merge with existing vectors)
  3. Mark package as installed in `installed_packages` table
  4. Text immediately available in Library browser + resonance
- Download progress indicator (simple, honest — not a spinner that looks like "thinking")
- If download fails, allow retry without leaving partial data
- **No re-embedding** — vectors are pre-computed and downloaded, not generated on-device

**Acceptance:** Tap "Add" on "Church Fathers" package → downloads → progress shows → "Installed" → immediately browse Church Fathers texts in Library → new passages surface in resonance from next entry onward.

### Task 6.2: Model switching (vector set swap)

**Objective:** When the user switches embedding models in Settings, download new vectors for installed packages.

**What to build:**
- In Settings → Embedding model, user selects a different model
- App downloads `vectors_<new_model>.bin` for: the seeded library + all installed packages
- Old vectors are replaced, not kept (unless storage allows — but default is swap)
- User entry vectors: re-embedded on-device using the new model (only the user's own entries, ~50ms each, runs in background)
- Gentle progress: "Reshaping your Library…" — not a spinner, not an error state
- While switching: resonance footnotes pause (no new footnotes appear) until the swap is complete
- The model file itself also downloads if not already present

**Acceptance:** Switch from EmbeddingGemma-300M to GTE-small → model file downloads → vectors for seeded library + installed packages download → user entries re-embed → "Resonance is ready" → footnotes resume with new model. No data loss.

### Task 6.3: Package management UI

**Objective:** Full UI for managing installed packages in the Library browser.

**What to build:**
- In the Word tab → Library browser, installed packages show:
  - Package name, author count, passage count, installed date
  - "Remove" option (with gentle confirmation — "This will remove N texts from your Library")
  - Size occupied
- Available packages show:
  - Package name, description, size, author list preview
  - "Add" button (deliberate download)
- When new packages become available, a gentle dismissible indicator appears on the library icon
- Package list is fetched from a remote manifest (a static JSON file on the file host) — but the app works fine offline with just the installed packages

**Acceptance:** Install a package → see it in installed list with details. Remove it → texts disappear from Library. New packages available → indicator on library icon → tap → see them in available list.

---

## Phase 7: Settings & First-Launch

### Task 7.1: Settings screen

**Objective:** Full settings screen with all sections from the design spec.

**What to build:**

**Embedding model section:**
- Current model name + size + description
- Plain-language note: "This is local math that finds echoes in your Library. It does not interpret or generate text."
- Model selector (dropdown or list): shows available models with sizes
- "Download" button to get the selected model
- Storage used by current model + vectors
- Switching triggers Task 6.2

**Reading preferences section:**
- Default translation (WEB / KJV / others if installed)
- Font size slider
- Line spacing toggle (comfortable / compact)
- Verse-per-line toggle (on/off)
- Theme variant: cream (default), high-contrast (accessibility)

**Privacy & data section:**
- Single-line statement: "What you write never leaves this device."
- Export entries: generates a Markdown file of all journal writing → save to device or share
- Erase all data: clears all user data (entries, highlights, annotations, bookmarks, vectors) — with strong confirmation
- App lock: opt-in toggle. If on, choose biometric or PIN. App requires unlock on launch.

**Storage section:**
- Library footprint (total size of texts + vectors)
- Per-package size breakdown
- Model file size
- User data size (entries, vectors)
- Storage headroom (free space on device)

**Accessibility section:**
- Larger text (dynamic type support)
- High-contrast variant (darker text on warmer background)
- Reduced motion (slower or no card transitions)
- Dynamic type scaling

**Acceptance:** Open Settings → see all 5 sections. Change default translation → Word tab reflects it. Export entries → Markdown file generated. Toggle app lock → biometric/PIN prompt. Turn on high-contrast → text darkens. Change font size → text adjusts across all tabs.

### Task 7.2: First-launch sequence

**Objective:** The complete first-launch experience — light install, embedding prompt, library present.

**What to build:**
- On first launch:
  1. Database initializes (Task 1.5 — seeded library loads)
  2. Optional first-run greeting: "Your Library is already here — begin." (disappears after first writing session)
  3. Embedding model prompt appears (Task 4.1 — the only prompt)
  4. Whether accepted or declined, the Journal is immediately writable
  5. If accepted: model downloads in background → "Resonance is ready" → footnotes begin
- No onboarding flow, no tutorial, no account creation, no permissions dialogs (except storage for export, requested only when exporting)
- Subsequent launches: skip all of the above, go straight to Journal

**Acceptance:** Fresh install → Library loads → greeting appears → embedding prompt appears. Tap "Enable resonance" → Journal is writable immediately → model downloads → "Resonance is ready" → footnotes appear after sentences. Fresh install → tap "Not now" → Journal works, no footnotes. Settings has the one-line offer.

---

## Phase 8: Cross-Tab Integration + Polish

### Task 8.1: Read in Word (Journal → Word bridge)

**Objective:** "Read in Word" action on resonance cards navigates to the passage in full context.

**What to build:**
- Every resonance card (Scripture + voice) has a "Read in Word" action
- Tapping it: switches to Word tab → opens the passage in the reading view with full context (surrounding verses for Scripture, surrounding paragraphs for voices)
- Navigation deep-link: the Word tab receives the target passage reference and scrolls to it
- If the user was reading something else in Word, the new passage replaces it (with back navigation to return)

**Acceptance:** In Journal, tap "Read in Word" on a Scripture resonance card for Matthew 11:28 → Word tab opens → Matthew 11 is displayed, scrolled to verse 28 → surrounding verses are visible. Back button returns to previous Word position.

### Task 8.2: Send to Journal (Word → Journal bridge)

**Objective:** While reading, send a passage into the Journal as a quoted block.

**What to build:**
- Already described in Task 2.7 — this task verifies the full cross-tab integration
- The quoted block in the Journal is visually distinct (serif italic, indented, with source line)
- The quoted block is a non-editable segment in the document model
- The user can tap it to collapse/expand, or "Remove" it if they change their mind

**Acceptance:** Reading Psalm 23 in Word → "Send to Journal" → Journal opens → Psalm 23 appears as a quoted block at cursor position → user writes around it → the block persists.

### Task 8.3: Privacy hardening

**Objective:** Make it verifiable that nothing leaves the device.

**What to build:**
- App requests zero network permissions at the OS level (except for explicit package downloads)
- All user data stored in app-local SQLite (no cloud sync, no analytics, no crash reporting, no ad SDKs)
- Network manifest: a clear list of what the app can contact and why (only the static file host for package downloads)
- Export: Markdown file of all journal entries, with metadata (dates, surfaced passages)
- Erase: complete data wipe, including vectors, history, highlights, annotations, bookmarks
- App lock in Settings: biometric or PIN, opt-in (off by default)

**Acceptance:** Check Android app permissions → only "Network" (for downloads), no storage access beyond app-local, no contacts, no location, no microphone. Export → valid Markdown file. Erase → database is empty. App lock → enabled → requires PIN/biometric on launch.

### Task 8.4: Performance optimization

**Objective:** Ensure the app feels instant and seamless.

**What to build:**
- Vector store loads at app startup in background (not blocking the UI)
- Journal document lazy-loads segments (FlatList/FlashList) — handles years of entries without lag
- Embedding runs on a background thread (not the UI thread)
- Cosine similarity runs on a background thread
- Database queries use proper indexes (passage_id, book_id, verse_ref, created_at)
- Memory budget: Library vectors ~77-120MB in memory, app should target <250MB total memory usage
- No jank on scroll in any tab

**Acceptance:** Open Journal after 6 months of daily writing → scrolls smoothly with no lag. Type a sentence → footnote appears with no visible delay. Open Word → Bible loads instantly. Switch tabs → no delay.

### Task 8.5: iOS adaptation (later phase)

**Objective:** Adapt the app for iOS after Android release.

**What to build:**
- Verify ONNX Runtime works on iOS
- Test custom serif font rendering on iOS
- Adapt navigation for iOS conventions (e.g., tab bar styling, safe areas)
- Test SQLite performance on iOS
- App Store preparation (privacy labels, no analytics declaration)
- iOS-specific accessibility (Dynamic Type, VoiceOver)

**Acceptance:** App builds and runs on iOS simulator. All features work. No platform-specific crashes.

---

## Implementation Priority

For a first release (MVP), the recommended order is:

| Priority | Phases | What you get |
|---|---|---|
| **P0** | Phase 0 (build pipeline) + Phase 1 (app shell) | App builds, navigates, database ready, Library loaded |
| **P1** | Phase 2 (Word, Tasks 2.1-2.5) + Phase 3 (Journal, Tasks 3.1-3.5) | Reading + writing work. A usable app without resonance. |
| **P2** | Phase 4 (embedding + resonance) | The core differentiator — ambient footnotes, resonance cards |
| **P3** | Phase 2 (Task 2.6-2.7) + Phase 3 (Task 3.6) + Phase 6 (packages) + Phase 7 (settings) | Complete app with search, cross-tab bridges, settings, packages |
| **P4** | Phase 5 (Patterns) | The reflective layer |
| **P5** | Phase 8 (polish, iOS) | Production-ready |

**Seamlessness check at each priority:** every priority level must preserve the "open and write" experience. No stage should require the user to configure something before writing.

---

## Prerequisites (What's Needed Before Implementation Starts)

### Already on the build machine ✅

| Item | Status | Detail |
|---|---|---|
| Node.js 22 + npm 10 | ✅ Available | |
| Python 3.12 | ✅ Available | |
| sentence-transformers 5.6 | ✅ Available | For build pipeline |
| torch 2.12, transformers 5.12, numpy | ✅ Available | |
| HuggingFace CLI | ✅ Available | For downloading models |
| all-MiniLM-L6-v2 cached | ✅ Available | Legacy fallback model, already downloaded |
| Bible JSON (KJV, WEB, ASV) | ✅ Available | `/data/resonance/corpus/bible/` — BibleSuperSearch format, 31,103 verses each |
| Saints/mystics texts (18 works) | ✅ Available | `/data/resonance/corpus/saints/` — Augustine, Teresa, John of Cross, Julian, Kempis, Brother Lawrence, Bunyan, Aquinas, Bernard, Bonaventure, Anselm, Catherine, Pascal, Kierkegaard, Francis de Sales, Cloud of Unknowing |
| Church Fathers (staged) | ✅ Available | 154 CCEL files + 76 IA files + 22 Gutenberg files in `/data/resonance/corpus_staging/` |
| Cross-references (TSK) | ⚠️ Needs download | From `scrollmapper/bible_databases` GitHub repo |
| Disk space | ✅ 11GB free | Sufficient for build pipeline + model downloads |
| npx | ✅ Available | For Expo CLI |

### Needs to be set up ⚠️

| Item | What's needed | Blocking? |
|---|---|---|
| **Android SDK** | Install Android SDK + build tools. No SDK, Java, or emulator currently on the machine. Needed for building/testing the React Native app on Android. | Yes — blocks Phase 1 |
| **Java (JDK)** | Java 17+ for Android builds. Not currently installed. | Yes — blocks Phase 1 |
| **Expo CLI** | `npm install -g expo-cli` (or use `npx expo`). Quick install. | No — can install when starting Phase 1 |
| **Git user config** | Set `user.name` and `user.email` for commits. Not currently configured. | No — quick setup |
| **Embedding model downloads** | EmbeddingGemma-300M and GTE-small need to be downloaded via HuggingFace CLI. Only all-MiniLM-L6-v2 is currently cached. | Yes — blocks Phase 0 Task 0.4 (embedding generation) |
| **Cross-references (TSK)** | Download from `scrollmapper/bible_databases` GitHub repo. | Yes — blocks Phase 0 Task 0.3 |
| **Serif font files** | Source a readable serif font (e.g., Source Serif Pro, Crimson Text, or similar — must be open license). Needed for the cream-and-serif visual language. | No — can source when starting Phase 1 Task 1.2 |
| **Static file host** | For serving Book Packages (S3 bucket, CDN, or GitHub Releases). | No — only needed for Phase 6 (Book Package downloads) |
| **GitHub repo** | Create a new repository for the app if one doesn't exist yet. | No — can create when starting Phase 1 |

### Michael needs to provide

1. **Android development setup**: I need Java (JDK 17+) and the Android SDK installed on this machine to build and test the React Native app. Do you want me to install these, or will you set them up?

2. **Model download approval**: I need to download EmbeddingGemma-300M (~300MB) and GTE-small (~70MB) from HuggingFace. That's ~370MB of model files. Shall I proceed?

3. **Git identity**: Your preferred name + email for git commits, or should I use a placeholder until you set one?

4. **GitHub repo**: Should I create a new repo for this project, or does one already exist?

---

## Out of Scope (Not in This Plan)

- **LLM integration:** No LLM features in v1. No reflection question generation, no cluster labeling via LLM, no prayer detection. All Patterns features use deterministic algorithms (clustering, counting, TF-IDF).
- **Social features:** No sharing, no community, no accounts.
- **Cloud sync:** All data stays local. No cross-device sync.
- **Modern Bible translations:** ESV, NIV, NASB, etc. require licenses. User-import support could come later.
- **Push notifications:** None. The app never interrupts the user.
- **Audio:** No text-to-speech, no audio Bible, no worship music.
- **Image generation:** No AI-generated imagery of any kind.
- **Commentaries:** No study Bible commentary panels. The Library is Scripture + voices, not academic tools.
