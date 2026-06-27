/**
 * library-prefs.ts — Per-user Library opt-in preferences.
 *
 * Storage shape:
 *   user_settings(key='enabled_voice_packages', value=JSON.stringify(string[]))
 *
 * Semantics:
 *   - null / missing / empty string in user_settings  →  'all'  (user hasn't customized; show everything)
 *   - valid JSON array of installed package_id values →  'subset' (user has chosen a specific set)
 *   - valid JSON array, length 0                      →  'none'  (user has explicitly opted out of all)
 *
 * Intersection with installed packages happens on every read. This means a new
 * package we ship next month automatically appears enabled for a user who has
 * a subset list (because their list is "things I want", not "things allowed").
 *
 * Pure read/write helpers. No caching across requests. The cost is one
 * user_settings row read per request that needs the prefs — fine for
 * human-speed interactions, and the user_settings table is small.
 */

import { getSettings, setSetting } from './db';

const KEY = 'enabled_voice_packages';

export type EnabledMode = 'all' | 'none' | 'subset';

export interface EnabledPackages {
  mode: EnabledMode;
  enabled: string[];
}

/**
 * Resolves which voice packages a user has enabled.
 *
 * @param installedPackageIds - the set of package_id values currently on disk
 *                             (e.g. ['patristic', 'medieval_devotional', ...])
 * @returns the resolved enabled set, intersected with installed packages
 */
export async function getEnabledVoicePackages(
  installedPackageIds: string[],
): Promise<EnabledPackages> {
  const installed = new Set(installedPackageIds);
  const settings = await getSettings();
  const raw = settings[KEY];

  // Null, missing, or empty string → default to all installed packages
  if (raw === undefined || raw === null || raw === '') {
    return { mode: 'all', enabled: [...installedPackageIds].sort() };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt value — log and fall back to all (safe default)
    console.warn(
      '[library-prefs] corrupt enabled_voice_packages value, falling back to all',
    );
    return { mode: 'all', enabled: [...installedPackageIds].sort() };
  }

  if (!Array.isArray(parsed)) {
    return { mode: 'all', enabled: [...installedPackageIds].sort() };
  }

  // Filter to valid string package_ids that are in the installed set
  const cleaned = parsed
    .filter((x): x is string => typeof x === 'string' && installed.has(x));

  // Dedupe
  const unique = [...new Set(cleaned)].sort();

  if (unique.length === 0) {
    return { mode: 'none', enabled: [] };
  }
  return { mode: 'subset', enabled: unique };
}

/**
 * Persists the user's enabled set.
 *
 * Validation:
 *   - Rejects package_id values that aren't in the installed set
 *   - Dedupes the input
 *   - Always writes a sorted, deduped JSON array
 *
 * @param packageIds - the desired enabled set (any subset of installed)
 * @param installedPackageIds - the set of installed package_ids (for validation)
 * @returns the persisted enabled set (after validation/dedup)
 */
export async function setEnabledVoicePackages(
  packageIds: string[],
  installedPackageIds: string[],
): Promise<{ enabled: string[] }> {
  const installed = new Set(installedPackageIds);
  const valid = [...new Set(packageIds)]
    .filter((id) => installed.has(id))
    .sort();
  await setSetting(KEY, JSON.stringify(valid));
  return { enabled: valid };
}

/**
 * Adds or removes a single package from the user's enabled set.
 *
 * If the user is currently in 'all' mode (no preference saved), and they
 * disable a package, we switch to a subset list (everyone except the disabled
 * one). This makes "I want everything except this one" work as expected.
 *
 * If the user is currently in 'all' mode and they enable a package that's
 * already enabled, this is a no-op (we just write the full installed set,
 * which is the same logical state).
 *
 * @param packageId - the package to toggle
 * @param enabled - the new desired state for that package
 * @param installedPackageIds - the set of installed package_ids
 * @returns the new enabled list after the toggle
 */
export async function toggleEnabledVoicePackage(
  packageId: string,
  enabled: boolean,
  installedPackageIds: string[],
): Promise<{ packageId: string; enabled: boolean; enabledList: string[] }> {
  const installed = new Set(installedPackageIds);
  if (!installed.has(packageId)) {
    throw new Error(`Unknown package: ${packageId}`);
  }

  const current = await getEnabledVoicePackages(installedPackageIds);
  let next: string[];

  if (current.mode === 'all') {
    // User is on default. Toggling any package creates an explicit subset.
    if (enabled) {
      // Enabling in 'all' mode is a no-op logically, but we don't write
      // (keeps the user in 'all' mode for future clean toggles).
      return {
        packageId,
        enabled: true,
        enabledList: current.enabled,
      };
    }
    next = current.enabled.filter((id) => id !== packageId);
  } else {
    // Subset or none: add or remove the package
    next = enabled
      ? [...current.enabled, packageId]
      : current.enabled.filter((id) => id !== packageId);
  }

  next = [...new Set(next)].sort();
  await setEnabledVoicePackages(next, installedPackageIds);
  return { packageId, enabled, enabledList: next };
}

/**
 * Clears the user's opt-in preference, returning them to the 'all' default.
 * Use this for the "Reset to all enabled" button in the Settings UI.
 */
export async function clearEnabledVoicePackages(): Promise<void> {
  // Setting to null is the documented 'no preference' state
  await setSetting(KEY, '');
}
