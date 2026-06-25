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
import { timingSafeEqual } from 'crypto';

const MODEL = 'perplexity/pplx-embed-v1-4b';
const DIM = 2560;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/embeddings';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

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

// ── OpenRouter call with retry/backoff ─────────────────────────────────────

interface EmbeddingResponse {
  data: { embedding: number[]; index: number; object: string }[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number; cost?: number };
  id?: string;
}

async function callOpenRouter(text: string, apiKey: string): Promise<EmbeddingResponse> {
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://resonance.app',
          'X-Title': 'Resonance',
        },
        body: JSON.stringify({ model: MODEL, input: text }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status === 429 || res.status >= 500) {
        const body = await res.text();
        lastError = `OpenRouter ${res.status}: ${body.slice(0, 200)}`;
        // Exponential backoff: 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        // Don't retry 4xx (except 429) — bad request, auth, etc.
        throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
      }

      return (await res.json()) as EmbeddingResponse;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = `OpenRouter timeout after ${REQUEST_TIMEOUT_MS}ms`;
      } else if (err instanceof Error) {
        throw err; // Hard 4xx — don't retry
      } else {
        lastError = String(err);
      }
    }
  }

  throw new Error(lastError ?? 'OpenRouter request failed after retries');
}

// ── Route handler ──────────────────────────────────────────────────────────

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

    // Truncate very long inputs — pplx-embed-v1-4b has a 32K context but we
    // don't want to ship 30K-token journal entries through a single call.
    const truncated = text.length > 8000 ? text.slice(0, 8000) : text;

    const result = await callOpenRouter(truncated, apiKey);
    const vec = result.data?.[0]?.embedding;

    if (!vec || vec.length !== DIM) {
      return NextResponse.json(
        { error: 'Unexpected embedding shape from provider' },
        { status: 502 },
      );
    }

    // L2-normalize the vector. OpenRouter returns values in [-1, 1] but
    // does NOT normalize the vector to unit length. The resonance route's
    // cosine similarity assumes both sides are unit vectors, so we
    // normalize here at the boundary.
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] = vec[i] / norm;
    }

    return NextResponse.json({
      vector: vec,
      dim: DIM,
      model: 'pplx-embed-v1-4b',
      cost_usd: result.usage.cost ?? 0,
      usage: {
        prompt_tokens: result.usage.prompt_tokens,
        total_tokens: result.usage.total_tokens,
      },
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
