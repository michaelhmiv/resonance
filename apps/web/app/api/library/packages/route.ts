/**
 * GET /api/library/packages — REMOVED.
 *
 * Replaced by GET /api/library/books (per-book catalog with per-book
 * opt-in state) and PUT /api/library/books/[bookId] (per-book toggle).
 *
 * This endpoint returns 410 Gone so any clients still calling it fail
 * loudly instead of silently seeing stale data.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(_request: NextRequest) {
  return NextResponse.json(
    {
      error: 'This endpoint has been removed.',
      migration: 'Use GET /api/library/books for the per-book catalog.',
    },
    { status: 410, headers: { 'X-Resonance-Deprecated': 'use /api/library/books instead' } },
  );
}
