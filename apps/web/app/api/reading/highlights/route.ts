/**
 * GET /api/reading/highlights — list highlights (optionally filtered by verseRef prefix).
 * POST /api/reading/highlights — create a highlight.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';

export async function GET(req: NextRequest) {
  try {
    const verseRef = req.nextUrl.searchParams.get('verseRef');
    const db = getDb();
    let highlights;
    if (verseRef) {
      highlights = db.prepare('SELECT id, verse_ref, color, created_at FROM highlights WHERE verse_ref LIKE ?').all(verseRef + '%');
    } else {
      highlights = db.prepare('SELECT id, verse_ref, color, created_at FROM highlights').all();
    }
    return NextResponse.json({ highlights });
  } catch {
    return NextResponse.json({ highlights: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { verseRef, color } = await req.json();
    if (!verseRef || !color) {
      return NextResponse.json({ error: 'verseRef and color required' }, { status: 400 });
    }
    const db = getDb();
    // Remove existing highlight for this verse_ref first
    db.prepare('DELETE FROM highlights WHERE verse_ref = ?').run(verseRef);
    const result = db.prepare('INSERT INTO highlights (verse_ref, color) VALUES (?, ?)').run(verseRef, color);
    const highlight = db.prepare('SELECT id, verse_ref, color, created_at FROM highlights WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(highlight, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
