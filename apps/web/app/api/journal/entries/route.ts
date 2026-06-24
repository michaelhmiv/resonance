import { NextRequest, NextResponse } from 'next/server';
import { getJournalEntries, createJournalEntry } from '../../../../lib/db';

export async function GET() {
  try {
    const entries = getJournalEntries();
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
    const entry = createJournalEntry(
      text.trim(),
      typeof id === 'string' ? id : undefined,
      typeof created_at === 'number' ? created_at : undefined,
      typeof updated_at === 'number' ? updated_at : undefined,
    );
    return NextResponse.json(entry, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
  }
}
