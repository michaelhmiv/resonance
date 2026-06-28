import { NextRequest, NextResponse } from 'next/server';
import { getJournalEntries, precomputeJournalEntryResonance } from '../../../../lib/db';

function requestOrigin(req: NextRequest): string {
  const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
  const forwardedHost = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(req.url).origin;
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.RESONANCE_JOB_SECRET || process.env.ADMIN_UPLOAD_TOKEN;
  if (!secret) return process.env.NODE_ENV !== 'production';
  const auth = req.headers.get('authorization');
  const headerSecret = req.headers.get('x-resonance-job-secret');
  return auth === `Bearer ${secret}` || headerSecret === secret;
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const force = body.force === true;
    const limit = Math.max(1, Math.min(100, Number(body.limit ?? 100)));
    const origin = typeof body.origin === 'string' && body.origin.length > 0 ? body.origin : requestOrigin(req);

    const entries = await getJournalEntries();
    const selected = entries.slice(0, limit);
    const results = [];
    const failures = [];

    for (const entry of selected) {
      try {
        const result = await precomputeJournalEntryResonance({ entry, origin, force });
        results.push(result);
      } catch (err) {
        failures.push({
          entry_id: entry.id,
          error: err instanceof Error ? err.message.slice(0, 500) : String(err),
        });
      }
    }

    return NextResponse.json({
      ok: failures.length === 0,
      total_entries: entries.length,
      attempted: selected.length,
      stored: results.filter((r) => r.ok).length,
      computed: results.filter((r) => r.ok && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
      failures,
      results,
    }, { status: failures.length === 0 ? 200 : 500 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message.slice(0, 500) : String(err) },
      { status: 500 },
    );
  }
}
