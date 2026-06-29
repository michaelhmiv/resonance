# Patterns Verification Checklist

Use this checklist when reviewing the Patterns batch. It is intentionally migration-aware but does not require migrations to be applied before the first review.

## Primary acceptance rule

The Patterns tab must never appear dead. It should render one of:

- useful evidence-backed content
- an explicit empty state
- a partial state explaining missing data
- a local fallback state when the backend summary is unavailable

## Data-state scenarios

### 1. No activity

Expected:

- Recently card says Patterns need traces.
- Calendar renders current month.
- No dots appear.
- Day click shows no activity found, not an error.
- Echoes, Returned To, Themes, and Trails show empty-state copy.

### 2. One journal entry

Expected:

- Calendar shows a journal dot on the entry date.
- Day detail shows the journal excerpt.
- Recently card reports journal activity.
- Recurring Themes may remain empty because one entry is not enough for a recurring pattern.

### 3. Multiple journal entries in the same week

Expected:

- Calendar shows journal dots on each entry date.
- Same-day entries count correctly.
- Local fallback themes may appear if backend theme snapshots are missing.
- No stale fixed-week bug: entries earlier in the current week should not be ignored.

### 4. Reading events present

Expected:

- Calendar shows reading dots.
- Day detail groups reading activity separately from journal activity.
- Returned To appears when the same ref/book/chapter repeats.

### 5. Highlights present

Expected:

- Calendar shows highlight dots on highlight creation dates.
- Day detail shows verse ref and selected text when present.
- Highlight plus reading on same ref can produce Returned To signal.

### 6. Notes present

Expected:

- Calendar shows note dots on note update date.
- Day detail shows note excerpt separately from highlight excerpt.
- Note evidence can participate in themes and returned-to signals.

### 7. Bookmarks present

Expected:

- Calendar shows bookmark dots.
- Day detail shows bookmark ref and label when available.

### 8. Resonance edges present

Expected:

- Echoes Worth Revisiting shows evidence-backed cards.
- Echo dots appear on edge last-seen dates.
- Trails may use top echo evidence when no richer chain exists.

### 9. Theme snapshots present

Expected:

- Recurring Themes use `theme_snapshots` before local keyword fallback.
- Theme cards show label, summary, evidence count, and date window.
- Evidence excerpts render if present.

### 10. Optional adaptive tables missing

Expected:

- `/api/patterns/summary` still returns a valid response if optional adaptive tables are absent.
- Missing `resonance_events`, `resonance_edges`, or `theme_snapshots` should not crash the API.
- UI hides or empty-states adaptive sections.

### 11. `reading_events` missing

Expected:

- Journal/highlight/bookmark evidence still works.
- Reading dots are absent.
- API logs degraded state server-side but returns a valid response.

### 12. Month with fewer than 31 days

Expected:

- Reading window uses actual month end.
- Calendar does not request invalid date ranges such as February 31.

### 13. Backend summary failure

Expected:

- UI falls back to local journal/reading summary.
- A small fallback notice renders.
- The screen does not stay on a permanent spinner.

### 14. Day detail failure

Expected:

- Selected day remains visible.
- Detail card shows available count data or empty detail fallback.
- The screen does not crash.

## Feedback route scenarios

### Valid opened event

Request:

```json
{
  "action": "opened",
  "surface": "echo",
  "itemId": "example-echo-id"
}
```

Expected:

- Returns `{ ok: true }`.
- Appends event when `resonance_events` exists.
- Does not fail hard if adaptive tables are missing.

### Valid dismissed event

Request:

```json
{
  "action": "dismissed",
  "surface": "echo",
  "itemId": "example-echo-id",
  "edgeId": "example-edge-id"
}
```

Expected after migrations:

- Appends feedback event.
- Updates edge state to `dismissed`.
- Dismissed edge should not resurface in summary queries.

### Invalid event

Expected:

- Missing `action`, bad `surface`, or missing `itemId` returns 400.
- No write is attempted.

## Product-language checks

Allowed language:

- Recently...
- This echoes...
- This sits near...
- You returned to...
- Several traces touched...

Avoid:

- You are...
- Your spiritual state is...
- This means...
- God is telling you...
- permanent identity labels

## Migration handoff checks

Coding agent should verify or add:

- `reading_events`
- `resonance_nodes`
- `resonance_events`
- `resonance_edges`
- `theme_snapshots`
- optional `resonance_embeddings`
- optional `resonance_result_cache`
- optional `resonance_jobs`

Also verify RLS/policies before exposing client-side access. The current implementation should use server-side Supabase service access only.
