# Patterns Tab Product Contract

The Patterns tab is an evidence surface. It should help the user inspect what has happened across journaling, reading, highlights, notes, bookmarks, and resonance. It must not behave like a personality model or spiritual diagnosis page.

## Core rule

No visible pattern without evidence.

A pattern may be shown only when it can point back to one or more durable traces:

- journal entry
- reading event
- highlight
- highlight note
- bookmark
- resonance event
- resonance edge
- theme snapshot

If there is no evidence, the UI should render an empty or partial state instead of inventing a summary.

## Page structure: Three Calm Lenses

Top controls sit above a three-lens underline switcher (`Threads` · `Explore` · `Activity`):

- **Timeframe switcher:** `30d | 90d | All` scopes concordance summaries, What Kept Finding You, and bookshelf heat/trace indicators.
- **`?` Spine Key button:** Opens a calm popover explaining the cloth-bound spine cues (Warm Linen = unread, Antique Gold + `✦` = unread echoing, Sage = visited/read, centered silk ribbon = highlighted, violet ink dot = note, Walnut + foil `✦` = visited & echoing).

### Lens 1: Explore (Study Bookshelf)

Every book installed on the device — all 66 books of Scripture and every enabled Christian Voice work — is a live door into deeper reading:

- **Gentle `Group` toggle:**
  - **Grouped (default):** Canonical Scripture sections (`Law`, `History`, `Wisdom`, `Prophets`, `Gospels`, `Epistles`, `Revelation`) and installed literature eras (`Fathers`, `Medieval`, `Reform`, `Devotional`, plus `Personal` for user-imported works with resonance enabled) stand directly on wooden shelves as uniform-height cloth-bound omnibus volumes. Tapping any omnibus volume opens its individual books right beneath its shelf.
  - **Ungrouped:** Opens the entire study bookcase flat (Old Testament, New Testament, and Installed Literature A–Z).
- **Uniform book styling:** All volumes on a shelf share uniform height and a symmetric 3-zone cloth spine (centered crest `✦`, auto-scaled centered serif title plate so long names never clip, centered colophon count or note ink dot, centered silk bookmark ribbon for highlights).
- **Book Bridge panel below the shelves:** Tapping any visited *or unread* book lists its traces and ways in directly beneath the bookcase — combining user highlights/notes (when visited), stored resonance echoes, canonical cross-references from highlights in other books, and book-scoped passage bridges (using on-device 512d int8 `passage_vectors` when embedded, with lexical fallback) to the user's recent writing — with a direct `Open →` jump to Word.

### Lens 2: Threads

- **Recently:** Short evidence-backed summary of the active timeframe window.
- **What Kept Finding You (`✦`):** Passages and Christian voices that repeatedly surfaced in `resonance_edges` across distinct traces/days — highlighting when a book has not been opened yet (`not opened yet`), exposing expandable trace evidence, `Open in Word →`, and `Keep` / `Not quite` feedback persisted via `recordPatternFeedback`.
- **Trails Across Days:** Multi-hop vertical timelines connecting journal entries, Scripture echoes, highlights/notes, and voices across days.
- **A Quiet Question:** Grounded in the active timeframe with an inline Journal reply composer that saves directly as a durable journal entry.

### Lens 3: Activity

- **Activity Calendar:** Month view with multi-dot markers (`journal`, `reading`, `highlight`, `note`, `bookmark`, `echo`).
- **Day Detail (Cross-Day Context):** Clicking a day loads grouped traces for that date while resolving connections across a rolling 30-day context window so cross-day echoes, returns, and trails attach directly to the activity items recorded on that day.
- **A Quiet Question:** Same grounded inline reply card.

## API & DataLayer contract

All three surfaces run through `DataLayer` (`getPatternsSummary`, `getPatternDayDetail`, `getBookBridges`, `recordPatternFeedback`) powered by the shared pure engine in `packages/core/src/patterns-engine.ts` — running 100% offline against SQLite on mobile and over the Next.js API routes on web.

### `GET /api/patterns/summary`

Query parameters:

- `start=YYYY-MM-DD` (calendar month start)
- `end=YYYY-MM-DD` (calendar month end)
- `timeframe=30d|90d|all` (optional, default `30d`)

Response shape:

```ts
{
  window: { start: string; end: string };
  timeframe: '30d' | '90d' | 'all';
  recently: string;
  days: PatternDaySummary[];
  themes: PatternTheme[];
  echoes: PatternEcho[];
  findingYou: FindingYouSignal[];
  returnedTo: ReturnedSignal[];
  trails: PatternTrail[];
  bookshelf: BookshelfSummary;
  quietQuestion: string;
  health: {
    journalEntryCount: number;
    readingEventCount: number;
    highlightCount: number;
    noteCount: number;
    bookmarkCount: number;
    echoCount: number;
  };
}
```

### `GET /api/patterns/book-bridge`

Query parameters:

- `kind=bible|voice`
- `id=<book name or voice book id>`
- `timeframe=30d|90d|all`
- `bookId=<optional canonical bookId>`

Returns a `BookBridgeResult` with trace counts and grounded `BookBridgeItem[]` (`trace` | `echo` | `crossref` | `semantic`) for both visited and unread books.

### `GET /api/patterns/day?date=YYYY-MM-DD`

Response shape:

```ts
{
  date: string;
  counts: ActivityCounts;
  journal: Array<{
    id: string;
    excerpt: string;
    createdAt: string | null;
    connections: PatternConnection[];
  }>;
  reading: Array<{
    id: string;
    label: string;
    ref: string | null;
    createdAt: string | null;
    connections: PatternConnection[];
  }>;
  highlights: Array<{
    id: string;
    verseRef: string | null;
    selectedText: string | null;
    color: string | null;
    createdAt: string | null;
    connections: PatternConnection[];
  }>;
  notes: Array<{
    id: string;
    verseRef: string | null;
    noteExcerpt: string;
    updatedAt: string | null;
    connections: PatternConnection[];
  }>;
  bookmarks: Array<{
    id: string;
    verseRef: string | null;
    label: string | null;
    createdAt: string | null;
    connections: PatternConnection[];
  }>;
  connections: PatternConnection[];
}
```

`PatternConnection` is the shared edge shape:

```ts
interface PatternConnection {
  kind: 'echo' | 'returned_to' | 'theme' | 'trail';
  id: string;
  label: string;
  summary: string;
  confidence?: number;
  evidence: PatternEvidence[];
  sourceNodeIds?: string[];
  targetNodeIds?: string[];
}
```

Per-item `connections` attach a connection to the specific activity trace it relates to. The top-level `connections` array provides the full set of day-level connections for overview or future graph rendering.

### `POST /api/patterns/feedback`

Target behavior:

```ts
{
  action: 'opened' | 'saved' | 'dismissed' | 'not_useful' | 'show_less';
  surface: 'echo' | 'theme' | 'trail' | 'returned_to' | 'quiet_question';
  itemId: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  metadata?: Record<string, unknown>;
}
```

Expected effects:

- append a durable feedback event
- reinforce opened/saved edges
- suppress dismissed/not-useful edges
- preserve evidence history
- degrade gracefully if adaptive tables are not present yet

## Empty and partial states

The tab should never appear dead.

Recommended states:

- no data: `Patterns need a few traces.`
- only journal data: show journal calendar dots and local themes
- reading table missing: show journal/highlight data and no reading dots
- adaptive tables missing: show calendar/day detail and hide Echoes/Trails until evidence exists
- API failure: show local fallback and a small fallback notice

## Acceptance checklist

- Month view uses real month end, not fixed day 31.
- Day detail groups evidence by activity type.
- Every non-empty card has evidence or a clear source count.
- Missing optional tables do not crash the tab.
- Language stays humble and non-diagnostic.
- User feedback can later reinforce or suppress edges.
