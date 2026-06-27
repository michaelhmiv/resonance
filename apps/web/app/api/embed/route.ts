/**
 * POST /api/embed — embed text into a 2560-dim vector using
 * Perplexity's pplx-embed-v1-4b via OpenRouter.
 *
 * Request:  { text: string }
 * Response: { vector: number[], dim: 2560, model: "pplx-embed-v1-4b",
 *             cost_usd: number, usage: { prompt_tokens, total_tokens } }
 *
 * On OpenRouter error: returns 502 with the provider's error message
 * truncated to 300 chars. No fallbacks — every call is billable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { embedText } from '../../../lib/embed-text';
import { timingSafeEqual } from 'crypto';

// ── Auth: the dev session cookie gates the whole app, so this is best-effort.
//    The middleware already blocks anonymous requests before we get here. ──
function authed(req: NextRequest): boolean {
  const authSecret = process.env.RESONANCE_AUTH_SECRET;
  const authCookie = req.cookies.get('resonance-auth');
  if (!authSecret || !authCookie) return true; // middleware handles it
  const a = Buffer.from(authSecret);
  const b = Buffer.from(authCookie.value);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Route handler (uses shared embedText from lib/embed-text.ts) ───────────

export async function POST(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Server misconfigured: OPENROUTER_API_KEY missing' },
      { status: 500 },
    );
  }

  try {
    const { text } = (await req.json()) as { text?: string };

    if (!text || text.trim().length < 3) {
      return NextResponse.json({ error: 'Text too short' }, { status: 400 });
    }

    const result = await embedText(text, apiKey);

    return NextResponse.json({
      vector: result.vector,
      dim: result.dim,
      model: 'pplx-embed-v1-4b',
      cost_usd: result.cost_usd,
      usage: result.usage,
      normalized: true,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Embedding failed',
        detail: err instanceof Error ? err.message.slice(0, 300) : String(err),
      },
      { status: 502 },
    );
  }
}
