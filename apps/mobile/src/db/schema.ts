/**
 * Resonance SQLite schema.
 *
 * The full data model for the app, declared as versioned DDL. Every table is
 * created in migration `0001_initial`. Future schema changes are appended as
 * new migrations in `./migrations.ts`; existing migrations are never edited.
 *
 * Tables:
 *  - journal_segments       : the continuous living document (text, date
 *                             dividers, verse-of-day, footnotes, resonance
 *                             cards) — positioned by parent_date + index.
 *  - journal_segment_vectors: per-segment runtime embedding (the user's own
 *                             words). Never leaves the device.
 *  - resonance_history      : what surfaced, and when (de-dup + recency).
 *  - highlights             : Word-tab text highlights (shared across
 *                             translations, keyed by verse ref).
 *  - annotations            : per-translation margin notes.
 *  - bookmarks              : passages marked for return.
 *  - app_settings           : key/value store for preferences.
 *  - installed_packages     : which Book Packages + model vector sets are
 *                             present on-device.
 *  - books / passages       : the seeded Library and downloadable packages.
 *  - cluster_labels         : LLM-generated labels for Journal theme clusters
 *                             (Phase 4; deterministic fallback if declined).
 *  - shifts                 : "what shifted" narratives across time periods.
 */

/**
 * A single migration: an id, a human description, and the SQL to run.
 * Migrations run in order inside a transaction; the schema_version table
 * tracks the highest applied version.
 */
export interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'initial schema',
    sql: `
      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS journal_segments (
        id             TEXT PRIMARY KEY,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        segment_type   TEXT    NOT NULL CHECK (segment_type IN ('text','date_divider','verse_day','footnote','resonance_cards')),
        text           TEXT,
        position_index INTEGER NOT NULL,
        parent_date    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_journal_segments_date
        ON journal_segments (parent_date, position_index);

      CREATE TABLE IF NOT EXISTS journal_segment_vectors (
        segment_id  TEXT NOT NULL,
        vector_blob BLOB,
        FOREIGN KEY (segment_id) REFERENCES journal_segments (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS resonance_history (
        id           TEXT PRIMARY KEY,
        segment_id   TEXT,
        passage_id   INTEGER,
        surfaced_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_resonance_history_segment
        ON resonance_history (segment_id);

      CREATE TABLE IF NOT EXISTS highlights (
        id         TEXT PRIMARY KEY,
        verse_ref  TEXT NOT NULL,
        color      TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_highlights_ref
        ON highlights (verse_ref);

      CREATE TABLE IF NOT EXISTS annotations (
        id         TEXT PRIMARY KEY,
        verse_ref  TEXT NOT NULL,
        translation TEXT NOT NULL,
        text       TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_annotations_ref_trans
        ON annotations (verse_ref, translation);

      CREATE TABLE IF NOT EXISTS bookmarks (
        id         TEXT PRIMARY KEY,
        verse_ref  TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        label      TEXT
      );

      CREATE TABLE IF NOT EXISTS installed_packages (
        package_id    TEXT PRIMARY KEY,
        version       TEXT,
        model_id      TEXT,
        installed_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS books (
        id          TEXT PRIMARY KEY,
        title        TEXT,
        author      TEXT,
        era         TEXT,
        package_id  TEXT,
        type        TEXT,
        translation TEXT,
        source      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_books_package
        ON books (package_id);
      CREATE INDEX IF NOT EXISTS idx_books_type
        ON books (type);

      CREATE TABLE IF NOT EXISTS passages (
        id          INTEGER PRIMARY KEY,
        book_id     TEXT NOT NULL,
        chapter     INTEGER,
        verse_start INTEGER,
        verse_end   INTEGER,
        text        TEXT,
        translation TEXT,
        chunk_id    INTEGER,
        FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_passages_book
        ON passages (book_id);
      CREATE INDEX IF NOT EXISTS idx_passages_translation
        ON passages (translation);
      CREATE INDEX IF NOT EXISTS idx_passages_ref
        ON passages (book_id, chapter, verse_start);

      CREATE TABLE IF NOT EXISTS cluster_labels (
        id           TEXT PRIMARY KEY,
        cluster_id   TEXT NOT NULL,
        label        TEXT,
        generated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS shifts (
        id              TEXT PRIMARY KEY,
        comparison_date TEXT,
        period_1_start  TEXT,
        period_2_start  TEXT,
        narrative       TEXT,
        generated_at    INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    description: 'offline adaptive resonance parity',
    sql: `
      ALTER TABLE highlights ADD COLUMN start_offset INTEGER;
      ALTER TABLE highlights ADD COLUMN end_offset INTEGER;
      ALTER TABLE highlights ADD COLUMN selected_text TEXT;
      ALTER TABLE highlights ADD COLUMN note_text TEXT;
      ALTER TABLE highlights ADD COLUMN note_updated_at INTEGER;
      ALTER TABLE highlights ADD COLUMN updated_at INTEGER;

      CREATE TABLE IF NOT EXISTS reading_events (
        id         TEXT PRIMARY KEY,
        book_id    TEXT NOT NULL,
        chapter    INTEGER NOT NULL,
        verse_ref  TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reading_events_time ON reading_events (created_at DESC);

      CREATE TABLE IF NOT EXISTS resonance_nodes (
        id           TEXT PRIMARY KEY,
        node_type    TEXT NOT NULL,
        source_table TEXT NOT NULL,
        source_id    TEXT NOT NULL,
        title        TEXT,
        body_text    TEXT,
        content_hash TEXT,
        status       TEXT NOT NULL DEFAULT 'active',
        metadata     TEXT NOT NULL DEFAULT '{}',
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        UNIQUE (node_type, source_id)
      );
      CREATE INDEX IF NOT EXISTS idx_resonance_nodes_source ON resonance_nodes (source_table, source_id);

      CREATE TABLE IF NOT EXISTS resonance_events (
        id             TEXT PRIMARY KEY,
        event_type     TEXT NOT NULL,
        source_node_id TEXT,
        source_type    TEXT,
        source_id      TEXT,
        payload        TEXT NOT NULL DEFAULT '{}',
        created_at     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_resonance_events_source ON resonance_events (source_type, source_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS resonance_jobs (
        id             TEXT PRIMARY KEY,
        job_type       TEXT NOT NULL,
        source_node_id TEXT,
        source_table   TEXT,
        source_id      TEXT,
        status         TEXT NOT NULL DEFAULT 'pending',
        priority       INTEGER NOT NULL DEFAULT 100,
        attempts       INTEGER NOT NULL DEFAULT 0,
        max_attempts   INTEGER NOT NULL DEFAULT 3,
        run_after      INTEGER NOT NULL,
        completed_at   INTEGER,
        error          TEXT,
        payload        TEXT NOT NULL DEFAULT '{}',
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_resonance_jobs_pending ON resonance_jobs (status, run_after, priority, created_at);

      CREATE TABLE IF NOT EXISTS resonance_result_cache (
        id             TEXT PRIMARY KEY,
        source_node_id TEXT NOT NULL,
        source_type    TEXT NOT NULL,
        source_id      TEXT NOT NULL,
        cache_key      TEXT NOT NULL UNIQUE,
        content_hash   TEXT NOT NULL,
        model_id       TEXT NOT NULL,
        result_json    TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'fresh',
        computed_at    INTEGER NOT NULL,
        expires_at     INTEGER NOT NULL,
        metadata       TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_resonance_cache_source ON resonance_result_cache (source_type, source_id, status, expires_at DESC);

      CREATE TABLE IF NOT EXISTS resonance_edges (
        id             TEXT PRIMARY KEY,
        source_node_id TEXT NOT NULL,
        target_kind    TEXT NOT NULL,
        target_source  TEXT,
        target_id      TEXT NOT NULL,
        target_ref     TEXT,
        score          REAL NOT NULL DEFAULT 0,
        confidence     REAL NOT NULL DEFAULT 0,
        state          TEXT NOT NULL DEFAULT 'candidate',
        evidence       TEXT NOT NULL DEFAULT '[]',
        first_seen_at  INTEGER NOT NULL,
        last_seen_at   INTEGER NOT NULL,
        expires_at     INTEGER,
        metadata       TEXT NOT NULL DEFAULT '{}',
        UNIQUE (source_node_id, target_kind, target_id)
      );

      CREATE TABLE IF NOT EXISTS theme_snapshots (
        id         TEXT PRIMARY KEY,
        label      TEXT NOT NULL,
        summary    TEXT,
        confidence REAL NOT NULL DEFAULT 0,
        evidence   TEXT NOT NULL DEFAULT '[]',
        status     TEXT NOT NULL DEFAULT 'active',
        valid_from INTEGER NOT NULL,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_outbox (
        id          TEXT PRIMARY KEY,
        event_id    TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        attempts    INTEGER NOT NULL DEFAULT 0,
        last_error  TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
    `,
  },
  {
    version: 3,
    description: 'personal library corpora, int8 passage vectors, and offline engine downloads',
    sql: `
      ALTER TABLE passages ADD COLUMN division TEXT;

      CREATE TABLE IF NOT EXISTS personal_books (
        book_id              TEXT PRIMARY KEY,
        source_format        TEXT NOT NULL,
        source_filename      TEXT NOT NULL,
        local_file_path      TEXT,
        file_size_bytes      INTEGER NOT NULL DEFAULT 0,
        file_hash            TEXT NOT NULL,
        collection           TEXT NOT NULL DEFAULT 'Personal Library',
        tags_json            TEXT NOT NULL DEFAULT '[]',
        notes                TEXT NOT NULL DEFAULT '',
        include_in_resonance INTEGER NOT NULL DEFAULT 1,
        embedding_status     TEXT NOT NULL DEFAULT 'pending',
        embedded_chunks      INTEGER NOT NULL DEFAULT 0,
        total_chunks         INTEGER NOT NULL DEFAULT 0,
        embedding_model      TEXT,
        last_error           TEXT,
        ocr_required         INTEGER NOT NULL DEFAULT 0,
        warnings_json        TEXT NOT NULL DEFAULT '[]',
        imported_at          INTEGER NOT NULL,
        updated_at           INTEGER NOT NULL,
        FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_personal_books_hash
        ON personal_books (file_hash);
      CREATE INDEX IF NOT EXISTS idx_personal_books_status
        ON personal_books (embedding_status);

      CREATE TABLE IF NOT EXISTS passage_vectors (
        passage_id   INTEGER PRIMARY KEY,
        book_id      TEXT NOT NULL,
        model_id     TEXT NOT NULL,
        dim          INTEGER NOT NULL,
        scale        REAL NOT NULL,
        vector_int8  BLOB NOT NULL,
        updated_at   INTEGER NOT NULL,
        FOREIGN KEY (passage_id) REFERENCES passages (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_passage_vectors_book
        ON passage_vectors (book_id, model_id);

      CREATE TABLE IF NOT EXISTS offline_downloads (
        artifact_id      TEXT PRIMARY KEY,
        group_name       TEXT NOT NULL,
        url              TEXT NOT NULL,
        local_path       TEXT NOT NULL,
        expected_bytes   INTEGER NOT NULL DEFAULT 0,
        downloaded_bytes INTEGER NOT NULL DEFAULT 0,
        expected_sha256  TEXT,
        status           TEXT NOT NULL DEFAULT 'pending',
        resume_data      TEXT,
        error            TEXT,
        updated_at       INTEGER NOT NULL
      );
    `,
  },
  {
    version: 4,
    description: 'reader v2: exact reading progress, durable highlight anchors/tags/styles, and highlight_vectors',
    sql: `
      ALTER TABLE highlights ADD COLUMN book_id TEXT;
      ALTER TABLE highlights ADD COLUMN chapter_id TEXT;
      ALTER TABLE highlights ADD COLUMN quote_prefix TEXT;
      ALTER TABLE highlights ADD COLUMN quote_suffix TEXT;
      ALTER TABLE highlights ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE highlights ADD COLUMN style TEXT NOT NULL DEFAULT 'fill';
      ALTER TABLE highlights ADD COLUMN embedded_at INTEGER;
      CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights (book_id);

      ALTER TABLE bookmarks ADD COLUMN book_id TEXT;
      ALTER TABLE bookmarks ADD COLUMN chapter_id TEXT;
      ALTER TABLE bookmarks ADD COLUMN passage_id INTEGER;
      CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks (book_id);

      CREATE TABLE IF NOT EXISTS reading_progress (
        book_id       TEXT PRIMARY KEY,
        chapter_id    TEXT,
        chapter_index INTEGER NOT NULL DEFAULT 0,
        block_index   INTEGER NOT NULL DEFAULT 0,
        passage_id    INTEGER,
        verse_number  INTEGER,
        scroll_pct    REAL NOT NULL DEFAULT 0,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reading_progress_updated
        ON reading_progress (updated_at DESC);

      CREATE TABLE IF NOT EXISTS highlight_vectors (
        id           TEXT PRIMARY KEY,
        highlight_id TEXT NOT NULL,
        kind         TEXT NOT NULL CHECK (kind IN ('highlight', 'note')),
        model_id     TEXT NOT NULL,
        dim          INTEGER NOT NULL,
        scale        REAL NOT NULL,
        vector_int8  BLOB NOT NULL,
        source_label TEXT,
        updated_at   INTEGER NOT NULL,
        UNIQUE (highlight_id, kind),
        FOREIGN KEY (highlight_id) REFERENCES highlights (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_highlight_vectors_hl
        ON highlight_vectors (highlight_id, kind);
    `,
  },
  {
    version: 5,
    description:
      'OpenRouter BYOK multi-model vector isolation, Multimodal Life Diary media/people tables, and usage ledger',
    sql: `
      -- 1. Non-destructive multi-model passage_vectors keyed by (passage_id, model_id)
      ALTER TABLE passage_vectors RENAME TO passage_vectors_v4;
      CREATE TABLE IF NOT EXISTS passage_vectors (
        passage_id   INTEGER NOT NULL,
        book_id      TEXT NOT NULL,
        model_id     TEXT NOT NULL,
        dim          INTEGER NOT NULL,
        scale        REAL NOT NULL,
        vector_int8  BLOB NOT NULL,
        updated_at   INTEGER NOT NULL,
        PRIMARY KEY (passage_id, model_id),
        FOREIGN KEY (passage_id) REFERENCES passages (id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO passage_vectors
        (passage_id, book_id, model_id, dim, scale, vector_int8, updated_at)
      SELECT passage_id, book_id, model_id, dim, scale, vector_int8, updated_at
      FROM passage_vectors_v4;
      DROP TABLE passage_vectors_v4;
      CREATE INDEX IF NOT EXISTS idx_passage_vectors_book
        ON passage_vectors (book_id, model_id);
      CREATE INDEX IF NOT EXISTS idx_passage_vectors_model
        ON passage_vectors (model_id, passage_id);

      -- 2. Non-destructive multi-model journal_segment_vectors keyed by (segment_id, model_id)
      ALTER TABLE journal_segment_vectors RENAME TO journal_segment_vectors_v4;
      CREATE TABLE IF NOT EXISTS journal_segment_vectors (
        segment_id   TEXT NOT NULL,
        model_id     TEXT NOT NULL DEFAULT 'voyage-4-nano',
        dim          INTEGER NOT NULL DEFAULT 512,
        scale        REAL,
        vector_int8  BLOB,
        vector_blob  BLOB,
        updated_at   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (segment_id, model_id),
        FOREIGN KEY (segment_id) REFERENCES journal_segments (id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO journal_segment_vectors
        (segment_id, model_id, dim, vector_blob, updated_at)
      SELECT segment_id, 'voyage-4-nano', 512, vector_blob, 0
      FROM journal_segment_vectors_v4;
      DROP TABLE journal_segment_vectors_v4;
      CREATE INDEX IF NOT EXISTS idx_journal_segment_vectors_model
        ON journal_segment_vectors (model_id, segment_id);

      -- 3. Non-destructive multi-model highlight_vectors keyed by (highlight_id, kind, model_id)
      ALTER TABLE highlight_vectors RENAME TO highlight_vectors_v4;
      CREATE TABLE IF NOT EXISTS highlight_vectors (
        id           TEXT PRIMARY KEY,
        highlight_id TEXT NOT NULL,
        kind         TEXT NOT NULL CHECK (kind IN ('highlight', 'note')),
        model_id     TEXT NOT NULL,
        dim          INTEGER NOT NULL,
        scale        REAL NOT NULL,
        vector_int8  BLOB NOT NULL,
        source_label TEXT,
        updated_at   INTEGER NOT NULL,
        UNIQUE (highlight_id, kind, model_id),
        FOREIGN KEY (highlight_id) REFERENCES highlights (id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO highlight_vectors
        (id, highlight_id, kind, model_id, dim, scale, vector_int8, source_label, updated_at)
      SELECT id, highlight_id, kind, model_id, dim, scale, vector_int8, source_label, updated_at
      FROM highlight_vectors_v4;
      DROP TABLE highlight_vectors_v4;
      CREATE INDEX IF NOT EXISTS idx_highlight_vectors_hl
        ON highlight_vectors (highlight_id, kind, model_id);

      -- 4. Multimodal Life Diary media items (voice notes, photos, short videos)
      CREATE TABLE IF NOT EXISTS diary_media (
        id                TEXT PRIMARY KEY,
        segment_id        TEXT NOT NULL,
        kind              TEXT NOT NULL CHECK (kind IN ('voice', 'photo', 'video')),
        local_uri         TEXT NOT NULL,
        thumb_uri         TEXT,
        mime_type         TEXT NOT NULL,
        byte_size         INTEGER NOT NULL DEFAULT 0,
        duration_ms       INTEGER,
        width             INTEGER,
        height            INTEGER,
        caption           TEXT,
        transcript        TEXT,
        ai_summary        TEXT,
        ocr_text          TEXT,
        moment_type       TEXT,
        location_label    TEXT,
        captured_at       INTEGER NOT NULL,
        processing_status TEXT NOT NULL DEFAULT 'queued'
                          CHECK (processing_status IN ('queued', 'processing', 'ready', 'error')),
        processing_error  TEXT,
        ai_model_used     TEXT,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        FOREIGN KEY (segment_id) REFERENCES journal_segments (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_diary_media_segment
        ON diary_media (segment_id);
      CREATE INDEX IF NOT EXISTS idx_diary_media_kind_date
        ON diary_media (kind, captured_at DESC);
      CREATE INDEX IF NOT EXISTS idx_diary_media_status
        ON diary_media (processing_status);

      -- 5. Local user-confirmed People directory & memory links (no face recognition)
      CREATE TABLE IF NOT EXISTS diary_people (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
        relationship TEXT,
        created_at   INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS diary_media_people (
        media_id  TEXT NOT NULL,
        person_id TEXT NOT NULL,
        PRIMARY KEY (media_id, person_id),
        FOREIGN KEY (media_id) REFERENCES diary_media (id) ON DELETE CASCADE,
        FOREIGN KEY (person_id) REFERENCES diary_people (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_diary_media_people_person
        ON diary_media_people (person_id);

      CREATE TABLE IF NOT EXISTS journal_segment_people (
        segment_id TEXT NOT NULL,
        person_id  TEXT NOT NULL,
        PRIMARY KEY (segment_id, person_id),
        FOREIGN KEY (segment_id) REFERENCES journal_segments (id) ON DELETE CASCADE,
        FOREIGN KEY (person_id) REFERENCES diary_people (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_journal_segment_people_person
        ON journal_segment_people (person_id);

      -- 6. Local OpenRouter token & spend ledger
      CREATE TABLE IF NOT EXISTS openrouter_usage_log (
        id                 TEXT PRIMARY KEY,
        task_kind          TEXT NOT NULL,
        model_id           TEXT NOT NULL,
        prompt_tokens      INTEGER NOT NULL DEFAULT 0,
        completion_tokens  INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        created_at         INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_openrouter_usage_created
        ON openrouter_usage_log (created_at DESC);
    `,
  },
];

/** The current target schema version (max across migrations). */
export const CURRENT_SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0
);
