/**
 * PUT    /api/journal/entries/[id]  — update an entry's text (bumps updated_at)
 * DELETE /api/journal/entries/[id]  — remove an entry
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../../../../lib/db';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { text } = (await req.json()) as { text: string };

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const db = getDb();
    db.prepare(
      "UPDATE journal_entries SET text = ?, updated_at = strftime('%s','now') WHERE id = ?",
    ).run(text, id);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getDb();
    db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
