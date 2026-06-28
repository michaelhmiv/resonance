import { NextRequest, NextResponse } from 'next/server';
import {
  updateJournalEntry,
  deleteJournalEntry,
  upsertJournalResonanceNode,
  markJournalResonanceNodeDeleted,
  appendResonanceEvent,
  enqueueResonanceJob,
  precomputeJournalEntryResonance,
} from '../../../../../lib/db';

function requestOrigin(req: NextRequest): string {
  const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
  const forwardedHost = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(req.url).origin;
}

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
    const resonance = await precomputeJournalEntryResonance({
      entry: { id, text: String(text).trim(), updated_at: new Date().toISOString() },
      origin: requestOrigin(req),
      force: true,
    });
    return NextResponse.json({ ...updated, resonance_job_id: job.id, resonance_precomputed: resonance });
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
