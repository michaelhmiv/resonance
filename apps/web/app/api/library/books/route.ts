/**
 * GET /api/library/books — return the full Library catalog (all installed
 * voice books) along with the current user's per-book opt-in state.
 *
 * Replaces the per-package grouping. Each book is a top-level entry; the
 * packageId is still included for display grouping in the UI but the
 * opt-in granularity is per-book.
 *
 * Storage: user_settings(key='enabled_voice_books'). Migration from the
 * legacy enabled_voice_packages key is handled by getEnabledVoiceBooks().
 *
 * Response:
 *   {
 *     books: [
 *       { id, title, author, era, source, packageId, packageLabel, enabled }
 *     ],
 *     mode: 'all' | 'none' | 'subset'
 *   }
 *
 * The `mode` field is informational for the UI; 'all' means the user has
 * no preference saved, 'none' means explicitly empty, 'subset' means a
 * non-empty explicit list.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, statSync } from 'fs';
import { getEnabledVoiceBooks } from '../../../../lib/library-prefs';

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

    // Build bookId → packageId map for legacy migration + UI grouping
    const bookIdToPackage = new Map<string, string>();
    for (const b of allBooks) {
      bookIdToPackage.set(b.id, b.package_id);
    }

    const installedIds = allBooks.map((b) => b.id).sort();
    const { enabled, mode } = await getEnabledVoiceBooks(installedIds, bookIdToPackage);
    const enabledSet = new Set(enabled);

    // Flat list, sorted by package then title
    const books = allBooks
      .map((b) => ({
        id: b.id,
        title: b.title,
        author: b.author ?? null,
        era: b.era ?? null,
        source: b.source ?? null,
        packageId: b.package_id,
        packageLabel: packageLabel(b.package_id),
        enabled: enabledSet.has(b.id),
      }))
      .sort((a, b) => {
        const pkgCmp = a.packageId.localeCompare(b.packageId);
        if (pkgCmp !== 0) return pkgCmp;
        return a.title.localeCompare(b.title);
      });

    return NextResponse.json({ books, mode });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
