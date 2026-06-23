/**
 * SQLite connection helper for the Resonance web app.
 *
 * Uses better-sqlite3 (synchronous, native). The connection is a module-level
 * singleton so route handlers share one open database across hot reloads /
 * requests. Tables are created idempotently on first access.
 *
 * DB path:
 *   - On Railway, uses the mounted persistent volume.
 *   - Locally / elsewhere, falls back to /tmp/resonance.db.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'resonance.db')
  : '/tmp/resonance.db';

export type { Database };

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      text        TEXT NOT NULL,
      created_at  INTEGER DEFAULT (strftime('%s','now')),
      updated_at  INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      verse_ref   TEXT NOT NULL,
      label       TEXT,
      created_at  INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS highlights (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      verse_ref   TEXT NOT NULL,
      color       TEXT NOT NULL,
      created_at  INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      verse_ref   TEXT NOT NULL,
      translation TEXT NOT NULL,
      text        TEXT NOT NULL,
      created_at  INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  dbInstance = db;
  return db;
}

/**
 * Generates a 16-char lowercase hex id, matching the SQL column default
 * `lower(hex(randomblob(8)))`. Generated in JS so create routes can return the
 * exact id without a second SELECT.
 */
export function generateId(): string {
  return randomBytes(8).toString('hex');
}
