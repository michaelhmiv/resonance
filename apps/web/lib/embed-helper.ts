/**
 * Shared server-side embedding helper.
 *
 * Calls our own /api/embed endpoint, which in turn calls OpenRouter's
 * Perplexity pplx-embed-v1-4b (2560d). Used for highlight-note embeddings
 * that need to live in the same vector space as the library index.
 *
 * Replaces the old in-process Transformers.js gte-small loader (removed
 * 2026-06 — server now exclusively uses the online 4B model).
 */

const EMBED_URL = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/embed`
  : 'http://localhost:3000/api/embed';
const TIMEOUT_MS = 30_000;

export interface EmbedResponse {
  vector: number[];
  dim: number;
  model: string;
  cost_usd?: number;
}

export async function embed(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (trimmed.length < 3) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as EmbedResponse;
    return data.vector ?? null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}
