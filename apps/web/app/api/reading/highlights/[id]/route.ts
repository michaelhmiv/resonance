import { NextRequest, NextResponse } from 'next/server';
import {
  deleteHighlight,
  updateHighlight,
  getHighlights,
  upsertHighlightResonanceNodes,
  markHighlightResonanceNodesDeleted,
  appendResonanceEvent,
  enqueueResonanceJob,
} from '../../../../../lib/db';

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
    const { highlightNode, noteNode } = await upsertHighlightResonanceNodes(updated);
    const event = await appendResonanceEvent({
      eventType: 'highlight.updated',
      sourceNodeId: highlightNode.id,
      sourceType: 'highlight',
      sourceId: id,
      payload: { fields: Object.keys(patch), hasNote: Boolean(noteNode) },
    });
    const highlightJob = await enqueueResonanceJob({
      jobType: 'highlight_resonance',
      sourceNodeId: highlightNode.id,
      sourceTable: 'highlights',
      sourceId: id,
      priority: 90,
      payload: { event_id: event.id },
    });
    let noteJob = null;
    if (noteText !== undefined) {
      const noteEvent = await appendResonanceEvent({
        eventType: noteNode ? 'note.updated' : 'note.deleted',
        sourceNodeId: noteNode?.id ?? null,
        sourceType: 'note',
        sourceId: `${id}:note`,
        payload: { highlightId: id, hasNote: Boolean(noteNode) },
      });
      if (noteNode) {
        noteJob = await enqueueResonanceJob({
          jobType: 'note_resonance',
          sourceNodeId: noteNode.id,
          sourceTable: 'highlights',
          sourceId: `${id}:note`,
          priority: 85,
          payload: { event_id: noteEvent.id, highlight_id: id },
        });
      }
    }

    return NextResponse.json({ ...updated, resonance_job_id: highlightJob.id, note_resonance_job_id: noteJob?.id ?? null });
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
    const { highlightNode, noteNode } = await markHighlightResonanceNodesDeleted(id);
    await appendResonanceEvent({
      eventType: 'highlight.deleted',
      sourceNodeId: highlightNode?.id ?? null,
      sourceType: 'highlight',
      sourceId: id,
      payload: {},
    });
    if (noteNode) {
      await appendResonanceEvent({
        eventType: 'note.deleted',
        sourceNodeId: noteNode.id,
        sourceType: 'note',
        sourceId: `${id}:note`,
        payload: { highlightId: id },
      });
    }
    return NextResponse.json(await deleteHighlight(id));
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
