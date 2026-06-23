# Resonance — Formal Design Specification

**Version:** 1.0  
**Date:** June 24, 2026  
**Status:** Locked — approved by Michael  
**Platform:** Android (first), iOS (follow-up)  
**Document type:** Design specification (not implementation plan)

---

## Table of Contents

1. [Product Vision & Posture](#1-product-vision--posture)
2. [Design Language](#2-design-language)
3. [Technical Architecture](#3-technical-architecture)
4. [App Structure](#4-app-structure)
5. [Screen: Journal](#5-screen-journal)
6. [Screen: Word](#6-screen-word)
7. [Screen: Patterns](#7-screen-patterns)
8. [Screen: Settings / Profile](#8-screen-settings--profile)
9. [First-Launch Experience](#9-first-launch-experience)
10. [Content & Terminology Model](#10-content--terminology-model)
11. [Interaction Principles](#11-interaction-principles)
12. [Locked Decisions Summary](#12-locked-decisions-summary)

---

## 1. Product Vision & Posture

### 1.1 What Resonance Is

Resonance is a private, offline-first Christian spiritual app — a calm, warm, reverent space for journaling what's on the heart, reading Scripture and public-domain Christian texts, surfacing related passages and voices, and noticing recurring themes over time.

It is a spiritual journal with a built-in reading library and resonance-based discovery.

### 1.2 What Resonance Is Not

- **Not a chatbot.** Writing lives on an open page, not in a message thread.
- **Not a study tool.** No lexicons, interlinear grids, or commentary panels.
- **Not a productivity tracker.** Patterns is reflection, never metrics.
- **Not a social or account-based product.** Open and write.

### 1.3 Three Axioms

Every screen, interaction, and copy decision is governed by these:

| Axiom | Meaning |
|---|---|
| **Resonance, not generation** | The app surfaces pre-existing text that echoes what the user wrote. It never writes prayers, interprets Scripture, advises, or speaks in God's voice. |
| **A mirror, not a teacher** | It returns the user's own words organized, paired with the Library and their past — never pastoral instruction. |
| **Privacy is theological** | "What you write never leaves this device" is the entire value proposition — a feature, not a footnote. |

---

## 2. Design Language

### 2.1 Color

| Role | Value | Usage |
|---|---|---|
| Background | `#faf9f6` (warm cream paper) | All app surfaces |
| Card surface | Softer white tile | Resonance cards, verse of the day |
| Card border | Hairline, no drop shadows | All cards |
| Primary accent | `#8b7355` (restrained brown) | Active states, links, tab indicator |
| Highlight palette | 2–3 soft curated tones | Text highlights in Word (see §6.4) |

### 2.2 Typography

- **Serif-forward reading experience** — serif for body text, Scripture, and voice quotes
- **Sans-serif UI chrome only** — tabs, buttons, metadata labels
- **Scripture and saint quotes** render in **serif italic** to mark them as quoted, living text
- Generous line-height, ample margins, no chunky icons competing with words

### 2.3 Motion

- Minimal and slow. Cards settle in gently.
- No spinners, no "thinking" indicators, no loaders that imply a processing machine.
- Transitions are earned and quiet.

### 2.4 Tone of Voice (UI Copy)

- Calm, reverent, plain-spoken.
- Never "smart," never cheerful-helper, never "Let's…"
- **Forbidden terms in UI:** "corpus," "AI," "assistant," "chat," "boost," "engagement," "streak," "score"
- Preferred verbs: *surface, echo, gather, linger, reflect*
- The Library "gathers" rather than "retrieves."

---

## 3. Technical Architecture

### 3.1 Two Machines, One Invisible

```
BUILD MACHINE (one-time, never user-visible)          PHONE (runtime, seamless)
════════════════════════════════════════════════════              ════════════════════════════════

Raw texts (Bible, saints, mystics…)                    App launches
       │                                                     │
       ▼                                                     ▼
Chunk into passages                                   Load embedding model into memory
(Bible = phrase/clause level,                          (happens once at startup, ~1s)
 Library = paragraph level)                                  │
       │                                                     ▼
       ▼                                               User writes in Journal
Embedding model                                              │
→ produces a vector for                                    • sentence ends or brief pause
  every passage in the Library                              │
       │                                                    ▼
       ▼                                               Embed the user's text
Bundle everything together:                            (~50ms, completely invisible)
• text chunks                                                │
• metadata (author, book, ref)                              ▼
• pre-computed vectors                                 Cosine similarity vs
       │                                               the entire pre-computed Library
       ▼                                               (~5-10ms for 50K+ passages)
Ship as app assets                                            │
       │                                                     ▼
       ▼                                               Selection algorithm
Default model vectors baked in.                         (recency, diversity, variety)
Additional packages + alternate                            │
model vectors are static downloads.                         ▼
                                                       Resonance footnote appears
                                                       (user taps to expand cards)
```

### 3.2 Multi-Vector System

Every Book Package ships with **separate pre-computed vector files for each supported embedding model**. The user downloads only the vectors matching their active model.

```
Book Package: "Mystics & Contemplatives"
├── text + metadata (shared, ~2-3MB)
│   ├── teresa_avila_interior_castle.json
│   ├── john_of_cross_dark_night.json
│   └── ...
├── vectors_model_A  (~5-8MB)
├── vectors_model_B  (~5-8MB)
├── vectors_model_C  (~5-8MB)
├── vectors_model_D  (~5-8MB)
├── vectors_model_E  (~5-8MB)
└── vectors_model_F  (~5-8MB)
```

**User downloads text + vectors for their active model only.** Switching models = download new vectors for installed packages, swap, delete old. All background, gentle progress, no manual management.

**Zero on-device re-embedding ever.** Every vector is pre-computed at build time. The phone only embeds the user's own words at runtime.

### 3.3 What Ships in the App Bundle

| Asset | What it is | Size |
|---|---|---|
| **Seeded Library texts + vectors** | All passages in the seeded Library, with text, metadata, and pre-computed vectors for the default model | ~80-120MB |
| **Seeded Bible translations** | WEB + KJV (both public domain) | Included above |
| **App binary** | The application itself | ~10-20MB |

**The embedding model is NOT in the app bundle.** It downloads on first launch via the opt-in prompt (see §9).

### 3.4 Runtime Flow (Completely Invisible)

1. **App launches** → embedding model (if downloaded) quietly loads into memory (~1 second, no spinner).
2. **User writes** in Journal. Nothing happens while mid-sentence.
3. **Sentence boundary detected** (period, question mark, or brief pause in typing) → the completed phrase is embedded (~50ms).
4. **Cosine similarity** runs against the entire pre-computed Library vector store (~5-10ms via pre-built index).
5. **Selection algorithm** applies recency penalty, category diversity, and weighted random.
6. **A small ✦ footnote mark** settles in at the end of the phrase. The only visible artifact.

The user never sees "processing," "searching," "embedding," or any loading state.

### 3.5 Book Package Downloads

```
User taps "Add" on a package in the Library browser
       │
       ▼
Package downloads (text + metadata + pre-computed vectors for active model, ~5-15MB)
       │
       ▼
Vectors merge into the local vector index (instant)
       │
       ▼
Text appears in the Library — immediately available for resonance
```

No re-embedding. No "indexing…" spinner. Download → merge → done. The only "backend" is a static file host (S3, CDN, or GitHub Releases).

### 3.6 User Entry Embedding

When the user writes, each sentence/phrase is:
1. Embedded once (~50ms, on sentence boundary, invisible).
2. Stored locally alongside the entry timestamp.
3. Available for future cosine similarity — so the user's own past entries surface as resonance cards.
4. **Entry vectors never leave the device.**

### 3.7 Writing Persistence

- **Auto-save every keystroke**, debounced (~1-2 seconds) to local storage.
- The continuous journal never has a "save" moment because it's always saved.
- On relaunch, the user lands exactly where they were — mid-sentence if necessary.
- Words are never lost to crashes or force-kills.

### 3.8 Seamlessness Guarantees

| Guarantee | How |
|---|---|
| User never runs an embedding process | Library vectors are pre-computed at build time |
| User never sees a loading/processing state | On-device embedding is ~50ms — faster than the footnote mark takes to appear |
| User never configures the model to start | Default model is offered via first-launch prompt; once enabled, active immediately |
| User never re-processes after downloading a package | Packages ship with pre-computed vectors; download = merge = immediately available |
| User's writing never leaves the device | Only user text is embedded, locally. No network calls for resonance. |
| No "thinking" affordance anywhere | No spinners, no "searching…", no "AI is finding…" |

---

## 4. App Structure

### 4.1 Navigation

Three tabs + settings icon in header.

```
┌───────────────────────────────────────────────┐
│  Resonance        ⚙ (settings/profile)        │
├───────────────────────────────────────────────┤
│            [ active tab surface ]              │
├───────────────────────────────────────────────┤
│     Journal   ·   Word   ·   Patterns          │
└───────────────────────────────────────────────┘
```

- **Journal is the default launch surface.** Open and write.
- **Word** and **Patterns** are peers, not sub-levels.
- **Settings/Profile** is a single header icon → full screen. Never a fourth tab.

### 4.2 Information Architecture

```
Header → Settings/Profile (full screen)
         ├ Embedding model
         ├ Reading preferences
         ├ Privacy & data
         ├ Storage
         └ Accessibility

Tabs
 ├ Journal
 │   ├ Continuous living document
 │   ├ Ambient resonance footnotes (expand to cards)
 │   ├ Verse of the day (fills negative space at each day divider)
 │   ├ Calendar icon → scroll to date
 │   └ Send-to-Word (from a resonance card)
 │
 ├ Word
 │   ├ Scripture browser (book → chapter → section)
 │   ├ Library browser (Book Packages) — discrete library icon in header
 │   ├ Reading view: highlight · annotate · bookmark
 │   ├ Search
 │   └ Send-to-Journal (passage → quoted block)
 │
 └ Patterns
     ├ Calendar view (writing rhythm)
     ├ Recurring themes
     ├ Recurring passages & voices
     ├ Time-of-day texture
     ├ Verses that linger
     └ Reflection moments (weekly gathering, optional)
```

### 4.3 Cross-Tab Bridges

Two intentional connections keep writing and reading linked without fusing the tabs:

- **Journal → Word:** a resonance card carries a *Read in Word* action. This opens the passage in full context (full chapter, surrounding verses) in the reading surface.
- **Word → Journal:** while reading, an action sends a passage into the Journal as a quoted block to write toward.

---

## 5. Screen: Journal

### 5.1 Concept

One continuous, open writing surface — a living document, not a message thread. The user writes freely or poses a Scripture-related question; both are treated as entry text that the Library quietly echoes. There are no discrete entries, no "new entry" button, no "save" button. The document grows over time.

### 5.2 Layout

```
┌───────────────────────────────────────────┐
│  📅 (calendar)                  (today)   │  ← header
├───────────────────────────────────────────┤
│                                           │
│  ↑ (scroll back through previous days)    │
│                                           │
│  ── Tuesday, June 23 ─────────────────    │  ← soft date divider
│                                           │
│  ...I've been carrying so much lately,    │
│  and I don't know how to set it down.✦¹   │  ← footnote preserved
│                                           │
│  ── Wednesday, June 24 ───────────────    │  ← new day divider
│                                           │
│  ⸺ verse of the day fills the quiet ⸺     │
│  ┌──────────────────────────────────┐     │
│  │ "The Lord is my shepherd…"       │✦    │  ← verse of the day
│  │ Psalm 23:1 · WEB          →Word  │     │
│  └──────────────────────────────────┘     │
│                                           │
│  Whatever is real.                        │  ← placeholder
│                                           │
│  [ you write here ]                       │  ← current writing point
│                                           │
└───────────────────────────────────────────┘
```

### 5.3 Continuous Document Behavior

- **One continuous scrollable surface.** No "new entry" button. No "save" button (auto-saved every keystroke).
- **Date dividers** appear naturally when a new calendar day begins — a quiet serif date inline in the text flow, separated by em-dashes. Not a card, banner, or header bar.
- **Opens at "now."** Every launch lands at the bottom of the document — the most recent writing point, ready to continue.
- **Scroll up to look back.** Previous days flow in reverse chronological order. Their resonance footnotes are preserved as the user left them — expanded or collapsed.
- **Day boundary:** if the user writes at 11:50 PM and continues at 12:10 AM, a soft date divider appears inline. The writing continues seamlessly; the date just updates.
- **When reopening on a new day:** a fresh date divider + verse of the day await. The user just starts writing.

### 5.4 Calendar Navigation

- A **calendar icon** in the Journal header. Tap → a small calendar overlay appears.
- **Month grid, cream paper texture** matching the app. Days with writing carry a soft dot. Days without stay open and calm.
- Tap a date → the document **smoothly scrolls** to that day's divider.
- The calendar is a navigation shortcut into the continuous document, not a separate view.
- No "X days in a row" language. No break-shaming. No streaks.

### 5.5 Ambient Resonance Footnotes (Core Interaction)

#### Trigger

After a **sentence boundary or brief pause** in typing, a small **✦** mark settles in at the end of the relevant phrase — like a footnote in a book. The mark never appears mid-phrase; it always lands at a natural breath, never cutting into a thought.

#### Behavior

1. The ✦ mark is quiet, never modal, never a pop-up. It doesn't interrupt writing.
2. **Tap the mark** → resonance cards expand inline beneath that footnote:
   - **one Scripture passage**
   - **one voice from the Library**
   - **one of the user's own past entries** (including "where you were" — see §5.7)
3. Each card has two actions only: a linger/save mark (✦) and *Read in Word*.
4. **Multiple footnotes per entry** are encouraged — a longer entry with several resonance marks becomes a layered reading experience of the user's own writing.
5. The footnote never narrates a connection. No "this relates because…" The echo speaks for itself.
6. Footnotes are **not** explained by the app. No ranking, no "why this surfaced." The echo is organic, not algorithmic.

#### What powers it (invisible to user)

- The completed sentence/phrase is embedded (~50ms) on sentence boundary.
- Cosine similarity runs against the entire pre-computed Library vector store.
- Selection algorithm applies:
  - **Recency penalty:** items shown in last 7 days → score × 0.3; last 30 days → × 0.6
  - **Category diversity:** ensure mix of Psalm + Gospel + Epistle + Prophet when possible; different authors for voices
  - **Weighted random:** pick from top 15, not always top 3
  - **Seed determinism:** same writing → same gathering (seeded to entry hash for reproducibility)

### 5.6 Verse of the Day

- Fills negative space gently — appears in the quiet area at each new date divider, before the user begins writing.
- Same card anatomy as a resonance card: quote (serif italic), source line, *Read in Word*.
- **One verse per day, deterministic to the date.** Not personalized — a quiet invitation to read. The verse belongs to the calendar, not to the user's data.
- **Selection:** seed by date so every device sees the same verse on the same day. Draws from Psalms, Gospels, Epistles, and select prophetic passages in rotation. Pre-built sequence, not algorithmic. Avoids genealogies, censuses, and potentially distressing passages out of context.
- **Disappears from view** once the entry begins to fill, so it never competes with the writing.

### 5.7 Progression Insight: "Where You Were"

A dedicated card type within the "your own past" resonance result. When the user writes something that connects to a past entry — especially when there's an emotional trajectory ("I'm feeling better than last week") — the app surfaces that past entry.

```
Last week:  "I can't stop worrying about my mom"   → vector A
Today:      "I feel lighter about mom this week"     → vector B

Cosine similarity between A and B is HIGH (same topic)
The "where you were" card surfaces entry A
→ The user sees where they were
→ The act of seeing it IS the progression
```

**The app does not detect or label progression.** It surfaces the past entry that resonates with the current writing. The *user* sees the contrast — they wrote this last week, now they're writing that. The recognition is theirs, not the app's.

Card caption: **"where you were"** + when it was written (e.g. "9 days ago").

### 5.8 Resonance Card Anatomy

- **Body:** the quoted text, serif italic
- **Source line:** reference / author / "from your own words" + how long ago
- **Two actions only:** linger/save mark (✦) and *Read in Word*
- **Never:** commentary, "why this connects," share, thumbs, "more like this"

### 5.9 Journal Search

- A quiet search field appears when the user **pulls down** from the top of the Journal (not a persistent bar).
- Simple text search of the user's own words — no semantic search, no embeddings.
- Matches highlight inline in the scroll, with up/down arrows to jump between them.

### 5.10 Placeholder Text

**"Whatever is real."** — the only placeholder text in the Journal tab. Appears in the writing area when empty.

### 5.11 First-Run Greeting

Since the seeded Library is already present, an optional single quiet line may appear once: *"Your Library is already here — begin."* This is not onboarding; it disappears after the first writing session.

---

## 6. Screen: Word

### 6.1 Concept

A dedicated, sacred reading surface — like a Bible app that also holds the rest of the Library. Browse, search, highlight, annotate, bookmark, and navigate. Tone is "reading room," not "study engine."

### 6.2 Library Icon (Book Package Discovery)

A **discrete library icon** in the Word tab header — not hidden in Settings. This is the primary entry point for browsing Book Packages.

- When new packages are available, a gentle, dismissible indicator appears on the library icon.
- Tapping the icon opens the Library browser (see §6.7).
- The indicator is opt-out in Settings for users who prefer no signals.

### 6.3 Two Reading Views

1. **Scripture view** — book → chapter → section navigation, with a translation selector.
2. **Library view** — browse texts by Book Package, then by author/work.

### 6.4 Reading View

```
┌───────────────────────────────────────────┐
│  ‹  Matthew 11            WEB ▾    ✦ ✎ ⚑   │  ← nav + highlight/annotate/bookmark
├───────────────────────────────────────────┤
│                                           │
│   28  Come to me, all who labor           │
│       and are heavy laden, and I           │
│       will give you rest.                 │
│   29  Take my yoke upon you…              │  [highlighted clause]
│                                           │
│   ─ cross-references surface inline ─     │
│   (gentle marginal links, not a panel)    │
└───────────────────────────────────────────┘
```

### 6.5 Reading Features

| Feature | Behavior |
|---|---|
| **Highlight** | Select text → choose from a small curated palette of 2–3 soft tones. Highlights persist per verse reference and aggregate into Patterns. **Highlights are shared across translations** — a highlight on John 3:16 in WEB appears when reading the same verse in KJV. |
| **Annotate** | Margin note attached to a selection. **Annotations are per-translation** — because the exact words being annotated differ. Your own words next to the text, clearly separated. |
| **Bookmark** | Mark a passage or chapter for return. Bookmarks gather in a quiet list. |
| **Passage navigation** | Tap a verse ref to go there; next/previous chapter; jump by book. |
| **Cross-references** | Understated marginal links, inline — not a side panel competing with the text. |
| **Send to Journal** | A passage you want to write toward flows into the Journal as a quoted block. |

### 6.6 Translation Handling

- **Seeded translations:** WEB (default, most readable modern PD) + KJV (most widely recognized).
- **Additional translations** (ASV, BBE, DBY, YLT, Douay-Rheims, etc.) are Book Packages.
- **Translation selector** in the reading view header (WEB ▾).
- **Highlights are shared across translations** (tied to verse reference, not text).
- **Annotations are per-translation** (tied to the specific text being annotated).

### 6.7 Library Browser (Book Packages)

- The seeded Library shows as **already-present packages** with item counts — never a blank wall.
- Additional packages listed as *available*, each with size and a one-line description.
- **Downloading is a deliberate, single explicit action.** No background fetching.
- A package, once added, simply appears in the reading library — no separate "downloads" tab.
- Package downloads include text + metadata + pre-computed vectors for the user's active embedding model only.

Available package categories:
- Mystics & Contemplatives
- Church Fathers
- Reformation Classics
- Devotional & Poetic
- Additional Bible translations
- (Future packs as the Library grows)

### 6.8 Search

- One calm search field; scope selects *Scripture* or *Library*.
- Results are passage cards (same anatomy), each *Read in Word*-able.
- Search is text search of what the user owns — not a recommendation engine.

---

## 7. Screen: Patterns

### 7.1 Concept

Gentle, humane reflection on what recurs in the user's writing and reading over time. **Not a dashboard.** No streaks, no scores, no engagement games. The feel is turning pages of a journal late at night.

### 7.2 Data Sources

Patterns reflects **both** Journal activity and Word reading activity:

| Source | What it contributes |
|---|---|
| **Journal writing** | Themes from the user's words, verses that surfaced in resonance, rhythm of writing |
| **Word reading activity** | What the user highlighted, bookmarked, annotated — passages they lingered over |

Journal is the primary signal; reading activity is secondary texture.

### 7.3 Calendar View (Primary Lens)

A **calendar view** of writing rhythm as the primary lens.

- **Month grid, cream paper texture** matching the app.
- Days with writing carry a **soft dot or texture** — never numbered, never counted.
- Days without stay open and calm.
- **Tap a day** → gentle list of that day's entries and what surfaced.
- No "X days in a row" language. No break-shaming. No streaks.
- Visual feel is a liturgical calendar, not a productivity heatmap.

### 7.4 Rich Reflective Displays

Beyond the calendar, several richer-but-reverent displays:

| Display | Treatment |
|---|---|
| **Recurring themes** | Soft word-weight or dot-cluster; clusters given plain names — *"rest," "weariness," "longing."* |
| **Recurring passages & voices** | Which Scripture and Library texts appear most often in the user's gatherings. A quiet list with frequency shown as soft dots, never a leaderboard. |
| **Rhythm of writing** | Tied to the calendar — a soft sense of when the user writes, not how often. |
| **Time-of-day texture** | A faint dawning/dusk visualization of when the user tends to write — light marks, not bar charts. |
| **Verses that linger** | The user's most-saved resonance cards gathered in one quiet list. |
| **Reflection moments** | An optional weekly gathering word (template-filled, not generated), and a gentle "what shifted" view between periods. |

### 7.5 Layout Posture

- Vertical scroll of reflective sections, generously spaced.
- Every figure is captioned in plain language: *"You've lingered here before."* — never "↑ 23% engagement."
- Visualization is minimal and warm: small dots, soft bars, a faint calendar texture — never gauges or leaderboards.

### 7.6 Progression Across Time

When the user looks at a theme cluster across weeks or months, they see entries gathered together that they can read in sequence and notice the shift themselves. Not a graph labeled "mood improvement" (too clinical) — just the entries, laid out in time, for the user to recognize growth or change.

---

## 8. Screen: Settings / Profile

### 8.1 Access

Single header icon → **full screen**. Never a fourth tab.

### 8.2 Sections

| Section | Contents |
|---|---|
| **Embedding model** | Which on-device model shapes the user's gatherings. Current default + description. Option to download a stronger model. Plain-language note: *"This is local math that finds echoes in your Library. It does not interpret or generate text."* Switching models triggers download of matching vectors for installed packages (background, gentle progress). |
| **Reading preferences** | Default translation, serif/size/line-spacing, verse-per-line toggle, theme variant (cream default). |
| **Privacy & data** | The explicit, single-line assurance that writing stays on device. Export entries (Markdown). Erase-all. App lock (opt-in: biometric or PIN, off by default). |
| **Storage** | Library footprint. Per-package size. Storage headroom. Per-vector-model breakdown if multiple model vector sets are downloaded. |
| **Accessibility** | Larger text, high-contrast variant, reduced motion, dynamic type. |

**Note:** Library & Book Packages management lives in the **Word tab** via the discrete library icon, not in Settings. Settings Storage section shows sizes and storage info only.

---

## 9. First-Launch Experience

### 9.1 Light Install

The app installs light (~10-20MB). The embedding model is NOT in the bundle — it downloads on first launch via an opt-in prompt.

### 9.2 Embedding Model Prompt

This is the **only prompt in the entire app.** It appears on first launch, before the user writes. It is handled with extreme care — honest, plain, warm. No dark patterns, no pre-checked boxes.

```
┌───────────────────────────────────────────┐
│                                           │
│  Resonance can find Scripture and voices  │
│  that echo what you write.                │
│                                           │
│  This works by reading your words locally  │
│  on your device — nothing you write ever   │
│  leaves your phone.                       │
│                                           │
│  To enable this, a small file (~70MB)     │
│  downloads once and stays on your device.  │
│                                           │
│  ┌─────────────┐  ┌───────────────────┐   │
│  │ Not now      │  │ Enable resonance  │   │
│  └─────────────┘  └───────────────────┘   │
│                                           │
└───────────────────────────────────────────┘
```

### 9.3 Prompt Principles

- **Plain language.** No "embedding model," "vector," "semantic search." Just "finds Scripture and voices that echo what you write."
- **Privacy front and center.** "Nothing you write ever leaves your phone" is stated, not buried.
- **"Not now" is a real choice.** If declined, the Journal is a fully functional writing surface — just without footnotes.
- **If declined:** the prompt can reappear gently in Settings as a one-line offer: *"Enable resonance to find echoes in your Library."*
- **If enabled:** model downloads in the background. Journal is immediately writable. A quiet line appears once the model is ready: *"Resonance is ready."* Then footnotes begin appearing.

### 9.4 Seeded Library

The app launches with the seeded Library already present (texts + default model vectors). No "download everything" wall. Optional first-run greeting: *"Your Library is already here — begin."* Disappears after first writing session.

---

## 10. Content & Terminology Model

| Term | Meaning |
|---|---|
| **Library** | The full collection of Scripture and texts the app holds. Present and substantial at launch. |
| **Book Packages** | Thematic downloadable bundles that *extend* the Library. Adding one simply grows the Library. Each ships with text + metadata + pre-computed vectors per supported model. |
| **Voices** | The saints, mystics, Fathers, and Reformers of the Library. "Voices" in copy; "corpus" never appears. |
| **Passages** | The text units surfaced in cards and reading. |
| **Gathering** | The resonance act. The Library *gathers* echoes; it never fetches, ranks, or recommends. |

### 10.1 Seeded Library Contents

| Content | Details |
|---|---|
| **Bible translations** | WEB (default) + KJV |
| **Scripture vectors** | Phrase/clause-level chunking, pre-computed for default model |
| **Voices** | Substantial collection of public-domain Christian texts across eras |
| **Library vectors** | Paragraph-level chunking, pre-computed for default model |
| **Cross-references** | Treasury of Scripture Knowledge (340K+ pairs) |

### 10.2 Bookmark Packages (Available for Download)

Categories:
- Mystics & Contemplatives
- Church Fathers
- Reformation Classics
- Devotional & Poetic
- Additional Bible translations (ASV, BBE, DBY, YLT, Douay-Rheims)
- (Future packs as the Library grows)

---

## 11. Interaction Principles

1. **Ambient resonance, never predictive.** Footnotes appear after sentence boundaries; they don't intrude mid-phrase.
2. **Cards show text, never commentary.** No "this connects to what you wrote because…"
3. **Reading and writing stay separate.** Bridges exist (Journal→Word, Word→Journal); the tabs never fuse.
4. **No network implied.** Behavior feels the same offline. Package downloads are the only network-aware moment.
5. **Quiet motion, quiet chrome.** Slow, earned transitions; nothing that signals a "thinking" machine.
6. **Auto-save everything.** Every keystroke is persisted. Words are never lost.
7. **The user does the noticing.** The app surfaces echoes and places mirrors. Recognition, interpretation, and meaning-making belong to the user.

---

## 12. Locked Decisions Summary

| # | Decision | Resolution | Date |
|---|---|---|---|
| 1 | Core navigation | 3 tabs: Journal · Word · Patterns. Settings in header. | Jun 23 |
| 2 | Journal model | Continuous living document, not discrete entries | Jun 24 |
| 3 | Date dividers | Soft serif date inline, em-dash separated | Jun 24 |
| 4 | Calendar navigation | Calendar icon in Journal header → smooth scroll to date | Jun 24 |
| 5 | Resonance trigger | Ambient footnotes after sentence boundary/pause; tap to expand cards inline | Jun 24 |
| 6 | Blank space | Verse of the day (date-seeded, recedes as entry fills) | Jun 24 |
| 7 | Patterns visualization | Calendar view + rich reflective displays | Jun 24 |
| 8 | Settings surface | Full screen on phones | Jun 24 |
| 9 | Highlight palette | Small curated palette of 2–3 soft tones | Jun 24 |
| 10 | Multi-vector | Each Book Package ships separate pre-computed vector files per supported model | Jun 24 |
| 11 | Platform priority | Android first, iOS later | Jun 24 |
| 12 | Embedding model at launch | Light install; opt-in prompt on first launch with plain language + privacy assurance | Jun 24 |
| 13 | Patterns data sources | Both Journal writing AND Word reading activity | Jun 24 |
| 14 | Cross-translation highlights | Shared across translations (tied to verse reference) | Jun 24 |
| 15 | Annotation scope | Per-translation; Word-only (not Journal) | Jun 24 |
| 16 | Journal search | Yes — pull-down text search, matches highlight inline | Jun 24 |
| 17 | Progression insight | "Where you were" card type — past entry surfaced that connects to current writing; user does the noticing | Jun 24 |
| 18 | Book Package discovery | Discrete library icon on Word tab header (not hidden in Settings) | Jun 24 |
| 19 | Seeded Bible translations | WEB + KJV | Jun 24 |
| 20 | Selection algorithm transparency | No — echoes feel organic, never explained | Jun 24 |
| 21 | Writing persistence | Auto-save every keystroke (debounced ~1-2s) | Jun 24 |
| 22 | Export format | Markdown | Jun 24 |
| 23 | App lock | Opt-in (off by default); biometric or PIN | Jun 24 |
| 24 | Verse of the day scope | Curated subset (Psalms, Gospels, Epistles, select prophetic); pre-built sequence | Jun 24 |

---

*This is a design specification only. No implementation decisions, code, or files have been committed beyond this document. Proceed to implementation planning only when explicitly directed.*
