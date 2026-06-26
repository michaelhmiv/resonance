import { NextRequest, NextResponse } from 'next/server';
import { processNextResonanceJob, runResonanceMaintenance } from '../../../../lib/db';

function requestOrigin(req: NextRequest): string {
  const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
  const forwardedHost = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(req.url).origin;
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.RESONANCE_JOB_SECRET;
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
    const limit = Math.max(1, Math.min(10, Number(body.limit ?? 1)));
    const origin = body.origin && typeof body.origin === 'string' ? body.origin : requestOrigin(req);
    const processed = [];
    for (let i = 0; i < limit; i++) {
      const result = await processNextResonanceJob(origin);
      if (!result) break;
      processed.push(result);
    }
    let maintenance = null;
    if (body.maintenance === true) {
      maintenance = await runResonanceMaintenance();
    }
    return NextResponse.json({ ok: true, processed_count: processed.length, processed, maintenance });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message.slice(0, 500) : String(err) },
      { status: 500 },
    );
  }
}
