/**
 * GET  /api/reading/events  — query reading history for a date range
 * POST /api/reading/events  — record a reading event
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://oeumvgwecqtqqgbyiune.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEV_USER_ID = '00000000-0000-0000-0000-000000000000';

function getClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const start = searchParams.get('start') || '2000-01-01';
    const end = searchParams.get('end') || new Date().toISOString().slice(0, 10);

    const sb = getClient();
    const { data } = await sb
      .from('reading_events')
      .select('created_at')
      .eq('user_id', DEV_USER_ID)
      .gte('created_at', `${start}T00:00:00Z`)
      .lte('created_at', `${end}T23:59:59Z`);

    const byDate = new Map<string, number>();
    for (const row of data || []) {
      const date = String(row.created_at).slice(0, 10);
      byDate.set(date, (byDate.get(date) || 0) + 1);
    }
    const events = Array.from(byDate.entries()).map(([date, count]) => ({ date, count }));

    return NextResponse.json({ events });
  } catch {
    return NextResponse.json({ events: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { bookId, chapter, verseRef, timestamp } = await req.json();
    const sb = getClient();

    await sb.from('reading_events').insert({
      user_id: DEV_USER_ID,
      book_id: bookId || 'unknown',
      chapter: chapter || 0,
      verse_ref: verseRef || '',
      created_at: new Date(timestamp || Date.now()).toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
