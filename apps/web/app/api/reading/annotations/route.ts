import { NextRequest, NextResponse } from 'next/server';
import { getAnnotations, createAnnotation } from '../../../../lib/db';

export async function GET(req: NextRequest) {
  try {
    const verseRef = req.nextUrl.searchParams.get('verseRef') || undefined;
    const translation = req.nextUrl.searchParams.get('translation') || undefined;
    return NextResponse.json({ annotations: getAnnotations(verseRef, translation) });
  } catch {
    return NextResponse.json({ annotations: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { verseRef, translation, text } = await req.json();
    if (!verseRef || !translation || text === undefined) {
      return NextResponse.json({ error: 'verseRef, translation and text required' }, { status: 400 });
    }
    return NextResponse.json(createAnnotation(verseRef, translation, String(text)), { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
