# Resonance Architecture

Resonance is a **living concordance** between Scripture, Christian voices, reading behavior, highlights, notes, and ordinary journaled life. It is not a chatbot, not a permanent personality model, and not a static recommendation list.

The architecture has four layers:

```text
canonical sources  ->  durable user events  ->  adaptive relation layer  ->  humble UI surfaces
Scripture/books       journal/highlight/etc.    candidate edges/cache       ✦ echoes/trails
```

## Core rule

> Events are durable. Interpretations are provisional.

Durable events record what actually happened: a journal entry was created, a verse was highlighted, a note was written, a resonance card was opened or dismissed, a book was added. Provisional interpretations record what the system noticed: semantic nearness, a possible echo, a current trail, or a time-windowed theme snapshot.

## Must-read docs before editing resonance mechanics

1. [`principles.md`](./principles.md) — product and architecture constitution.
2. [`data-model.md`](./data-model.md) — target tables and lifecycle boundaries.
3. [`event-flow.md`](./event-flow.md) — what happens when entries/highlights/books change.
4. [`adaptive-ranking.md`](./adaptive-ranking.md) — how evidence becomes ranked resonance.
5. [`anti-staleness.md`](./anti-staleness.md) — why labels expire and how old data becomes context.
6. [`refresh-timing.md`](./refresh-timing.md) — what recomputes immediately, what queues, what runs on schedule.
7. [`agent-guide.md`](./agent-guide.md) — checklist for future AI agents.

## Code map

| Area | Paths |
|---|---|
| Web API routes | `apps/web/app/api/*` |
| Web persistence/client adapter | `apps/web/lib/*`, especially `client-data-layer.ts` and future `lib/resonance/*` |
| Shared contracts | `packages/core/src/data-layer.ts`, `packages/core/src/types.ts` |
| Journal UI | `packages/screens/src/journal/JournalScreen.tsx` |
| Reading/highlight UI | `packages/screens/src/word/ReadingView.tsx` |
| Supabase schema | `supabase/migrations/*` |
| Corpus/book scripts | `scripts/library/*`, `build/*` |
| Current architecture plan | `plans/2026-06-26-adaptive-resonance-architecture-documentation-plan.md` |

## Current known bottleneck

The current `/api/resonance` implementation streams and scores the full `pplx-embed-v1-4b` vector file per semantic request. The Journal screen has also auto-loaded resonance for multiple entries. The target architecture replaces repeated request-time recomputation with durable nodes, embeddings, candidate edges, and result caches.

## Product language

Prefer language like:

- “This echoes…”
- “Recently…”
- “You returned to…”
- “This sits near…”

Avoid language like:

- “You are anxious.”
- “Your spiritual state is…”
- “This entry means…”

The system should notice resonance, not define the person.
