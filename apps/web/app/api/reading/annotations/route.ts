import { NextRequest, NextResponse } from 'next/server';
import { getAnnotations, createAnnotation, storeAnnotationEmbedding } from '../../../../lib/db';
import { embed } from '../../../../lib/embed-helper';

export async function GET(req: NextRequest) {
  try {
    const verseRef = req.nextUrl.searchParams.get('verseRef') || undefined;
    const translation = req.nextUrl.searchParams.get('translation') || undefined;
    return NextResponse.json({ annotations: await getAnnotations(verseRef, translation) });
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
    const annotation = await createAnnotation(verseRef, translation, String(text));

    // Embed annotation text in background (fire-and-forget — don't block response)
    if (annotation?.id && String(text).trim().length >= 3) {
      embed(String(text)).then((vector) => {
        if (vector) storeAnnotationEmbedding(annotation.id, vector).catch(() => {});
      }).catch(() => {});
    }

    return NextResponse.json(annotation, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
