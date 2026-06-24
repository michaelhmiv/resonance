import { NextRequest, NextResponse } from 'next/server';
import { getSettings, setSetting } from '../../../lib/db';

const DEFAULTS: Record<string, string> = {
  translation: 'web',
  fontSize: 'medium',
  theme: 'auto',
  textScale: 'medium',
  reduceMotion: 'off',
  embeddingModel: 'gte-small',
  llmModel: 'deepseek-v4-pro',
};

export async function GET() {
  try {
    const stored = getSettings();
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
    return NextResponse.json(setSetting(key, String(value)));
  } catch {
    return NextResponse.json({ error: 'Failed to save setting' }, { status: 500 });
  }
}
