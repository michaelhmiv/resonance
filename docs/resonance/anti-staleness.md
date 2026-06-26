# Anti-Staleness Model

Resonance must adapt as the user's life changes. The system should preserve history without freezing provisional interpretations into permanent identity.

## Core principle

> Store what happened permanently. Store what it might mean temporarily.

## Durable vs provisional

Durable:

- journal entries
- highlight rows
- note text
- saved quotes
- reading events
- resonance opened/saved/dismissed events
- corpus/book additions

Provisional:

- theme labels
- inferred concerns
- candidate echoes
- similarity edges
- season summaries
- cluster names

## Edge lifecycle

```text
candidate -> active -> reinforced
     |          |          |
     v          v          v
  expired    dormant    historical/re-rankable
     |
     v
 dismissed when user rejects
```

### `candidate`

A model/evidence guess. Candidate edges need expiry.

Example:

```text
journal_entry_123 echoes Psalm 39:7, confidence .62, expires in 30 days
```

### `active`

Recently interacted with or repeatedly rediscovered.

### `reinforced`

Backed by explicit user action such as save, highlight, note, or repeated meaningful return.

### `dormant`

Historically real but not current. Dormant edges should usually not drive the top result, but can provide contrast.

### `dismissed`

Suppressed because the user rejected it.

## Theme snapshots

A theme snapshot is a time-windowed summary, not a user label.

Good:

```text
In the last 14 days, several entries and highlights clustered around trust and tomorrow.
```

Bad:

```text
You are anxious.
```

Snapshots need:

- window start/end
- evidence node IDs
- confidence
- generated_at
- expires_at
- status

## Half-life guidance

Suggested defaults:

| Item | Default behavior |
|---|---|
| Weak candidate edge | Expires in 14–30 days |
| Active edge | Expires/decays in 30–60 days unless reinforced |
| Reinforced edge | Kept as historical; ranking still decays outside relevant context |
| Reading-context boost | Decays in days, not months |
| Weekly theme | Expires after 2–4 weeks |
| 30-day theme | Recomputed rolling; old snapshot archived |

## Old data as contrast

Old data should become a witness to change.

Safe:

> “This contrasts with several June entries that carried more tension around work.”

Unsafe:

> “You are still anxious about work.”

## Evidence required

Every interpretation must be traceable to evidence. No naked labels.

Bad:

```json
{ "theme": "control" }
```

Good:

```json
{
  "label": "control and trust",
  "window_start": "2026-06-01",
  "window_end": "2026-06-30",
  "evidence_node_ids": ["entry_1", "entry_7", "highlight_3"],
  "confidence": 0.71
}
```

## Dismissal matters

If a user dismisses a resonance connection, the system should not keep surfacing it in the same context. Dismissal does not delete history; it changes ranking.

## Stale cache behavior

Stale cached results should be usable but marked internally:

```text
cacheStatus = stale
```

The UI can show the old result immediately and refresh quietly. Do not block reading/journaling on recomputation.
