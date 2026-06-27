/**
 * PUT /api/library/books/[bookId] — toggle one book's opt-in state.
 *
 * Body:
 *   { enabled: boolean }
 *
 * Behavior:
 *   - If the book is unknown (not in voice_books.json on disk): 404
 *   - If body shape is wrong: 400
 *   - On success: writes user_settings and returns the new state
 *
 * Response:
 *   {
 *     bookId: string,
 *     enabled: boolean,
 *     enabledList: string[]
 *   }
 *
 * Notes:
 *   - 'enabled: true' on a book the user has implicit-opted-into (i.e. they
 *     are in 'all' mode) is a no-op write — the user stays in 'all' mode,
 *     so they can keep toggling individual books cleanly.
 *   - 'enabled: false' on a book in 'all' mode switches to 'subset' mode
 *     and writes the new enabled list (every book except the disabled one).
 *   - This is the per-book equivalent of the deprecated
 *     PUT /api/library/packages/[packageId].
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, statSync } from 'fs';
import { toggleEnabledVoiceBook } from '../../../../../lib/library-prefs';

const VOLUME_PATH = '/data/seeded_library/voice_books.json';
const BUNDLED_PATH = './data/seeded_library/voice_books.json';

interface VoiceBook {
  id: string;
  [key: string]: unknown;
}

let cachedVoiceBooks: VoiceBook[] | null = null;
let cachedMtimeMs = 0;
let cachedPath = '';

function loadInstalledBookIds(): string[] {
  const path = existsSync(VOLUME_PATH) ? VOLUME_PATH : BUNDLED_PATH;
  const stat = statSync(path);
  const mtimeMs = stat.mtimeMs;
  if (cachedVoiceBooks && path === cachedPath && mtimeMs === cachedMtimeMs) {
    return cachedVoiceBooks.map((b) => b.id).sort();
  }
  cachedVoiceBooks = JSON.parse(readFileSync(path, 'utf-8')) as VoiceBook[];
  cachedMtimeMs = mtimeMs;
  cachedPath = path;
  return cachedVoiceBooks.map((b) => b.id).sort();
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await params;
  try {
    const installed = loadInstalledBookIds();
    if (!installed.includes(bookId)) {
      return NextResponse.json(
        { error: 'Unknown book', bookId },
        { status: 404 },
      );
    }

    let body: { enabled?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Body must be JSON: { enabled: boolean }' },
        { status: 400 },
      );
    }

    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 },
      );
    }

    const result = await toggleEnabledVoiceBook(
      bookId,
      body.enabled,
      installed,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Failed to update book preference',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
