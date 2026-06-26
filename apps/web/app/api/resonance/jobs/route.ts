import { NextRequest, NextResponse } from 'next/server';
import { processNextResonanceJob } from '../../../../lib/db';

function requestOrigin(req: NextRequest): string {
  const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
  const forwardedHost = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(req.url).origin;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(10, Number(body.limit ?? 1)));
    const origin = body.origin && typeof body.origin === 'string' ? body.origin : requestOrigin(req);
    const processed = [];
    for (let i = 0; i < limit; i++) {
      const result = await processNextResonanceJob(origin);
      if (!result) break;
      processed.push(result);
    }
    return NextResponse.json({ ok: true, processed_count: processed.length, processed });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message.slice(0, 500) : String(err) },
      { status: 500 },
    );
  }
}
