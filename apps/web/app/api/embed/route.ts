/**
 * POST /api/embed — embed journal text into a vector.
 *
 * Uses a lightweight hash-based embedding (deterministic, no external API)
 * that produces a 384-dim vector compatible with the pre-computed library
 * vectors. This is intentionally simple — it's only for the user's journal
 * text (a few calls per day). Production should swap this for a real
 * embedding model API call.
 */

import { NextRequest, NextResponse } from 'next/server';

const DIM = 384;

export async function POST(req: NextRequest) {
  try {
    const { text } = (await req.json()) as { text: string };

    if (!text || text.trim().length < 12) {
      return NextResponse.json({ error: 'Text too short' }, { status: 400 });
    }

    const vector = hashEmbed(text.trim(), DIM);
    return NextResponse.json({ vector, dim: DIM });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * Deterministic hash-based embedding. Produces a 384-dim L2-normalized
 * vector from text. Not semantically meaningful like a real model, but
 * gives stable vectors for development/testing.
 */
function hashEmbed(text: string, dim: number): number[] {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const vec = new Array(dim).fill(0);

  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % dim;
    vec[idx] += 1;
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vec[i] /= norm;
  }

  return vec;
}
