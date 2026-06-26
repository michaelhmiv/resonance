# Resonance

Resonance is a Bible, Christian voices, journal, and reading-practice app focused on connecting the Word with everyday life.

## Architecture docs

Start here before modifying resonance mechanics:

- [`docs/resonance/README.md`](docs/resonance/README.md) — architecture overview
- [`docs/resonance/principles.md`](docs/resonance/principles.md) — product/technical constitution
- [`docs/resonance/agent-guide.md`](docs/resonance/agent-guide.md) — checklist for future agents
- [`docs/resonance/refresh-timing.md`](docs/resonance/refresh-timing.md) — immediate writes, queued jobs, lazy refresh, scheduled maintenance
- [`plans/2026-06-26-adaptive-resonance-architecture-documentation-plan.md`](plans/2026-06-26-adaptive-resonance-architecture-documentation-plan.md) — current implementation plan

## Key principle

> Events are durable. Interpretations are provisional.

The app should remember journal entries, highlights, notes, reading behavior, and explicit user interactions. It should not store permanent identity labels or stale spiritual diagnoses.

## Common commands

```bash
npm run typecheck:web
npm run typecheck:packages
npm run build --workspace=@resonance/web
```
