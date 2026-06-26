-- Adaptive Resonance Memory
-- Durable events + provisional interpretations + cache/job pipeline.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Canonical content nodes ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resonance_nodes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK (node_type IN ('journal_entry','highlight','note','reading_event','corpus_passage','theme_snapshot')),
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT,
  body_text TEXT,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted','archived')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, node_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_resonance_nodes_user_type ON resonance_nodes(user_id, node_type, status);
CREATE INDEX IF NOT EXISTS idx_resonance_nodes_source ON resonance_nodes(source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_resonance_nodes_hash ON resonance_nodes(content_hash);

-- ── Embeddings: content-hash keyed so unchanged content is never re-embedded ──
CREATE TABLE IF NOT EXISTS resonance_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  node_id UUID NOT NULL REFERENCES resonance_nodes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL DEFAULT 'pplx-embed-v1-4b',
  content_hash TEXT NOT NULL,
  dim INTEGER NOT NULL DEFAULT 2560,
  vector vector(2560),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (node_id, model_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_resonance_embeddings_node ON resonance_embeddings(node_id, model_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_resonance_embeddings_user ON resonance_embeddings(user_id, generated_at DESC);

-- ── Durable event ledger ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resonance_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  source_node_id UUID REFERENCES resonance_nodes(id) ON DELETE SET NULL,
  source_type TEXT,
  source_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resonance_events_user_time ON resonance_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resonance_events_source ON resonance_events(source_type, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resonance_events_node ON resonance_events(source_node_id, created_at DESC);

-- ── Provisional candidate/active/dormant edges ───────────────────────────
CREATE TABLE IF NOT EXISTS resonance_edges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES resonance_nodes(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('scripture','voice','past_entry','highlight','theme')),
  target_source TEXT,
  target_id TEXT NOT NULL,
  target_ref TEXT,
  score DOUBLE PRECISION NOT NULL DEFAULT 0,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  state TEXT NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate','reinforced','active','dormant','dismissed')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_node_id, target_kind, target_id)
);
CREATE INDEX IF NOT EXISTS idx_resonance_edges_source_state ON resonance_edges(source_node_id, state, score DESC);
CREATE INDEX IF NOT EXISTS idx_resonance_edges_user_target ON resonance_edges(user_id, target_kind, target_id);
CREATE INDEX IF NOT EXISTS idx_resonance_edges_expiry ON resonance_edges(expires_at) WHERE expires_at IS NOT NULL;

-- ── Result cache: source/content/model/corpus scoped ─────────────────────
CREATE TABLE IF NOT EXISTS resonance_result_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES resonance_nodes(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT 'pplx-embed-v1-4b',
  corpus_version_id UUID,
  result_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'fresh' CHECK (status IN ('fresh','stale','pending','failed')),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (cache_key)
);
CREATE INDEX IF NOT EXISTS idx_resonance_cache_source ON resonance_result_cache(source_type, source_id, status, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_resonance_cache_node ON resonance_result_cache(source_node_id, status, expires_at DESC);

-- ── Job queue ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resonance_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('journal_resonance','highlight_resonance','note_resonance','corpus_backfill','edge_decay','theme_snapshot')),
  source_node_id UUID REFERENCES resonance_nodes(id) ON DELETE CASCADE,
  source_table TEXT,
  source_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 100,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resonance_jobs_pending ON resonance_jobs(status, run_after, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_resonance_jobs_source ON resonance_jobs(source_table, source_id, created_at DESC);

-- ── Corpus and book ingestion/versioning ─────────────────────────────────
CREATE TABLE IF NOT EXISTS corpus_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model_id TEXT NOT NULL,
  corpus_hash TEXT NOT NULL,
  passage_count INTEGER NOT NULL DEFAULT 0,
  manifest_path TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('building','active','superseded','failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  UNIQUE (model_id, corpus_hash)
);
CREATE INDEX IF NOT EXISTS idx_corpus_versions_status ON corpus_versions(model_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS book_ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id TEXT NOT NULL,
  corpus_version_id UUID REFERENCES corpus_versions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 100,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_book_ingestion_jobs_status ON book_ingestion_jobs(status, priority, created_at);

-- ── Theme snapshots: provisional, evidence-backed, expiring labels ───────
CREATE TABLE IF NOT EXISTS theme_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  summary TEXT,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','dormant','dismissed','expired')),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_theme_snapshots_user_status ON theme_snapshots(user_id, status, confidence DESC);

-- ── RLS + service-role policies ──────────────────────────────────────────
ALTER TABLE resonance_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE resonance_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE resonance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE resonance_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE resonance_result_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE resonance_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_ingestion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_resonance_nodes" ON resonance_nodes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_resonance_embeddings" ON resonance_embeddings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_resonance_events" ON resonance_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_resonance_edges" ON resonance_edges FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_resonance_result_cache" ON resonance_result_cache FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_resonance_jobs" ON resonance_jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_corpus_versions" ON corpus_versions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_book_ingestion_jobs" ON book_ingestion_jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_theme_snapshots" ON theme_snapshots FOR ALL USING (true) WITH CHECK (true);
