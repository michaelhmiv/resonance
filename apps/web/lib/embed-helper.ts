/**
 * Shared GTE-small embedding helper.
 *
 * Loads the Transformers.js model once (33MB) and provides a
 * simple embed() function for server-side use.
 *
 * Used by /api/embed (journal) and annotation save (notes).
 */

let pipeline: unknown = null;
let modelReady = false;
let loadPromise: Promise<void> | null = null;

const DIM = 384;

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

export async function embed(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (trimmed.length < 3) return null;

  try {
    await Promise.race([
      ensureModel(),
      new Promise<void>((resolve) => setTimeout(resolve, 60000)),
    ]);

    if (!modelReady || !pipeline) return null;

    const result = await (pipeline as (text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>)(
      trimmed,
      { pooling: 'mean', normalize: true },
    );

    if (!result?.data || result.data.length !== DIM) return null;

    return Array.from(result.data);
  } catch {
    return null;
  }
}
