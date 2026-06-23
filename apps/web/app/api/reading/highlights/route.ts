/**
 * GET  /api/reading/highlights          — list all highlights (newest first)
 * GET  /api/reading/highlights?verseRef=Genesis+1  — filter by verse ref
 * POST /api/reading/highlights          — create a highlight { verseRef, color }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '../../../../lib/db';

type HighlightRow = {
  id: string;
  verse_ref: string;
  color: string;
  created_at: number;
};

export async function GET(req: NextRequest) {
  try {
    const verseRef = req.nextUrl.searchParams.get('verseRef');
    const db = getDb();

    const highlights = verseRef
      ? db
          .prepare<unknown[], HighlightRow>(
            'SELECT id, verse_ref, color, created_at FROM highlights WHERE verse_ref = ? ORDER BY created_at DESC',
          )
          .all(verseRef)
      : db
          .prepare<unknown[], HighlightRow>(
            'SELECT id, verse_ref, color, created_at FROM highlights ORDER BY created_at DESC',
          )
          .all();

    return NextResponse.json({ highlights });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { verseRef, color } = (await req.json()) as {
      verseRef: string;
      color: string;
    };

    if (!verseRef || verseRef.trim().length === 0) {
      return NextResponse.json({ error: 'verseRef is required' }, { status: 400 });
    }
    if (!color || color.trim().length === 0) {
      return NextResponse.json({ error: 'color is required' }, { status: 400 });
    }

    const db = getDb();
    const id = generateId();
    const createdAt = Math.floor(Date.now() / 1000);

    db.prepare(
      'INSERT INTO highlights (id, verse_ref, color, created_at) VALUES (?, ?, ?, ?)',
    ).run(id, verseRef, color, createdAt);

    return NextResponse.json({
      id,
      verse_ref: verseRef,
      color,
      created_at: createdAt,
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
