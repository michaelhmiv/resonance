/**
 * PUT /api/library/packages/[packageId] — REMOVED.
 *
 * Replaced by PUT /api/library/books/[bookId] (per-book toggle).
 *
 * Returns 410 Gone so any clients still calling it fail loudly.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function PUT(
  _request: NextRequest,
  { params }: { params: { packageId: string } },
) {
  return NextResponse.json(
    {
      error: 'This endpoint has been removed.',
      packageId: params.packageId,
      migration: 'Use PUT /api/library/books/[bookId] for per-book toggle.',
    },
    { status: 410, headers: { 'X-Resonance-Deprecated': 'use /api/library/books/[bookId] instead' } },
  );
}
