import { NextRequest, NextResponse } from 'next/server';
import { updateJournalEntry, deleteJournalEntry } from '../../../../../lib/db';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { text } = await req.json();
    return NextResponse.json(await updateJournalEntry(id, text));
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
    return NextResponse.json(await deleteJournalEntry(id));
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
