import { NextRequest, NextResponse } from 'next/server';
import { updateAnnotation, deleteAnnotation } from '../../../../../lib/db';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { text } = await req.json();
    if (text === undefined) {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }
    return NextResponse.json(await updateAnnotation(id, String(text)));
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(await deleteAnnotation(id));
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
