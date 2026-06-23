/**
 * GET /api/reading/bookmarks — list all bookmarks.
 * POST /api/reading/bookmarks — create a bookmark.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';

export async function GET() {
  try {
    const db = getDb();
    const bookmarks = db.prepare('SELECT id, verse_ref, label, created_at FROM bookmarks ORDER BY created_at DESC').all();
    return NextResponse.json({ bookmarks });
  } catch {
    return NextResponse.json({ bookmarks: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { verseRef, label } = await req.json();
    if (!verseRef) {
      return NextResponse.json({ error: 'verseRef required' }, { status: 400 });
    }
    const db = getDb();
    const result = db.prepare('INSERT INTO bookmarks (verse_ref, label) VALUES (?, ?)').run(verseRef, label || null);
    const bookmark = db.prepare('SELECT id, verse_ref, label, created_at FROM bookmarks WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(bookmark, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
