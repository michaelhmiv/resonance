import * as SQLite from 'expo-sqlite';

import { runMigrations, MigrationResult } from './migrations';
import { libraryBootstrap } from './libraryLoader';

/**
 * The single named database file backing everything offline-first.
 * All SQL access goes through this one connection.
 */
export const DATABASE_NAME = 'resonance.db';

export type DatabaseConnection = SQLite.SQLiteDatabase;

let connection: DatabaseConnection | null = null;

/**
 * Opens the database (creating the file on first launch), runs all pending
 * migrations, and — when the library is empty — bootstraps the seeded Library
 * from bundled assets. Safe to call more than once; subsequent calls return
 * the already-open connection without re-running migrations.
 */
export async function openDatabase(): Promise<DatabaseConnection> {
  if (connection) {
    return connection;
  }

  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  // Foreign keys on so ON DELETE CASCADE (journal_segment_vectors, passages)
  // actually cascades.
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const result: MigrationResult = await runMigrations(db);
  if (result.applied.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[db] schema migrated ${result.fromVersion} → ${result.toVersion} ` +
        `(applied: ${result.applied.join(', ')})`
    );
  }

  // First launch: an empty library is filled from the seeded assets that ship
  // in the app bundle. This is a no-op once the library is present.
  await libraryBootstrap(db);

  connection = db;
  return db;
}

/** Returns the live connection, or null before `openDatabase` resolves. */
export function getDatabase(): DatabaseConnection | null {
  return connection;
}

/** Closes the connection (primarily for tests / app teardown). */
export async function closeDatabase(): Promise<void> {
  if (connection) {
    await connection.closeAsync();
    connection = null;
  }
}
