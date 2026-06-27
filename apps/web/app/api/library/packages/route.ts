/**
 * GET /api/library/packages — list installed voice packages with the current
 * user's opt-in state for each.
 *
 * This is the data source the Settings UI consumes to render the per-package
 * toggles. Each entry includes:
 *   - packageId: the stable identifier
 *   - label: human-readable name (derived, matches /api/library/books)
 *   - bookCount: number of works in the package
 *   - enabled: whether the current user has this package enabled
 *
 * Response:
 *   {
 *     installed: [
 *       { packageId, label, bookCount, enabled },
 *       ...
 *     ],
 *     mode: 'all' | 'none' | 'subset'
 *   }
 *
 * The `mode` field is informational for the UI (it lets the "Reset to all
 * enabled" button render differently when the user is already in 'all' mode).
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, statSync } from 'fs';
import { getEnabledVoicePackages } from '../../../../lib/library-prefs';

const VOLUME_PATH = '/data/seeded_library/voice_books.json';
const BUNDLED_PATH = './data/seeded_library/voice_books.json';

interface VoiceBook {
  id: string;
  title: string;
  author: string | null;
  era: string | null;
  package_id: string;
  source: string | null;
  [key: string]: unknown;
}

// Reuse the mtime-based cache so we don't re-read the 26 KB file on every request
let cachedVoiceBooks: VoiceBook[] | null = null;
let cachedMtimeMs = 0;
let cachedPath = '';

function loadVoiceBooks(): VoiceBook[] {
  const path = existsSync(VOLUME_PATH) ? VOLUME_PATH : BUNDLED_PATH;
  const stat = statSync(path);
  const mtimeMs = stat.mtimeMs;
  if (cachedVoiceBooks && path === cachedPath && mtimeMs === cachedMtimeMs) {
    return cachedVoiceBooks;
  }
  cachedVoiceBooks = JSON.parse(readFileSync(path, 'utf-8')) as VoiceBook[];
  cachedMtimeMs = mtimeMs;
  cachedPath = path;
  return cachedVoiceBooks;
}

function packageLabel(packageId: string): string {
  if (packageId === 'seeded') return 'Seeded Library';
  return packageId
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function GET(_request: NextRequest) {
  try {
    const allBooks = loadVoiceBooks();

    // Group by package_id, preserving source insertion order
    const byPackage = new Map<string, VoiceBook[]>();
    for (const b of allBooks) {
      if (!byPackage.has(b.package_id)) byPackage.set(b.package_id, []);
      byPackage.get(b.package_id)!.push(b);
    }

    const installedIds = [...byPackage.keys()].sort();
    const { enabled, mode } = await getEnabledVoicePackages(installedIds);
    const enabledSet = new Set(enabled);

    const installed = installedIds.map((id) => ({
      packageId: id,
      label: packageLabel(id),
      bookCount: byPackage.get(id)?.length ?? 0,
      enabled: enabledSet.has(id),
    }));

    return NextResponse.json({ installed, mode });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
