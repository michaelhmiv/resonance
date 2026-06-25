import { NextRequest, NextResponse } from 'next/server';
import {
  getHighlights,
  createHighlight,
  ensureHighlightVectorsTable,
} from '../../../../lib/db';
import { embed } from '../../../../lib/embed-helper';
import { storeHighlightEmbedding, deleteHighlightEmbedding } from '../../../../lib/db';

// Run migration on first import
ensureHighlightVectorsTable().catch(() => {});

export async function GET(req: NextRequest) {
  try {
    const verseRef = req.nextUrl.searchParams.get('verseRef');
    return NextResponse.json({ highlights: await getHighlights(verseRef || undefined) });
  } catch {
    return NextResponse.json({ highlights: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { verseRef, color, startOffset, endOffset, selectedText, noteText } = body;
    if (!verseRef || !color) {
      return NextResponse.json({ error: 'verseRef and color required' }, { status: 400 });
    }
    if (typeof startOffset !== 'number' || typeof endOffset !== 'number' || !selectedText) {
      return NextResponse.json(
        { error: 'startOffset, endOffset, and selectedText are required' },
        { status: 400 },
      );
    }
    const highlight = await createHighlight({
      verseRef,
      color,
      startOffset,
      endOffset,
      selectedText,
      noteText: noteText ?? null,
    });

    // Embed note_text in background (fire-and-forget) — only if a note was provided
    if (highlight?.id && noteText && String(noteText).trim().length >= 3) {
      embed(String(noteText)).then((vector) => {
        if (vector) storeHighlightEmbedding(highlight.id, vector).catch(() => {});
      }).catch(() => {});
    }

    return NextResponse.json(highlight, { status: 201 });
  } catch (err) {
    console.error('[highlights POST] error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
