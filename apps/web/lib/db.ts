/**
 * Server-side SQLite database helper.
 * Uses better-sqlite3. Persists to Railway volume or /tmp for dev.
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'resonance.db')
  : '/tmp/resonance.db';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      verse_ref TEXT NOT NULL,
      label TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      verse_ref TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      verse_ref TEXT NOT NULL,
      translation TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return db;
}
