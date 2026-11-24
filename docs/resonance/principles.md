# Resonance Principles

## 1. Curation, not generation

Resonance should bring the user's life into contact with Scripture and faithful Christian witnesses. It should not replace the Word with generated spiritual advice.

Allowed LLM uses:

- cluster labels
- shift narratives
- concise summaries of evidence windows
- operational organization
- **passage selection for retrieval (ruled by Michael, 2026-11-24):** a
  *local, on-device* model may read a journal entry together with an
  embedding-retrieved candidate shortlist and choose/order the passages
  shown — a librarian, never an author. It produces no text the user reads
  as spiritual content; every passage shown remains a real text from
  Scripture, the author library, or the user's own writings. Embeddings
  retrieve by resemblance and cannot discern posture or direction (who
  wronged whom, which way the writer is moving); the reader step exists
  to exercise exactly that judgment, locally and privately.

Disallowed posture:

- generated prayers/advice as the primary product
- confident spiritual diagnosis
- treating model interpretations as source-of-truth

## 2. Events are durable; interpretations are provisional

Durable facts:

| Durable | Example |
|---|---|
| Journal entry | The user wrote a specific text at a specific time |
| Highlight | The user highlighted Matthew 6:34 |
| Note | The user wrote a note on a passage |
| Reading event | The user read Psalm 34 |
| Resonance interaction | The user opened/saved/dismissed a result |
| Book added | A corpus package was ingested |

Provisional interpretations:

| Provisional | Why provisional |
|---|---|
| Theme label | Time-windowed summary, not identity |
| Candidate edge | Similarity/evidence, not truth |
| Season label | Seasons end |
| “Answers/deepens/contrasts” | Interpretive relation |
| Cluster names | Recomputable summaries |

## 3. Never store identity claims

Wrong:

```text
user_is_anxious = true
```

Right:

```text
Between June 19 and June 26, these entries and highlights clustered around trust, tomorrow, and refuge.
```

Resonance remembers what happened and what was noticed. It does not define who the user is.

## 4. User action outranks model guess

Signal strength, strongest first:

1. Explicit save/append to journal
2. Highlight or note
3. Dismissal/negative feedback
4. Repeated return to a passage or trail
5. Opening a resonance card
6. Raw embedding similarity

A semantically close passage that the user repeatedly dismisses should fade. A moderately close passage the user highlighted and noted should rise.

## 5. New books enrich; they do not rewrite the person

When a new book is added:

- it participates in future search immediately
- recent/high-signal history can be selectively backfilled
- older entries are lazily refreshed when opened
- previous results are marked stale, not “wrong”

Do not recompute every user interpretation synchronously after corpus changes.

## 6. Old data becomes context and contrast

Old provisional labels should not remain active forever. But old durable events remain valuable as history.

Safe language:

> “This contrasts with several June entries that carried more tension around work.”

Unsafe language:

> “You are still anxious about work.”

## 7. UI stays humble

Approved language:

- “This echoes…”
- “This sits near…”
- “You returned to…”
- “Recently, several entries touched on…”
- “A newly added voice also sits near this entry.”

Avoid:

- “You are…”
- “Your problem is…”
- “The meaning of this entry is…”
- “Your spiritual condition is…”

## 8. Request-time brute force is not the final architecture

A prototype may scan vectors directly. The production direction is:

```text
embed once -> store node/embedding -> retrieve candidates -> rerank with evidence -> cache result -> reinforce/decay over time
```

Repeated `✦` views should read cached/durable results, not rebuild the universe.
