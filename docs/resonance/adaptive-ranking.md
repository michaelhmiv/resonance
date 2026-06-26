# Adaptive Ranking

Adaptive ranking turns candidate retrieval into meaningful, personalized resonance without treating model guesses as truth.

## Candidate sources

Candidates may come from:

- vector similarity to Scripture passages
- vector similarity to voice passages
- vector similarity to past journal entries
- direct relation to highlighted passages
- note embeddings
- current reading context
- recently reinforced trails
- newly added corpus backfill

## Ranking formula

Pseudocode:

```ts
finalScore =
  semanticSimilarity
  + explicitUserSignalBoost
  + noteAffinityBoost
  + highlightAffinityBoost
  + recentReadingContextBoost
  + recentReinforcementBoost
  + trailContinuityBoost
  + diversityBonus
  + newCorpusNoveltyBoost
  - dismissedPenalty
  - repetitionPenalty
  - stalenessPenalty
  - lowEvidencePenalty;
```

## Factor definitions

### `semanticSimilarity`

Raw vector similarity. Useful for discovery, never sufficient by itself.

### `explicitUserSignalBoost`

Strong boost for user actions:

| Action | Suggested strength |
|---|---:|
| saved/appended quote | high |
| highlight created | high |
| note added | very high in that semantic neighborhood |
| opened card | low/moderate |
| dismissed | strong negative |

### `noteAffinityBoost`

A note expresses the user's interpretation of a passage. If a journal entry is near a note embedding, that connection should often outrank a merely similar canonical passage.

### `highlightAffinityBoost`

Highlighted passages are anchors. Future resonance should prefer them when semantically relevant, but not force them into unrelated contexts.

### `recentReadingContextBoost`

Recently read books/chapters get a temporary boost. This should decay quickly unless reinforced.

### `recentReinforcementBoost`

Edges with recent `opened`, `saved`, or repeated-return events rise. Dormant edges can reactivate when similar evidence appears.

### `trailContinuityBoost`

If multiple recent entries connect to a similar neighborhood, a new related entry can continue that trail. Trails are provisional and time-windowed.

### `diversityBonus`

Avoid showing three near-identical passages. Prefer a small set that covers:

- Scripture
- a historical voice
- a past-entry echo when meaningful

### `newCorpusNoveltyBoost`

Newly added books can be shown when they strongly improve a result, but they should not flood every old entry.

### `dismissedPenalty`

Dismissed items and close duplicates should be suppressed for the same source/context.

### `repetitionPenalty`

Do not show Matthew 6 for every anxiety-adjacent entry if the user has seen it repeatedly and not engaged. Repetition can feel stale even when semantically valid.

### `stalenessPenalty`

Old candidate edges decay unless reinforced. Explicit saved/highlighted edges remain historical but may lose active ranking weight.

### `lowEvidencePenalty`

Edges based only on weak similarity should remain candidates and expire unless reinforced.

## Edge lifecycle impact

| Status | Ranking behavior |
|---|---|
| `candidate` | Eligible, lower trust, expires soon |
| `active` | Recently interacted or repeated; eligible for normal ranking |
| `reinforced` | Strong user-backed signal; high ranking when relevant |
| `dormant` | Historical context only unless reactivated |
| `dismissed` | Suppressed |

## Evidence shape

Every edge should carry evidence explaining why it exists:

```json
{
  "semantic_similarity": 0.82,
  "matched_terms": ["tomorrow", "trust"],
  "source": "journal.created",
  "retrieval_model": "pplx-embed-v1-4b",
  "ranking_factors": {
    "highlight_affinity": 0.15,
    "dismissed_penalty": 0,
    "staleness_penalty": 0.04
  }
}
```

## UI contract

The UI should not expose a raw score as spiritual certainty. It can expose evidence gently:

- “Near a passage you highlighted.”
- “This echoes language from a past entry.”
- “A newly added voice also sits near this.”

Do not say:

- “This is definitely about fear.”
- “The system has determined your theme.”
