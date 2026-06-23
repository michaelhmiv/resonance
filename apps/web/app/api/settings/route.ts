/**
 * GET /api/settings — return all settings with defaults.
 * PUT /api/settings — upsert a setting.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';

const DEFAULTS: Record<string, string> = {
  translation: 'web',
  fontSize: 'medium',
  theme: 'auto',
  textScale: 'medium',
  reduceMotion: 'off',
  embeddingModel: 'gte-small',
  llmModel: 'qwen-2.5-72b',
};

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const settings: Record<string, string> = { ...DEFAULTS };
    for (const r of rows) settings[r.key] = r.value;
    return NextResponse.json(settings);
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
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save setting' }, { status: 500 });
  }
}
