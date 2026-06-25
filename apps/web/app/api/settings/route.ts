/**
 * GET/PUT /api/settings — user preferences
 *
 * The embedding model is no longer a user setting — the server uses a
 * single online model (pplx-embed-v1-4b) for journal/library resonance.
 * The mobile app picks its on-device highlight model separately.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSettings, setSetting } from '../../../lib/db';

const DEFAULTS: Record<string, string> = {
  translation: 'web',
  fontSize: 'medium',
  theme: 'auto',
  textScale: 'medium',
  reduceMotion: 'off',
  llmModel: 'deepseek-v4-pro',
};

export async function GET() {
  try {
    const stored = await getSettings();
    return NextResponse.json({ ...DEFAULTS, ...stored });
  } catch {
    return NextResponse.json(DEFAULTS);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { key, value } = await req.json();
    if (!key || value === undefined) {
      return NextResponse.json({ error: 'key and value required' }, { status: 400 });
    }
    // Block writes to legacy embeddingModel key — it's no longer user-controlled
    if (key === 'embeddingModel') {
      return NextResponse.json({ ok: true, note: 'embeddingModel is now server-managed' });
    }
    return NextResponse.json(await setSetting(key, String(value)));
  } catch {
    return NextResponse.json({ error: 'Failed to save setting' }, { status: 500 });
  }
}
