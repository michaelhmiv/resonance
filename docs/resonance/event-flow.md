# Adaptive Resonance Event Flows

This document describes how Resonance adapts to new journal entries, highlights, notes, reading behavior, and books.

## Shared pipeline

```text
source change
→ append durable event
→ upsert node
→ embed if text changed
→ retrieve candidates
→ rerank with personal evidence
→ write provisional edges
→ cache compact result
→ UI reads cache/edges
→ user interaction reinforces or dismisses
```

Synchronous work should stay fast. Slow embedding/retrieval/backfill work should be queued or deferred wherever possible.

---

## `journal.created`

Triggered when the user saves a new journal entry.

```text
1. Insert journal_entries row.
2. Upsert resonance_nodes row type=journal_entry.
3. Append resonance_events row event_type=journal.created.
4. Compute content hash.
5. If no embedding exists for hash/model, enqueue embedding job.
6. Enqueue resonance job for this journal node.
7. Return saved entry to UI immediately.
```

The resonance job:

```text
1. Ensure journal node embedding exists.
2. Retrieve candidate Scripture passages.
3. Retrieve candidate voice passages.
4. Retrieve candidate past journal entries.
5. Retrieve related highlights/notes.
6. Rerank using adaptive-ranking.md.
7. Write candidate edges.
8. Write resonance_result_cache.
```

UI behavior:

- Entry appears immediately.
- `✦` may show pending.
- When cache is ready, `✦` expands quickly.

---

## `journal.updated`

Triggered when journal text changes.

```text
1. Update journal_entries row.
2. Update journal node text and content hash.
3. Append journal.updated event.
4. Mark old cache rows stale if content hash changed.
5. Mark old embedding-derived edges dormant unless reinforced by user action.
6. Enqueue new embedding/resonance job.
```

Explicit saved/dismissed user-action edges should not be blindly deleted. They may become dormant if no longer relevant, but the event history remains.

---

## `journal.deleted`

Triggered when an entry is deleted.

```text
1. Delete journal_entries row.
2. Delete/anonymize user-owned node depending on privacy policy.
3. Delete dependent embeddings/cache/edges.
4. Append deletion event only if policy allows retaining tombstones.
```

---

## `highlight.created`

A highlight is a strong explicit user signal.

```text
1. Insert highlights row.
2. Upsert highlight node.
3. Upsert canonical passage node if needed.
4. Append highlight.created event.
5. Create durable edge: highlight --saved_from--> passage.
6. If note_text exists, run highlight.note_updated flow.
7. Mark related journal caches stale or enqueue low-priority refresh.
```

Future ranking should boost highlighted passages and their neighborhoods.

---

## `highlight.note_updated`

A note is the user's own interpretation of a passage.

```text
1. Update highlights.note_text.
2. Upsert note node linked to highlight.
3. Append highlight.note_updated event.
4. Compute note content hash.
5. Recompute note embedding if hash changed.
6. Mark old note-derived edges dormant.
7. Retrieve related entries/passages/voices.
8. Write new candidate edges evidence_kind=note_affinity.
```

Notes should influence future resonance more than raw passage similarity because they express what mattered to the user.

---

## `passage.read`

Reading behavior is a contextual signal, not a diagnosis.

```text
1. Record reading event.
2. Append resonance event passage.read.
3. Optionally create reading_event node.
4. Boost nearby candidates for a short recency window.
```

This signal should decay quickly unless reinforced by highlights, notes, or repeated returns.

---

## `resonance.opened`

Triggered when user opens/expands a resonance card.

```text
1. Append resonance.opened event.
2. Find edge source -> target if it exists.
3. If candidate, promote to active.
4. Apply small reinforcement.
5. Extend expires_at modestly.
```

Opening is weak interest, not strong endorsement.

---

## `resonance.saved`

Triggered when a user saves/quotes/appends a resonance result.

```text
1. Append resonance.saved event.
2. Promote edge to reinforced.
3. Apply strong score/confidence boost.
4. Extend expiry or keep as historical explicit signal.
5. Future ranking should strongly prefer this target/neighborhood when relevant.
```

---

## `resonance.dismissed`

Triggered when user dismisses/hides a result.

```text
1. Append resonance.dismissed event.
2. Mark edge dismissed.
3. Apply dismissed penalty to similar future candidates in same context.
4. Do not delete historical event evidence.
```

Dismissals prevent the system from arguing with the user.

---

## `book.added`

Triggered when new book/corpus material is added.

```text
1. Validate source/license metadata.
2. Create book_ingestion_jobs row.
3. Create book node.
4. Chunk into passages.
5. Filter front matter/noise.
6. Create passage nodes.
7. Embed passages once.
8. Add vectors to active index or DB.
9. Create corpus_versions row.
10. Mark older caches stale by corpus version.
11. Enqueue selective backfill.
```

New books participate in future resonance immediately after activation.

---

## Selective backfill after `book.added`

Do **not** recompute all history. Prioritize:

1. Last 30 days journal entries
2. Entries with saved resonance
3. Highlight notes
4. Active theme snapshot evidence nodes
5. Low-confidence cached resonance results

Backfill compares target nodes only against the newly added book/passages and writes candidate edges with `evidence_kind = new_corpus_backfill`.

---

## Lazy historical refresh

When user opens an older entry whose cache predates the active corpus version:

```text
1. Return stale cached result immediately.
2. Enqueue refresh against current corpus.
3. If better result appears, update cache.
4. UI may quietly refresh or show “newer library material also echoes this.”
```
