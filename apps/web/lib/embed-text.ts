/**
 * embed-text.ts — Server-side text embedding for Resonance.
 *
 * Uses Perplexity pplx-embed-v1-4b via OpenRouter.
 * Returns L2-normalized 2560-dim vectors ready for cosine similarity.
 *
 * Used by:
 *   - /api/embed (direct client embed)
 *   - /api/resonance (server-side embed when no vector provided)
 */

const MODEL = 'perplexity/pplx-embed-v1-4b';
const DIM = 2560;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/embeddings';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const MAX_INPUT_LENGTH = 8000; // truncate long journal entries

export interface EmbedResult {
  vector: number[];
  dim: number;
  model: string;
  cost_usd: number;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

interface OpenRouterEmbeddingResponse {
  data: { embedding: number[]; index: number; object: string }[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number; cost?: number };
  id?: string;
}

async function callOpenRouter(
  text: string,
  apiKey: string,
): Promise<OpenRouterEmbeddingResponse> {
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
      }

      return (await res.json()) as OpenRouterEmbeddingResponse;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = `OpenRouter timeout after ${REQUEST_TIMEOUT_MS}ms`;
      } else if (err instanceof Error) {
        // Hard 4xx — don't retry
        if (attempt === MAX_RETRIES) throw err;
        lastError = err.message;
      } else {
        lastError = String(err);
      }
    }
  }

  throw new Error(lastError ?? 'OpenRouter request failed after retries');
}

/**
 * Embed text into a 2560-dim L2-normalized vector.
 *
 * @param text - Input text (will be truncated to 8000 chars)
 * @param apiKey - OpenRouter API key
 * @returns EmbedResult with normalized vector
 * @throws Error on OpenRouter failure
 */
export async function embedText(
  text: string,
  apiKey: string,
): Promise<EmbedResult> {
  const truncated = text.length > MAX_INPUT_LENGTH ? text.slice(0, MAX_INPUT_LENGTH) : text;

  const result = await callOpenRouter(truncated, apiKey);
  const vec = result.data?.[0]?.embedding;

  if (!vec || vec.length !== DIM) {
    throw new Error('Unexpected embedding shape from provider');
  }

  // L2-normalize — OpenRouter returns [-1,1] but doesn't normalize to unit length.
  // Cosine similarity in the resonance route assumes unit vectors.
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] = vec[i] / norm;
  }

  return {
    vector: vec,
    dim: DIM,
    model: 'pplx-embed-v1-4b',
    cost_usd: result.usage.cost ?? 0,
    usage: {
      prompt_tokens: result.usage.prompt_tokens,
      total_tokens: result.usage.total_tokens,
    },
  };
}
