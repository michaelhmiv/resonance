/**
 * GET /api/library/books — return the catalog of voice library works,
 * grouped into packages.
 *
 * Reads voice_books.json (the ~18 voice works) and groups entries by
 * package_id, preserving order. The "seeded" package is labelled
 * "Seeded Library".
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
import { readFileSync } from 'fs';

const VOICE_BOOKS = '/data/resonance/build/output/seeded_library/voice_books.json';

interface VoiceBook {
  id: string;
  title: string;
  author: string | null;
  era: string | null;
  package_id: string;
  source: string | null;
  [key: string]: unknown;
}

// Module-level cache (lazy loaded on first request).
let cachedVoiceBooks: VoiceBook[] | null = null;

function loadVoiceBooks(): VoiceBook[] {
  if (!cachedVoiceBooks) {
    cachedVoiceBooks = JSON.parse(readFileSync(VOICE_BOOKS, 'utf-8'));
  }
  return cachedVoiceBooks as VoiceBook[];
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
    const books = loadVoiceBooks();

    // Group by package_id while preserving insertion order.
    const grouped = new Map<string, Array<{ id: string; title: string; author: string | null; era: string | null; source: string | null }>>();
    for (const b of books) {
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
