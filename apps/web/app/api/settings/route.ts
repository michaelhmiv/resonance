/**
 * GET /api/settings  — read all settings (with built-in defaults)
 * PUT /api/settings  — upsert a single setting { key, value }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';

type SettingRow = { key: string; value: string };

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
    const rows = db
      .prepare<unknown[], SettingRow>('SELECT key, value FROM settings')
      .all();

    const map: Record<string, string> = { ...DEFAULTS };
    for (const row of rows) {
      map[row.key] = row.value;
    }

    return NextResponse.json({
      translation: map.translation,
      fontSize: map.fontSize,
      theme: map.theme,
      textScale: map.textScale,
      reduceMotion: map.reduceMotion,
      embeddingModel: map.embeddingModel,
      llmModel: map.llmModel,
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { key, value } = (await req.json()) as { key: string; value: string };

    if (!key || value === undefined || value === null) {
      return NextResponse.json({ error: 'key and value are required' }, { status: 400 });
    }

    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      String(key),
      String(value),
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
