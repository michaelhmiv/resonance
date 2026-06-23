import { create } from 'zustand';

import type { DatabaseConnection } from './database';

/**
 * Zustand store for the database connection lifecycle.
 *
 * The database opens asynchronously at app launch (migrations + seeded-library
 * bootstrap can take a moment). Components that need DB access read this store
 * and only act once `status === 'ready'`. There are exactly three states:
 *
 *  - loading : openDatabase() is in flight (or not yet started)
 *  - ready   : connection is live and migrated
 *  - error   : open failed; the app can show a calm message rather than crash
 *
 * (design spec §2.3: no spinners / "thinking" indicators — so UI never shows a
 * processing state for the DB; it simply waits for ready.)
 */
export type DbStatus = 'loading' | 'ready' | 'error';

export interface DbState {
  status: DbStatus;
  /** Present when status === 'ready', null otherwise. */
  connection: DatabaseConnection | null;
  /** Present when status === 'error'. */
  error: string | null;

  /** Mark opening in progress. */
  setLoading: () => void;
  /** Mark open success and hand over the live connection. */
  setReady: (db: DatabaseConnection) => void;
  /** Mark open failure with a human-readable message. */
  setError: (message: string) => void;
  /** Reset to the initial loading state (e.g. before a retry). */
  reset: () => void;
}

export const useDbStore = create<DbState>((set) => ({
  status: 'loading',
  connection: null,
  error: null,

  setLoading: () => set({ status: 'loading', connection: null, error: null }),
  setReady: (db) =>
    set({ status: 'ready', connection: db, error: null }),
  setError: (message) =>
    set({ status: 'error', connection: null, error: message }),
  reset: () => set({ status: 'loading', connection: null, error: null }),
}));
