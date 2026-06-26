import { NextRequest, NextResponse } from 'next/server';
import {
  updateJournalEntry,
  deleteJournalEntry,
  upsertJournalResonanceNode,
  markJournalResonanceNodeDeleted,
  appendResonanceEvent,
  enqueueResonanceJob,
} from '../../../../../lib/db';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { text } = await req.json();
    if (!text || String(text).trim().length === 0) {
      return NextResponse.json({ error: 'Text required' }, { status: 400 });
    }
    const updated = await updateJournalEntry(id, String(text).trim());
    const node = await upsertJournalResonanceNode({ id, text: String(text).trim(), updated_at: new Date().toISOString() });
    await appendResonanceEvent({
      eventType: 'journal.updated',
      sourceNodeId: node.id,
      sourceType: 'journal_entry',
      sourceId: id,
      payload: { entry_id: id },
    });
    const job = await enqueueResonanceJob({
      sourceNodeId: node.id,
      sourceId: id,
      payload: { event: 'journal.updated' },
    });
    return NextResponse.json({ ...updated, resonance_job_id: job.id });
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const node = await markJournalResonanceNodeDeleted(id);
    if (node?.id) {
      await appendResonanceEvent({
        eventType: 'journal.deleted',
        sourceNodeId: node.id,
        sourceType: 'journal_entry',
        sourceId: id,
        payload: { entry_id: id },
      });
    }
    return NextResponse.json(await deleteJournalEntry(id));
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
