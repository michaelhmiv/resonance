/**
 * GET  /api/reading/bookmarks  — list all bookmarks (newest first)
 * POST /api/reading/bookmarks  — create a bookmark { verseRef, label? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '../../../../lib/db';

type BookmarkRow = {
  id: string;
  verse_ref: string;
  label: string | null;
  created_at: number;
};

export async function GET() {
  try {
    const db = getDb();
    const bookmarks = db
      .prepare<unknown[], BookmarkRow>(
        'SELECT id, verse_ref, label, created_at FROM bookmarks ORDER BY created_at DESC',
      )
      .all();
    return NextResponse.json({ bookmarks });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { verseRef, label } = (await req.json()) as {
      verseRef: string;
      label?: string;
    };

    if (!verseRef || verseRef.trim().length === 0) {
      return NextResponse.json({ error: 'verseRef is required' }, { status: 400 });
    }

    const db = getDb();
    const id = generateId();
    const createdAt = Math.floor(Date.now() / 1000);

    db.prepare(
      'INSERT INTO bookmarks (id, verse_ref, label, created_at) VALUES (?, ?, ?, ?)',
    ).run(id, verseRef, label ?? null, createdAt);

    return NextResponse.json({
      id,
      verse_ref: verseRef,
      label: label ?? null,
      created_at: createdAt,
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
