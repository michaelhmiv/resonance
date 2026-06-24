import { NextRequest, NextResponse } from 'next/server';
import { getBookmarks, createBookmark } from '../../../../lib/db';

export async function GET() {
  try {
    return NextResponse.json({ bookmarks: await getBookmarks() });
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
    return NextResponse.json(await createBookmark(verseRef, label || null), { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
