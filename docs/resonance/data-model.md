# Adaptive Resonance Data Model

This document defines the target data model. Existing tables remain source-of-truth for current app behavior; adaptive resonance tables add an event-sourced relation layer.

## Existing durable tables

| Table | Role |
|---|---|
| `profiles` | User identity/profile row |
| `journal_entries` | Durable journal text |
| `highlights` | Phrase-level highlights and optional notes |
| `bookmarks` | Saved reading positions/passages |
| `user_settings` | User preferences |
| `reading_events` | Reading history, if table exists |
| `highlight_vectors` | Existing per-highlight note vectors; needs migration alignment with active model |

## Target tables

### `resonance_nodes`

Every meaningful object gets a node.

```sql
resonance_nodes (
  id uuid primary key,
  user_id uuid null,
  type text not null,
  source_table text null,
  source_id text null,
  canonical_ref text null,
  text text not null default '',
  is_canonical boolean not null default false,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

Common `type` values:

- `scripture_passage`
- `voice_passage`
- `journal_entry`
- `highlight`
- `note`
- `book`
- `theme_snapshot`
- `reading_event`

### `resonance_embeddings`

Embeddings are separate from nodes so model changes do not rewrite node identity.

```sql
resonance_embeddings (
  node_id uuid references resonance_nodes(id) on delete cascade,
  model_id text not null,
  dim int not null,
  content_hash text not null,
  vector vector(...),
  generated_at timestamptz not null default now(),
  primary key (node_id, model_id, content_hash)
)
```

Rules:

- Same node may have multiple model embeddings.
- Changed text produces a new content hash.
- Do not re-embed unchanged content.

### `resonance_events`

Append-only facts about what happened.

```sql
resonance_events (
  id uuid primary key,
  user_id uuid null,
  event_type text not null,
  node_id uuid null references resonance_nodes(id),
  target_node_id uuid null references resonance_nodes(id),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
)
```

Event examples:

- `journal.created`
- `journal.updated`
- `highlight.created`
- `highlight.note_updated`
- `passage.read`
- `resonance.opened`
- `resonance.saved`
- `resonance.dismissed`
- `book.added`
- `book.completed`

### `resonance_edges`

Relationships between nodes. Edges are evidence-bearing interpretations, not permanent truth.

```sql
resonance_edges (
  id uuid primary key,
  user_id uuid null,
  from_node_id uuid not null references resonance_nodes(id),
  to_node_id uuid not null references resonance_nodes(id),
  relation text not null,
  score double precision not null default 0,
  confidence double precision not null default 0,
  evidence_kind text not null,
  status text not null default 'candidate',
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  last_reinforced_at timestamptz null,
  expires_at timestamptz null
)
```

Relations:

- `echoes`
- `near`
- `returned_to`
- `saved_from`
- `opened_from`
- `contrasts`
- `deepens`
- `answers`
- `same_trail`

Statuses:

- `candidate`
- `active`
- `reinforced`
- `dormant`
- `dismissed`

Evidence kinds:

- `embedding`
- `user_action`
- `phrase_overlap`
- `reading_history`
- `highlight_affinity`
- `note_affinity`
- `new_corpus_backfill`
- `manual`

### `resonance_result_cache`

Compact cached result for a source node.

```sql
resonance_result_cache (
  source_node_id uuid not null references resonance_nodes(id),
  content_hash text not null,
  embedding_model_id text not null,
  corpus_version_id uuid null,
  result jsonb not null,
  status text not null default 'fresh',
  generated_at timestamptz not null default now(),
  expires_at timestamptz null,
  primary key (source_node_id, content_hash, embedding_model_id, corpus_version_id)
)
```

Cache status:

- `fresh`
- `stale`
- `pending`
- `error`

### `theme_snapshots`

Time-windowed summaries, not identity labels.

```sql
theme_snapshots (
  id uuid primary key,
  user_id uuid not null,
  label text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  evidence_node_ids uuid[] not null default '{}',
  confidence double precision not null default 0,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active',
  metadata jsonb not null default '{}'
)
```

### `corpus_versions`

Records a canonical corpus/index build.

```sql
corpus_versions (
  id uuid primary key,
  model_id text not null,
  passage_count int not null,
  manifest_hash text not null,
  vector_path text null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  activated_at timestamptz null
)
```

### `book_ingestion_jobs`

Tracks corpus additions.

```sql
book_ingestion_jobs (
  id uuid primary key,
  book_id text not null,
  status text not null,
  corpus_version_id uuid null references corpus_versions(id),
  passage_count int null,
  embedded_count int not null default 0,
  error text null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

### `resonance_jobs`

Background work queue for journal/highlight/book adaptation.

```sql
resonance_jobs (
  id uuid primary key,
  job_type text not null,
  source_node_id uuid null references resonance_nodes(id),
  status text not null default 'queued',
  priority int not null default 100,
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  error text null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

## Privacy/deletion rule

Deleting user data must delete or anonymize user-owned nodes, events, edges, embeddings, cache rows, and snapshots. Canonical Scripture/voice nodes remain because they are not personal data.
