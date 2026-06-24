import { NextRequest, NextResponse } from 'next/server';
import { deleteAnnotation } from '../../../../../lib/db';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(deleteAnnotation(id));
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
