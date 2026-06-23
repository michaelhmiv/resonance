import { MIGRATIONS, CURRENT_SCHEMA_VERSION, Migration } from './schema';
import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Version-based migration runner.
 *
 * A `schema_version` table holds the highest applied migration number. On
 * every launch we replay any migrations with a version greater than the
 * recorded one, each inside its own transaction. Migrations are append-only —
 * never edit a shipped migration; add a new one with an incremented version.
 *
 * (design spec §3.7: auto-save / persistence guarantees imply a robust,
 * always-run-on-launch DB init.)
 */

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: number[];
}

/**
 * Reads the recorded schema version, creating the tracking table if needed.
 * The tracking table keeps exactly one row (singleton) holding the version.
 */
async function getSchemaVersion(db: SQLiteDatabase): Promise<number> {
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS schema_version (
       singleton INTEGER PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
       version   INTEGER NOT NULL DEFAULT 0
     );`
  );
  await db.runAsync(
    `INSERT INTO schema_version (singleton, version) VALUES (1, 0)
     ON CONFLICT(singleton) DO NOTHING;`
  );
  const row = await db.getFirstAsync<{ version: number }>(
    `SELECT version FROM schema_version WHERE singleton = 1;`
  );
  return row?.version ?? 0;
}

/**
 * Runs all pending migrations in order. Each migration runs in its own
 * transaction; a failed migration throws and aborts startup so the DB is
 * never left in a half-migrated state.
 */
export async function runMigrations(
  db: SQLiteDatabase
): Promise<MigrationResult> {
  const fromVersion = await getSchemaVersion(db);
  const applied: number[] = [];

  const pending = MIGRATIONS.filter((m) => m.version > fromVersion).sort(
    (a, b) => a.version - b.version
  );

  for (const migration of pending) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
      // Record this version. The tracking table always has at most one row.
      await db.runAsync(
        `INSERT INTO schema_version (singleton, version) VALUES (1, ?)
         ON CONFLICT(singleton) DO UPDATE SET version = excluded.version;`,
        migration.version
      );
      applied.push(migration.version);
    });
  }

  return { fromVersion, toVersion: CURRENT_SCHEMA_VERSION, applied };
}

export type { Migration };
