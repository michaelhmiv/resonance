/**
 * GET /api/journal/entries — list all journal entries.
 * POST /api/journal/entries — create a new entry.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';

export async function GET() {
  try {
    const db = getDb();
    const entries = db.prepare('SELECT id, text, created_at FROM journal_entries ORDER BY created_at DESC').all();
    return NextResponse.json({ entries });
  } catch {
    return NextResponse.json({ entries: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: 'Text required' }, { status: 400 });
    }
    const db = getDb();
    const result = db.prepare('INSERT INTO journal_entries (text) VALUES (?)').run(text.trim());
    const entry = db.prepare('SELECT id, text, created_at FROM journal_entries WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(entry, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
  }
}
