# Agent Guide for Resonance Mechanics

Read this before changing anything related to resonance, vectors, journal entries, highlights, notes, books, or Railway deployment.

## Required reading

1. `docs/resonance/README.md`
2. `docs/resonance/principles.md`
3. `docs/resonance/event-flow.md`
4. `docs/resonance/anti-staleness.md`
5. `docs/resonance/operational-runbook.md`
6. `docs/resonance/refresh-timing.md`
7. `plans/2026-06-26-adaptive-resonance-architecture-documentation-plan.md`
8. Hermes skill: `resonance-app`
9. Hermes skill: `railway` before any Railway inspection

## Non-negotiables

- Do not create permanent identity labels.
- Do not write “user is X” style fields.
- Do not make every journal load recompute resonance for every entry.
- Do not put schema creation in hot request paths.
- Do not use `railway up`.
- Do not perform destructive Railway probes.
- Do not treat `/api/health.gitSha` as proof of deployed code.

## Correct mental model

Resonance is:

```text
canonical content + durable user events + provisional edges + adaptive cache
```

It is not:

```text
LLM diagnosis + permanent labels + brute-force search every click
```

## Current important files

| Area | Files |
|---|---|
| Journal UI | `packages/screens/src/journal/JournalScreen.tsx` |
| Reading/highlight UI | `packages/screens/src/word/ReadingView.tsx` |
| DataLayer contract | `packages/core/src/data-layer.ts` |
| Shared types | `packages/core/src/types.ts` |
| Web adapter | `apps/web/lib/client-data-layer.ts` |
| Supabase helpers | `apps/web/lib/db.ts` |
| Resonance route | `apps/web/app/api/resonance/route.ts` |
| Embed route | `apps/web/app/api/embed/route.ts` |
| Vector status | `apps/web/app/api/vectors/status/route.ts` |
| Migrations | `supabase/migrations/*` |

## Known traps from 2026-06-26 audit

1. Journal auto-resonance can fan out one full vector scan per historical entry.
2. `/api/resonance` currently scans a 647 MB vector file per semantic request.
3. `modelCache` lacks an in-flight promise; cold concurrent requests can duplicate model load.
4. Active pplx manifest lacks `passage_ids`/`passage_sources` and falls back to sidecar alignment.
5. `ensureHighlightVectorsTable()` calls missing Supabase `run_sql` RPC in a hot path.
6. `/api/patterns/weekly` can call OpenRouter synchronously and be slow.
7. Root `npm run typecheck:web` is the trusted web typecheck command.

## Verification checklist

Before claiming done:

```bash
cd /data/resonance
npm run typecheck:web
npm run typecheck:packages
npm run build --workspace=@resonance/web
```

For deployed UX changes:

- Curl live endpoints.
- Open the live page in browser.
- Check console errors.
- Verify actual user-visible behavior, not just code existence.

## Language checklist

Approved:

- “This echoes…”
- “This sits near…”
- “You returned to…”
- “Recently…”
- “A newly added voice also sits near…”

Forbidden unless quoted from user text:

- “You are anxious.”
- “Your spiritual state is…”
- “This means you…”
- “The app knows…”

## If unsure

Prefer recording a durable event and a weak candidate edge over writing a strong conclusion. Weak candidates can expire. Bad conclusions rot.
