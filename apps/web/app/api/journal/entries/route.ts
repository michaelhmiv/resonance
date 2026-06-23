/**
 * GET  /api/journal/entries  — list all journal entries (newest first)
 * POST /api/journal/entries  — create a journal entry
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '../../../../lib/db';

type JournalEntryRow = { id: string; text: string; created_at: number };

export async function GET() {
  try {
    const db = getDb();
    const entries = db
      .prepare<unknown[], JournalEntryRow>(
        'SELECT id, text, created_at FROM journal_entries ORDER BY created_at DESC',
      )
      .all();
    return NextResponse.json({ entries });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { text } = (await req.json()) as { text: string };

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const db = getDb();
    const id = generateId();
    const createdAt = Math.floor(Date.now() / 1000);

    db.prepare(
      'INSERT INTO journal_entries (id, text, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(id, text, createdAt, createdAt);

    return NextResponse.json({ id, text, created_at: createdAt });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
