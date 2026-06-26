import { NextRequest, NextResponse } from 'next/server';
import {
  getHighlights,
  createHighlight,
  upsertHighlightResonanceNodes,
  appendResonanceEvent,
  enqueueResonanceJob,
} from '../../../../lib/db';

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

    const { highlightNode, noteNode } = await upsertHighlightResonanceNodes(highlight);
    const event = await appendResonanceEvent({
      eventType: 'highlight.created',
      sourceNodeId: highlightNode.id,
      sourceType: 'highlight',
      sourceId: highlight.id,
      payload: { verseRef, selectedText, hasNote: Boolean(noteNode) },
    });
    const highlightJob = await enqueueResonanceJob({
      jobType: 'highlight_resonance',
      sourceNodeId: highlightNode.id,
      sourceTable: 'highlights',
      sourceId: highlight.id,
      priority: 90,
      payload: { event_id: event.id },
    });
    let noteJob = null;
    if (noteNode) {
      const noteEvent = await appendResonanceEvent({
        eventType: 'note.created',
        sourceNodeId: noteNode.id,
        sourceType: 'note',
        sourceId: `${highlight.id}:note`,
        payload: { highlightId: highlight.id, verseRef },
      });
      noteJob = await enqueueResonanceJob({
        jobType: 'note_resonance',
        sourceNodeId: noteNode.id,
        sourceTable: 'highlights',
        sourceId: `${highlight.id}:note`,
        priority: 85,
        payload: { event_id: noteEvent.id, highlight_id: highlight.id },
      });
    }

    return NextResponse.json({ ...highlight, resonance_job_id: highlightJob.id, note_resonance_job_id: noteJob?.id ?? null }, { status: 201 });
  } catch (err) {
    console.error('[highlights POST] error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
