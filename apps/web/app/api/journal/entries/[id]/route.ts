/**
 * PUT /api/journal/entries/[id] — update an entry.
 * DELETE /api/journal/entries/[id] — delete an entry.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../../../../lib/db';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { text } = await req.json();
    const db = getDb();
    db.prepare("UPDATE journal_entries SET text = ?, updated_at = strftime('%s', 'now') WHERE id = ?").run(text, id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
