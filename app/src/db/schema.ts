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
];

/** The current target schema version (max across migrations). */
export const CURRENT_SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0
);
