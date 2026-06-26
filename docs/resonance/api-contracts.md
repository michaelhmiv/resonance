# API Contracts for Adaptive Resonance

This document describes the intended API shape. Some routes exist today; others are target contracts for implementation.

## Existing important routes

| Route | Current role |
|---|---|
| `GET /api/health` | Shallow deployment/vector health |
| `GET /api/vectors/status` | Active vector index status |
| `POST /api/embed` | Paid OpenRouter embedding call for text |
| `POST /api/resonance` | Current semantic/lexical resonance result |
| `GET/POST /api/journal/entries` | Journal CRUD |
| `GET/POST/PATCH/DELETE /api/reading/highlights` | Highlight/note lifecycle |
| `GET /api/library/books` | Voice book catalog |
| `GET /api/library/passages?bookId=...` | Voice passages |

## Target route behavior

### `POST /api/resonance`

Long-term, this should not always compute from scratch. It should:

1. Resolve/create source node.
2. Check `resonance_result_cache` by source node, content hash, model, corpus version.
3. Return fresh cache immediately if present.
4. Return stale cache immediately if recomputation is needed, with `cacheStatus: 'stale'`.
5. Enqueue background recompute if missing/stale.
6. Only compute synchronously for explicit first-run cases where user is waiting and work is bounded.

Target response extension:

```ts
{
  scripture: ResonanceCard[];
  voices: ResonanceCard[];
  pastEntries: ResonanceCard[];
  method: string;
  model?: string;
  sourceNodeId?: string;
  cacheStatus?: 'fresh' | 'stale' | 'pending' | 'error';
  corpusVersion?: string;
  generatedAt?: string;
  evidence?: Array<{
    targetNodeId: string;
    relation: string;
    evidenceKind: string;
    confidence: number;
  }>;
}
```

### `POST /api/resonance/events`

Target route for UI interactions.

Request:

```ts
{
  eventType: 'resonance.opened' | 'resonance.saved' | 'resonance.dismissed';
  sourceNodeId: string;
  targetNodeId: string;
  metadata?: Record<string, unknown>;
}
```

Behavior:

- append event
- reinforce or dismiss relevant edge
- return updated edge status

### `POST /api/resonance/jobs`

Target admin/internal route for queued work.

Use cases:

- process journal resonance job
- process highlight note embedding job
- process new corpus backfill job
- decay stale edges

This route should require admin/internal authorization if exposed.

### `GET /api/resonance/cache?sourceNodeId=...`

Target route for fast UI reads.

Response:

```ts
{
  cacheStatus: 'fresh' | 'stale' | 'pending' | 'missing';
  result?: ResonanceResult;
  generatedAt?: string;
  corpusVersion?: string;
}
```

## Error handling

- Missing cache is not a user-visible error.
- Embedding provider failure should degrade to lexical/cached behavior where possible.
- Stale corpus version should not block UI.
- Schema creation must not happen in hot request paths.

## Cost contract

`/api/embed` is the paid call. `✦` should not trigger a new paid embedding when the source text hash already has an embedding.

## Auth contract

Web is currently gated by `resonance-auth`. Admin/corpus/vector routes also use `X-Admin-Token`. Do not weaken these paths.
