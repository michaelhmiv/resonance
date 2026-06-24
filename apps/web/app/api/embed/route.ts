/**
 * POST /api/embed — embed journal text into a 384-dim vector
 * using GTE-small via Transformers.js.
 *
 * The model is loaded once at module level (~33 MB download from
 * HuggingFace on first request). Subsequent calls are fast.
 */

import { NextRequest, NextResponse } from 'next/server';

const DIM = 384;

// ── Singleton model loader ────────────────────────────────────────────────

let pipeline: unknown = null;
let modelReady = false;
let loadPromise: Promise<void> | null = null;

async function ensureModel(): Promise<void> {
  if (modelReady) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const { pipeline: createPipeline } = await import('@xenova/transformers');
    pipeline = await createPipeline('feature-extraction', 'Xenova/gte-small');
    modelReady = true;
  })();

  return loadPromise;
}

// ── Route handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { text } = (await req.json()) as { text: string };

    if (!text || text.trim().length < 3) {
      return NextResponse.json({ error: 'Text too short' }, { status: 400 });
    }

    // Start or wait for model loading (first call downloads ~33 MB)
    await Promise.race([
      ensureModel(),
      new Promise<void>((resolve) => setTimeout(resolve, 60000)),
    ]);

    if (!modelReady || !pipeline) {
      return NextResponse.json(
        { error: 'Embedding model still loading', retryAfter: 30 },
        { status: 503 },
      );
    }

    const result = await (pipeline as (text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>)(
      text.trim(),
      { pooling: 'mean', normalize: true },
    );

    if (!result?.data || result.data.length !== DIM) {
      return NextResponse.json(
        { error: 'Embedding produced unexpected output' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      vector: Array.from(result.data),
      dim: DIM,
      model: 'gte-small',
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Internal error',
        detail:
          err instanceof Error ? err.message.slice(0, 300) : String(err),
      },
      { status: 500 },
    );
  }
}
