// ── Pure shared types ──────────────────────────────────────────────────────
export * from './types';

// ── Bible canon (pure data + helpers) ──────────────────────────────────────
export * from './bible-canon';

// ── Embedding utilities (pure math) ─────────────────────────────────────────
export * from './embedding';

// ── LLM model catalog + system prompt ───────────────────────────────────────
export * from './llm';

// ── DataLayer interface (contract for mobile local + cloud impls) ───────────
export * from './data-layer';

// ── TF-IDF keyword extraction ──────────────────────────────────────────────
export * from './tfidf';

// ── Segment model (journal document structure) ─────────────────────────────
export * from './segmentModel';

// ── Schema (SQL DDL — same for both SQLite and PostgreSQL) ──────────────────
export * from './schema';

// ── HTTP cache (web-only; no-op on mobile and server) ───────────────────────
export * from './http-cache';

// ── Personal library document parsers & chunking pipeline (pure TS) ────────
export * from './document-parsers';
export * from './corpus-pipeline';

