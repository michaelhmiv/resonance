/**
 * DELETE /api/reading/bookmarks/[id] — remove a bookmark by id
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../../../../lib/db';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getDb();
    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
