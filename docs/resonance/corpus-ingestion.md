# Corpus and Book Ingestion

This document explains how newly added books/passages should enter Resonance without forcing stale or expensive recomputation.

## Goals

1. New books participate in future resonance immediately after activation.
2. Old entries can benefit from new material over time.
3. Adding a book must not rewrite all user history synchronously.
4. Every corpus/index build must be versioned and auditable.

## Ingestion pipeline

```text
book/package selected
→ validate source/license
→ create book_ingestion_job
→ create book node
→ chunk into passage nodes
→ filter front matter/noise
→ embed passages once
→ add to vector index or pgvector
→ create/activate corpus_version
→ mark older caches stale
→ selectively backfill recent/high-signal nodes
```

## Book metadata

Store enough metadata for future agents to audit source quality:

- title
- author
- era
- source URL/provider
- public-domain/license status
- package id
- ingestion script version
- chunking version
- embedding model id

## Chunking

Chunking must be deterministic for a given book + script version. Passage IDs should remain stable when possible.

Front-matter filtering should remove:

- publisher imprints
- copyright notices
- table of contents
- standalone prefaces/intros when not spiritually useful
- very short noise chunks

Do not silently discard large sections without logging counts.

## Corpus versioning

Every activated corpus/index should create a `corpus_versions` row containing:

- model id
- passage count
- manifest hash
- vector path or DB index identifier
- build/upload timestamp
- activation timestamp
- script versions

Resonance caches must record which corpus version they used.

## Future-aware behavior

After activation, new journal entries and new notes should search the new corpus immediately.

```text
new book activated at T
journal entry created after T
→ retrieval includes new book passages
```

## Selective backfill

When a book is added, enqueue low-priority backfill for:

1. Recent journal entries, e.g. last 30 days
2. Entries with saved/reinforced resonance
3. Highlight notes
4. Active theme snapshot evidence nodes
5. Low-confidence cached results

Backfill compares those targets against the newly added book/passages only. If strong enough, create candidate edges:

```text
evidence_kind = new_corpus_backfill
status = candidate
expires_at = short/medium window unless reinforced
```

## Lazy historical recompute

For older entries:

```text
user opens entry
→ if cache corpus_version is stale:
   return cached result immediately
   enqueue refresh
   update cache when complete
```

This keeps old pages fast and avoids surprising mass changes.

## What not to do

- Do not recompute every journal entry after every corpus change.
- Do not mark old results as wrong just because corpus changed.
- Do not treat new book candidates as stronger merely because they are new.
- Do not upload/delete Railway volume files without explicit approval and a safe runbook.

## Operational notes

Current production has a Railway volume at `/data` and active vectors under `/data/vectors/pplx-embed-v1-4b`. The live audit found the active manifest lacks `passage_ids`/`passage_sources` and falls back to a sidecar alignment file. Future ingestion work should make active manifests self-contained.
