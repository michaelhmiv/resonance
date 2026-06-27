/**
 * GET /api/library/books — return the catalog of voice library works,
 * grouped into packages, filtered by the user's opt-in preferences.
 *
 * Reads voice_books.json. The Railway volume is the source of truth in
 * production; the bundled copy in ./data/seeded_library/ is the dev fallback
 * (so local dev without a volume still works).
 *
 * Filtering:
 *   - Reads user_settings(key='enabled_voice_packages')
 *   - null / unset = 'all' mode → return all packages
 *   - subset = 'subset' mode → return only packages the user has enabled
 *   - empty list = 'none' mode → return zero packages (with empty-state handled in UI)
 *
 * Response:
 *   {
 *     packages: [{
 *       packageId,
 *       label,
 *       books: [{ id, title, author, era, source }]
 *     }]
 *   }
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

// Module-level cache, invalidated on file mtime change so a volume upload
// (via /api/admin/upload-file) is picked up on the next request.
let cachedVoiceBooks: VoiceBook[] | null = null;
let cachedMtimeMs = 0;
let cachedPath = '';

function loadVoiceBooks(): VoiceBook[] {
  // Prefer the Railway volume; fall back to bundled copy
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

    // Get installed package_ids (unique, sorted for stable caching)
    const installed = [...new Set(allBooks.map((b) => b.package_id))].sort();

    // Resolve the user's enabled set, intersected with installed packages
    const { enabled } = await getEnabledVoicePackages(installed);
    const enabledSet = new Set(enabled);

    // Filter books by the enabled set
    const filteredBooks =
      enabledSet.size === installed.length
        ? allBooks
        : allBooks.filter((b) => enabledSet.has(b.package_id));

    // Group by package_id while preserving insertion order from the source file.
    const grouped = new Map<string, Array<{ id: string; title: string; author: string | null; era: string | null; source: string | null }>>();
    for (const b of filteredBooks) {
      const pid = b.package_id;
      if (!grouped.has(pid)) grouped.set(pid, []);
      grouped.get(pid)!.push({
        id: b.id,
        title: b.title,
        author: b.author,
        era: b.era,
        source: b.source,
      });
    }

    const packages = Array.from(grouped.entries()).map(([packageId, pkgBooks]) => ({
      packageId,
      label: packageLabel(packageId),
      books: pkgBooks,
    }));

    return NextResponse.json({ packages });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
