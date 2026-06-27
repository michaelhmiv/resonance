/**
 * library-prefs.ts — Per-user Library opt-in preferences.
 *
 * Storage shape (new):
 *   user_settings(key='enabled_voice_books', value=JSON.stringify(string[]))
 *
 *   - null / missing / empty string         →  'all'   (user hasn't customized; show everything)
 *   - valid JSON array of book ids          →  'subset' (user has chosen a specific set)
 *   - valid JSON array, length 0            →  'none'   (user has explicitly opted out of all)
 *
 * Legacy storage shape (read for migration only, then cleared):
 *   user_settings(key='enabled_voice_packages', value=JSON.stringify(string[]))
 *
 *   - On first read after upgrade, if 'enabled_voice_books' is unset but
 *     'enabled_voice_packages' is set, we derive enabled_voice_books by
 *     expanding the package set into its constituent book ids and write
 *     the new key. The legacy key is then deleted. This is a one-shot
 *     migration, idempotent and safe to run on every read.
 *
 * Intersection with installed books happens on every read. A new book
 * added in a future release automatically appears enabled for a user in
 * 'all' mode. A user in 'subset' mode sees only the books they explicitly
 * listed; they can opt into new arrivals explicitly.
 *
 * Pure read/write helpers. No caching across requests. The cost is one
 * user_settings row read per request that needs the prefs — fine for
 * human-speed interactions, and the user_settings table is small.
 */

import { getSettings, setSetting, deleteSetting } from './db';

const KEY_BOOKS = 'enabled_voice_books';
const KEY_PACKAGES_LEGACY = 'enabled_voice_packages';

export type EnabledMode = 'all' | 'none' | 'subset';

export interface EnabledSet<T extends string> {
  mode: EnabledMode;
  enabled: T[];
}

/**
 * Resolves which voice books a user has enabled.
 *
 * Performs a one-shot migration from the legacy enabled_voice_packages key
 * on first call after upgrade. Safe to call from every route.
 *
 * @param installedBookIds - the set of book ids currently on disk
 *                           (e.g. ['ambrose-duties', 'anselm-basic-works', ...])
 * @param bookIdToPackage  - map from bookId → packageId, used for the
 *                           legacy package → book expansion
 * @returns the resolved enabled set, intersected with installed books
 */
export async function getEnabledVoiceBooks(
  installedBookIds: string[],
  bookIdToPackage: Map<string, string>,
): Promise<EnabledSet<string>> {
  const installed = new Set(installedBookIds);
  const settings = await getSettings();
  let raw = settings[KEY_BOOKS];

  // One-shot migration: expand legacy enabled_voice_packages into the
  // per-book key, then delete the legacy key so we don't repeat this.
  if (raw === undefined) {
    const legacyRaw = settings[KEY_PACKAGES_LEGACY];
    if (legacyRaw !== undefined && legacyRaw !== null && legacyRaw !== '') {
      let legacyParsed: unknown;
      try {
        legacyParsed = JSON.parse(legacyRaw);
      } catch {
        // Corrupt legacy value — fall through and treat as 'all'
        legacyParsed = null;
      }
      if (Array.isArray(legacyParsed)) {
        const enabledPackages = new Set(
          legacyParsed.filter((x): x is string => typeof x === 'string'),
        );
        const expanded = installedBookIds
          .filter((bid) => {
            const pkg = bookIdToPackage.get(bid);
            return pkg !== undefined && enabledPackages.has(pkg);
          })
          .sort();
        // Persist the expanded set so subsequent reads are fast.
        await setSetting(KEY_BOOKS, JSON.stringify(expanded));
        // Drop the legacy key to mark the migration complete.
        await deleteSetting(KEY_PACKAGES_LEGACY);
        if (expanded.length === 0) return { mode: 'none', enabled: [] };
        return { mode: 'subset', enabled: expanded };
      }
    }
    // No legacy value either — default to all installed books.
    return { mode: 'all', enabled: [...installedBookIds].sort() };
  }

  // null or empty string in the new key → default to all
  if (raw === null || raw === '') {
    return { mode: 'all', enabled: [...installedBookIds].sort() };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[library-prefs] corrupt enabled_voice_books value, falling back to all');
    return { mode: 'all', enabled: [...installedBookIds].sort() };
  }

  if (!Array.isArray(parsed)) {
    return { mode: 'all', enabled: [...installedBookIds].sort() };
  }

  // Filter to valid string book ids that are in the installed set
  const cleaned = parsed
    .filter((x): x is string => typeof x === 'string' && installed.has(x));

  const unique = [...new Set(cleaned)].sort();

  if (unique.length === 0) {
    return { mode: 'none', enabled: [] };
  }
  return { mode: 'subset', enabled: unique };
}

/**
 * Persists the user's enabled book set.
 *
 * @param bookIds        - the desired enabled set
 * @param installedBookIds - the set of installed book ids (for validation)
 * @returns the persisted enabled set (after validation/dedup)
 */
export async function setEnabledVoiceBooks(
  bookIds: string[],
  installedBookIds: string[],
): Promise<{ enabled: string[] }> {
  const installed = new Set(installedBookIds);
  const valid = [...new Set(bookIds)]
    .filter((id) => installed.has(id))
    .sort();
  await setSetting(KEY_BOOKS, JSON.stringify(valid));
  return { enabled: valid };
}

/**
 * Adds or removes a single book from the user's enabled set.
 *
 * If the user is currently in 'all' mode and they disable a book, we
 * switch to a subset list (everyone except the disabled one). This
 * makes "I want everything except this one" work as expected.
 *
 * @param bookId          - the book to toggle
 * @param enabled         - the new desired state for that book
 * @param installedBookIds - the set of installed book ids
 * @returns the new enabled list after the toggle
 */
export async function toggleEnabledVoiceBook(
  bookId: string,
  enabled: boolean,
  installedBookIds: string[],
): Promise<{ bookId: string; enabled: boolean; enabledList: string[] }> {
  const installed = new Set(installedBookIds);
  if (!installed.has(bookId)) {
    throw new Error(`Unknown book: ${bookId}`);
  }

  const bookIdToPackage = new Map<string, string>(); // not needed for toggle; pass empty
  const current = await getEnabledVoiceBooks(installedBookIds, bookIdToPackage);
  let next: string[];

  if (current.mode === 'all') {
    if (enabled) {
      // Enabling in 'all' mode is a no-op logically; stay in 'all' mode
      return { bookId, enabled: true, enabledList: current.enabled };
    }
    next = current.enabled.filter((id) => id !== bookId);
  } else {
    next = enabled
      ? [...current.enabled, bookId]
      : current.enabled.filter((id) => id !== bookId);
  }

  next = [...new Set(next)].sort();
  await setEnabledVoiceBooks(next, installedBookIds);
  return { bookId, enabled, enabledList: next };
}

/**
 * Clears the user's opt-in preference, returning them to the 'all' default.
 * Use this for the "Include all" button in the Settings UI.
 */
export async function clearEnabledVoiceBooks(): Promise<void> {
  // Setting to empty string is the documented 'no preference' state
  await setSetting(KEY_BOOKS, '');
}
