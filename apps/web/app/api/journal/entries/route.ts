import { NextRequest, NextResponse } from 'next/server';
import {
  getJournalEntries,
  createJournalEntry,
  upsertJournalResonanceNode,
  appendResonanceEvent,
  enqueueResonanceJob,
  precomputeJournalEntryResonance,
} from '../../../../lib/db';

function requestOrigin(req: NextRequest): string {
  const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
  const forwardedHost = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(req.url).origin;
}

export async function GET() {
  try {
    const entries = await getJournalEntries();
    return NextResponse.json({ entries });
  } catch {
    return NextResponse.json({ entries: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { id, text, created_at, updated_at } = await req.json();
    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: 'Text required' }, { status: 400 });
    }
    const entry = await createJournalEntry(
      text.trim(),
      typeof id === 'string' ? id : undefined,
      typeof created_at === 'number' ? created_at : undefined,
      typeof updated_at === 'number' ? updated_at : undefined,
    );
    if (!entry?.id) {
      return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
    }
    const node = await upsertJournalResonanceNode(entry);
    await appendResonanceEvent({
      eventType: 'journal.created',
      sourceNodeId: node.id,
      sourceType: 'journal_entry',
      sourceId: entry.id,
      payload: { entry_id: entry.id },
    });
    const job = await enqueueResonanceJob({
      sourceNodeId: node.id,
      sourceId: entry.id,
      payload: { event: 'journal.created' },
    });
    const resonance = await precomputeJournalEntryResonance({
      entry,
      origin: requestOrigin(req),
    });
    return NextResponse.json({ ...entry, resonance_job_id: job.id, resonance_precomputed: resonance }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
  }
}
