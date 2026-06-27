/**
 * PUT /api/library/packages/[packageId] — toggle one package's opt-in state.
 *
 * Body:
 *   { enabled: boolean }
 *
 * Behavior:
 *   - If the package is unknown (not in voice_books.json on disk): 404
 *   - If body shape is wrong: 400
 *   - On success: writes user_settings and returns the new state
 *
 * Response:
 *   {
 *     packageId: string,
 *     enabled: boolean,
 *     enabledList: string[]
 *   }
 *
 * Notes:
 *   - 'enabled: true' on a package the user has implicit-opted-into (i.e. they
 *     are in 'all' mode) is a no-op write — the user stays in 'all' mode,
 *     so they can keep toggling individual packages cleanly.
 *   - 'enabled: false' on a package in 'all' mode switches to 'subset' mode
 *     and writes the new enabled list.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, statSync } from 'fs';
import { toggleEnabledVoicePackage } from '../../../../../lib/library-prefs';

const VOLUME_PATH = '/data/seeded_library/voice_books.json';
const BUNDLED_PATH = './data/seeded_library/voice_books.json';

interface VoiceBook {
  package_id: string;
  [key: string]: unknown;
}

let cachedVoiceBooks: VoiceBook[] | null = null;
let cachedMtimeMs = 0;
let cachedPath = '';

function loadInstalledPackageIds(): string[] {
  const path = existsSync(VOLUME_PATH) ? VOLUME_PATH : BUNDLED_PATH;
  const stat = statSync(path);
  const mtimeMs = stat.mtimeMs;
  if (cachedVoiceBooks && path === cachedPath && mtimeMs === cachedMtimeMs) {
    return [...new Set(cachedVoiceBooks.map((b) => b.package_id))].sort();
  }
  cachedVoiceBooks = JSON.parse(readFileSync(path, 'utf-8')) as VoiceBook[];
  cachedMtimeMs = mtimeMs;
  cachedPath = path;
  return [...new Set(cachedVoiceBooks.map((b) => b.package_id))].sort();
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { packageId: string } },
) {
  try {
    const installed = loadInstalledPackageIds();
    if (!installed.includes(params.packageId)) {
      return NextResponse.json(
        { error: 'Unknown package', packageId: params.packageId },
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

    const result = await toggleEnabledVoicePackage(
      params.packageId,
      body.enabled,
      installed,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Failed to update package preference',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
