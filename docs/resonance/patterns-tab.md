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

## Page sections

### Recently

At rest, show a short summary of the current window.

Examples:

- `Recently, several traces gathered around trust, provision, and tomorrow.`
- `Recently, your activity includes 4 journal entries, 6 reading traces, and 2 notes.`
- `Patterns need a few traces: journal entries, readings, highlights, or notes.`

The Recently card may use theme snapshots when present. Otherwise, it may summarize raw activity counts.

### Activity Calendar

The calendar is an activity map, not an insight by itself.

Each day may show dots for:

| Dot | Source evidence |
|---|---|
| Journal | `journal_entries.created_at` |
| Reading | `reading_events.created_at` |
| Highlight | `highlights.created_at` |
| Note | `highlights.note_text` with `note_updated_at` or `updated_at` |
| Bookmark | `bookmarks.created_at` |
| Echo | `resonance_events` or `resonance_edges.last_seen_at` |

Use a max-dot rule so the month view stays readable. Recommended behavior:

- one to three activity types: show one dot per type
- more than three activity types: show first three plus a `+` marker
- no activity: show only the day number

### Day detail

Clicking a day opens grouped evidence for that date. Each journal entry, reading, highlight, note, and bookmark may carry inline connections (echoes, returned-to signals, themes, trails) that relate to that specific trace.

Required groups:

- Journal
- Reading
- Highlights
- Notes
- Bookmarks

Each activity item should be expandable when it has connections. Expanding an item reveals the related connections with their evidence, so the user sees *why* a pattern appeared without leaving the activity context.

There is no separate "Connections" card. Connections are shown only as branches bound directly to the item that produced them.

The day detail should be useful even when only journal and reading data exist. Missing optional adaptive tables must not crash the day view.

### Connection types

Connections surface in the day detail, attached to the activity traces that generated them. A trace may have zero, one, or several connections.

#### Echo

Echoes are specific relationships, usually backed by `resonance_edges`. When an echo relates to a journal entry, reading, highlight, note, or bookmark, it appears as an inline branch on that item.

Show:

- source label
- target label
- reason
- confidence or evidence strength
- one to three supporting excerpts

Allowed language:

- `This echoes...`
- `This sits near...`
- `This passage also appeared near...`

Avoid language:

- `This means...`
- `God is telling you...`
- `Your spiritual condition is...`

#### Returned To

Returned To is based on repeated durable activity, not model interpretation. It appears inline on the reading, highlight, note, bookmark, or journal entry that is part of the repeated set.

Examples:

- repeated reading of the same verse, chapter, book, or voice source
- highlight plus note on the same reference
- bookmark plus later reading on the same reference
- repeated journal entries sitting near the same passage or theme after graph tables are wired

The inline view must show dates and activity types.

#### Recurring Theme

Themes are provisional, time-windowed summaries. They are not identity labels. A theme appears inline on every participating trace.

Theme inline cards should show:

- label
- summary
- evidence count
- date window
- supporting evidence excerpts

Themes should be backed by `theme_snapshots` when available. If snapshots are missing, a local keyword fallback is acceptable only as a temporary degraded state and must still avoid identity claims.

#### Trail

A trail is a chain, not a single semantic match. Trails appear inline on each trace that participates in the chain.

Example shape:

```text
journal entry -> Scripture echo -> voice passage -> prior journal entry
```

Trails should expose ordered evidence. Early implementations may build lightweight trails from theme evidence, Returned To signals, and top echoes. Full trails should eventually use graph relationships from `resonance_nodes` and `resonance_edges`.

### Quiet Question

The Quiet Question should be grounded in the current evidence window when possible.

Priority:

1. Returned To signal
2. Active theme snapshot
3. Echo/trail evidence
4. Recent journal activity
5. Generic fallback

Examples:

- `You returned to Matthew 6. What part of that has stayed with you?`
- `Several traces touched provision. What do you want to notice about that?`
- `Looking back at these entries, what seems worth remembering?`

Generated responses should not become source-of-truth interpretations. If the user writes an answer, save the answer as a durable journal entry.

## API contract

### `GET /api/patterns/summary`

Query parameters:

- `start=YYYY-MM-DD`
- `end=YYYY-MM-DD`

Response shape:

```ts
{
  window: { start: string; end: string };
  recently: string;
  days: PatternDaySummary[];
  themes: PatternTheme[];
  echoes: PatternEcho[];
  returnedTo: ReturnedSignal[];
  trails: PatternTrail[];
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
