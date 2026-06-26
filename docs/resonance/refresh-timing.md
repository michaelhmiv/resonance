# Refresh Timing

This document answers the operational question: when does Resonance recompute, and when does it reuse cached/derived state?

## Short answer

Resonance should use a **hybrid event + queue + scheduled maintenance model**.

It should **not** re-evaluate everything on every journal entry or every `✦` tap.

```text
new user/corpus event
→ write durable fact immediately
→ enqueue targeted work
→ serve cached result when possible
→ refresh only affected neighborhoods
→ run scheduled decay/backfill maintenance separately
```

## What runs immediately

Immediate work should be cheap and necessary for correctness.

| Trigger | Immediate writes |
|---|---|
| Journal created | `journal_entries`, `resonance_nodes`, `resonance_events`, mark cache pending |
| Journal updated | update source row/node, append event, mark old cache stale |
| Highlight created | highlight row, highlight node, `highlight.created` event, durable `saved_from` edge |
| Note updated | update note text, note node/event, mark note-derived edges stale/dormant |
| Resonance opened/saved/dismissed | append event, update edge status/score |
| Book added | create ingestion job, book node/event, not full user-history recompute |

Immediate request path should return fast. It should not block journal saving or reading on full vector search.

## What runs in a near-real-time job

Near-real-time jobs should run seconds after the event, usually via a DB-backed queue or internal worker endpoint.

| Job | Timing target | Scope |
|---|---:|---|
| Embed new journal entry | seconds | one journal node if content hash changed |
| Build journal resonance cache | seconds | one source node and its candidate neighborhood |
| Embed updated note | seconds | one note node if content hash changed |
| Refresh affected caches from highlight/note | seconds-minutes | only nearby/relevant entries |
| Record interaction reinforcement | immediate or seconds | one edge/event neighborhood |

The UI can show `pending` while this runs.

## What runs lazily on demand

Lazy refresh happens when a user opens something whose cache is stale or missing.

```text
user opens old journal entry
→ return cached result if available
→ if stale/missing, enqueue refresh
→ update cache after refresh
```

This keeps old journal browsing fast and avoids mass recomputation after corpus changes.

## What runs on a schedule

Scheduled work should handle maintenance, decay, and low-priority backfill. This can be implemented as Railway cron, Supabase scheduled functions, or Hermes/agent-triggered admin jobs, but the app should model it as explicit jobs in `resonance_jobs` so work is inspectable.

Recommended schedule:

| Schedule | Job | Purpose |
|---|---|---|
| Every 5–15 minutes | Process queued resonance jobs | Drain small job batches if no always-on worker exists |
| Hourly | Retry failed jobs | Retry transient embedding/vector/API failures |
| Nightly | Edge decay | candidate→dormant, active decay, expire weak edges |
| Nightly | Selective corpus backfill | new books vs recent/high-signal user nodes |
| Daily | Rolling 30-day theme snapshots | update active patterns without blocking UI |
| Weekly | Weekly theme snapshot/archive | create/expire weekly summaries |

## Recommended implementation path

### Phase A: DB-backed queue, no separate worker yet

Start simple:

1. Add `resonance_jobs` table.
2. On write events, insert a queued job.
3. Add an authenticated internal route like `POST /api/resonance/jobs/process`.
4. Let the route process a bounded batch, e.g. 5–20 jobs.
5. Trigger the route from a schedule.

This avoids needing a long-running process on Railway immediately.

### Phase B: Scheduled processor

Use Railway cron or another scheduler to call the processor route every 5–15 minutes.

```text
*/10 * * * * curl -X POST https://.../api/resonance/jobs/process -H "x-admin-token: ..."
```

The route must be idempotent and bounded. Never let one cron invocation try to process the entire universe.

### Phase C: Optional always-on worker

If volume grows, add a dedicated worker/service that continuously drains `resonance_jobs`. Keep the same DB job model so operational visibility remains unchanged.

## Per-entry behavior

When a journal entry is created:

```text
0 ms      save durable journal row
0–50 ms   create/update node + append event
<100 ms   mark cache pending + enqueue job
response  return entry to UI
seconds   job embeds entry if needed
seconds   job retrieves/reranks candidates
seconds   job writes edges + result cache
next UI   ✦ reads fresh cache
```

If the user taps `✦` before the job finishes:

```text
return pending state or compute only that one entry synchronously if bounded
```

Do not trigger a full-history refresh.

## Per-highlight/note behavior

When a highlight is created:

```text
immediate: write highlight + event + durable passage edge
queued: refresh nearby/relevant journal caches
```

When note text changes:

```text
immediate: update note + event + mark old note-derived edges dormant
queued: embed note + rebuild note-affinity candidate edges
```

## Per-book behavior

When a book is added:

```text
immediate: create ingestion job
background: chunk/embed/index book
activation: create corpus version
queued: selective backfill only
lazy: old entries refresh when opened
```

Do not re-evaluate all entries immediately.

## Cache invalidation rules

| Change | Cache action |
|---|---|
| Journal text hash changed | invalidate that entry’s cache |
| Highlight created | mark related/nearby caches stale, not all caches |
| Note changed | mark note-affinity edges dormant; refresh related caches |
| Corpus version changed | mark caches stale by version, serve old result until refreshed |
| User dismisses result | update edge; suppress same/near duplicate in that context |
| User saves result | reinforce edge; future ranking can use it immediately |

## Why not evaluate everything every time?

Full re-evaluation would be slow, expensive, and spiritually stale in the wrong way. It would also make each journal entry depend on the whole historical universe instead of the relevant changed neighborhood.

The correct unit of recomputation is:

```text
the changed node + affected neighborhood + stale cache/version boundary
```

not:

```text
every entry + every book + every theme on every request
```

## Product behavior summary

- New entries become searchable/adaptive within seconds.
- `✦` opens fast from cache whenever possible.
- Highlights/notes influence future resonance quickly.
- New books enter new searches immediately after ingestion.
- Old entries improve lazily or via selective backfill.
- Themes update daily/weekly, not on every keystroke.
- Weak interpretations decay on a schedule.
