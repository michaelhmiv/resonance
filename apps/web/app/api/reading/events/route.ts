/**
 * GET  /api/reading/events  — query reading history for a date range
 * POST /api/reading/events  — record a reading event
 *
 * Gracefully handles missing table — returns empty results rather than 500.
 */

import { NextRequest, NextResponse } from 'next/server';

// Re-use the same singleton pattern as lib/db.ts
let _supabase: any = null;
function getClient(): any {
  if (!_supabase) {
    const { createClient } = require('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://oeumvgwecqtqqgbyiune.supabase.co';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    _supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _supabase;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const start = searchParams.get('start') || '2000-01-01';
    const end = searchParams.get('end') || new Date().toISOString().slice(0, 10);

    const sb = getClient();
    const { data, error } = await sb
      .from('reading_events')
      .select('created_at')
      .eq('user_id', '00000000-0000-0000-0000-000000000000')
      .gte('created_at', `${start}T00:00:00Z`)
      .lte('created_at', `${end}T23:59:59Z`);

    if (error) {
      // Table likely doesn't exist — return empty gracefully
      console.warn('[reading-events] query error:', error.message);
      return NextResponse.json({ events: [] });
    }

    const byDate = new Map<string, number>();
    for (const row of data || []) {
      const date = String(row.created_at).slice(0, 10);
      byDate.set(date, (byDate.get(date) || 0) + 1);
    }
    const events = Array.from(byDate.entries()).map(([date, count]) => ({ date, count }));

    return NextResponse.json({ events });
  } catch (err: any) {
    return NextResponse.json({ events: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { bookId, chapter, verseRef, timestamp } = await req.json();
    const sb = getClient();

    const { error } = await sb.from('reading_events').insert({
      user_id: '00000000-0000-0000-0000-000000000000',
      book_id: bookId || 'unknown',
      chapter: chapter || 0,
      verse_ref: verseRef || '',
      created_at: new Date(timestamp || Date.now()).toISOString(),
    });

    if (error) {
      // Table likely doesn't exist — silently accept
      console.warn('[reading-events] insert error:', error.message);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // Graceful fallback
  }
}
