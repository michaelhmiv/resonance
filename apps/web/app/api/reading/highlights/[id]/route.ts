import { NextRequest, NextResponse } from 'next/server';
import {
  deleteHighlight,
  updateHighlight,
  storeHighlightEmbedding,
  deleteHighlightEmbedding,
  getHighlights,
} from '../../../../../lib/db';
import { embed } from '../../../../../lib/embed-helper';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const all = await getHighlights();
    const highlight = all.find((h: { id: string }) => h.id === id);
    if (!highlight) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ highlight });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { color, startOffset, endOffset, selectedText, noteText } = body;

    const patch: Record<string, unknown> = {};
    if (color !== undefined) patch.color = color;
    if (startOffset !== undefined) patch.startOffset = startOffset;
    if (endOffset !== undefined) patch.endOffset = endOffset;
    if (selectedText !== undefined) patch.selectedText = selectedText;
    if (noteText !== undefined) patch.noteText = noteText;

    const updated = await updateHighlight(id, patch);

    // Re-embed / clear embedding based on the new note_text
    if (noteText !== undefined) {
      const hasNote = noteText && String(noteText).trim().length >= 3;
      if (hasNote) {
        embed(String(noteText)).then((vector) => {
          if (vector) storeHighlightEmbedding(id, vector).catch(() => {});
        }).catch(() => {});
      } else {
        // Note cleared — drop the embedding
        deleteHighlightEmbedding(id).catch(() => {});
      }
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error('[highlights PATCH] error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return NextResponse.json(await deleteHighlight(id));
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
