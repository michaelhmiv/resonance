import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { generateThemeSnapshot, runResonanceMaintenance } from '../../../../lib/db';

export async function GET() {
  try {
    const snapshot = await generateThemeSnapshot({ windowDays: 30 });
    return NextResponse.json({
      themes: snapshot ? [{
        id: snapshot.id,
        label: snapshot.label,
        summary: snapshot.summary,
        confidence: snapshot.confidence,
        evidence: snapshot.evidence,
        status: snapshot.status,
        validFrom: snapshot.valid_from,
        expiresAt: snapshot.expires_at,
      }] : [],
    });
  } catch (err) {
    console.warn('[patterns/themes] failed:', err);
    return NextResponse.json({ themes: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.RESONANCE_JOB_SECRET;
    if (secret) {
      const auth = req.headers.get('authorization');
      const headerSecret = req.headers.get('x-resonance-job-secret');
      if (auth !== `Bearer ${secret}` && headerSecret !== secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      }
    }
    const result = await runResonanceMaintenance();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
