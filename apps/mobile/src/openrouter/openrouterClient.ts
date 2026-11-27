/**
 * OpenRouter Unified API Client — Embeddings (text, contextual, multimodal),
 * Reranking, Speech-to-Text Transcription, Vision/Video Factual Memory Indexing,
 * Scanned PDF OCR, Key Verification, and Live Model Catalog Discovery.
 *
 * Respects Zero Data Retention (`provider: { data_collection: 'deny' }`) by
 * default, logs local token/cost usage, handles 401/402/429 gracefully, and
 * enforces strictly factual, non-preaching prompts aligned with `principles.md`.
 */

import {
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_RERANKER_MODEL,
  DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL,
  DEFAULT_OPENROUTER_VISION_MODEL,
  QWEN3_RERANKER_INSTRUCTION,
  estimateTokenCostUsd,
  getPreferredOpenRouterEmbedDim,
  l2Normalize,
  modelSupportsContextualEmbeddings,
  modelSupportsInputType,
  type OpenRouterKeyStatus,
  type OpenRouterModelCatalogEntry,
  type OpenRouterTaskKind,
} from '@resonance/core';
import { useOpenRouterStore } from './openrouterStore';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export type OpenRouterErrorCode =
  | 'missing_key'
  | 'unauthorized'
  | 'insufficient_credits'
  | 'rate_limited'
  | 'bad_request'
  | 'network'
  | 'unknown';

export class OpenRouterApiError extends Error {
  status: number;
  code: OpenRouterErrorCode;

  constructor(message: string, status: number, code: OpenRouterErrorCode) {
    super(message);
    this.name = 'OpenRouterApiError';
    this.status = status;
    this.code = code;
  }
}

// ── Curated Recommended Catalogs (fallback + pinned top picks) ──────────────

export const RECOMMENDED_EMBEDDING_MODELS: readonly OpenRouterModelCatalogEntry[] = [
  {
    id: 'mongodb/voyage-4-large',
    name: 'Voyage 4 Large',
    description: 'Frontier retrieval · Same 512d vector space as on-device Voyage-4-Nano (zero re-embed)',
    contextLength: 32000,
    promptPricePerMillion: 0.12,
    completionPricePerMillion: 0,
    supportsImageInput: false,
    supportsVideoInput: false,
    supportsAudioInput: false,
    recommended: true,
    badge: 'Zero Re-embed',
  },
  {
    id: 'mongodb/voyage-4',
    name: 'Voyage 4',
    description: 'Balanced Voyage-4 · Same 512d vector space (zero re-embed)',
    contextLength: 32000,
    promptPricePerMillion: 0.06,
    completionPricePerMillion: 0,
    supportsImageInput: false,
    supportsVideoInput: false,
    supportsAudioInput: false,
    recommended: true,
    badge: 'Zero Re-embed',
  },
  {
    id: 'mongodb/voyage-4-lite',
    name: 'Voyage 4 Lite',
    description: 'Fast & ultra-cheap Voyage-4 · Same 512d vector space (zero re-embed)',
    contextLength: 32000,
    promptPricePerMillion: 0.02,
    completionPricePerMillion: 0,
    supportsImageInput: false,
    supportsVideoInput: false,
    supportsAudioInput: false,
    recommended: true,
    badge: 'Zero Re-embed',
  },
  {
    id: 'qwen/qwen3-embedding-8b',
    name: 'Qwen3 Embedding 8B',
    description: 'Ultra-cheap 8B instruction-aware embeddings (requires library re-embed)',
    contextLength: 32768,
    promptPricePerMillion: 0.01,
    completionPricePerMillion: 0,
    supportsImageInput: false,
    supportsVideoInput: false,
    supportsAudioInput: false,
    recommended: true,
    badge: 'Best Value',
  },
  {
    id: 'cohere/embed-5-pro',
    name: 'Cohere Embed 5 Pro',
    description: 'Top-tier multimodal (text + photos in one vector space · requires re-embed)',
    contextLength: 128000,
    promptPricePerMillion: 0.12,
    completionPricePerMillion: 0,
    supportsImageInput: true,
    supportsVideoInput: false,
    supportsAudioInput: false,
    recommended: true,
    badge: 'Multimodal',
  },
  {
    id: 'perplexity/pplx-embed-v2-context-9b',
    name: 'Perplexity Embed V2 Context 9B',
    description: 'Chapter-aware contextual + multimodal embeddings (requires re-embed)',
    contextLength: 32000,
    promptPricePerMillion: 0.12,
    completionPricePerMillion: 0,
    supportsImageInput: true,
    supportsVideoInput: false,
    supportsAudioInput: false,
    supportsContextualEmbeddings: true,
    recommended: true,
    badge: 'Contextual + Image',
  },
  {
    id: 'google/gemini-embedding-2-preview',
    name: 'Gemini Embedding 2',
    description: 'Google multimodal text + image embeddings (requires re-embed)',
    contextLength: 8192,
    promptPricePerMillion: 0.2,
    completionPricePerMillion: 0,
    supportsImageInput: true,
    supportsVideoInput: false,
    supportsAudioInput: false,
    recommended: true,
    badge: 'Multimodal',
  },
  {
    id: 'openai/text-embedding-3-large',
    name: 'OpenAI Text Embedding 3 Large',
    description: 'General-purpose English & multilingual embeddings (requires re-embed)',
    contextLength: 8192,
    promptPricePerMillion: 0.13,
    completionPricePerMillion: 0,
    supportsImageInput: false,
    supportsVideoInput: false,
    supportsAudioInput: false,
    recommended: false,
  },
];

export const RECOMMENDED_RERANKER_MODELS: readonly OpenRouterModelCatalogEntry[] = [
  {
    id: 'qwen/qwen3-reranker-8b',
    name: 'Qwen3 Reranker 8B',
    description: '13x larger than local Qwen3-0.6B · Instruction-aware pastoral reranking',
    contextLength: 32768,
    promptPricePerMillion: 0.2,
    completionPricePerMillion: 0,
    supportsImageInput: false,
    supportsVideoInput: false,
    supportsAudioInput: false,
    recommended: true,
    badge: 'Default',
  },
  {
    id: 'mongodb/rerank-2.5-lite',
    name: 'Voyage Rerank 2.5 Lite',
    description: 'Low-latency, instruction-following reranker from Voyage AI',
    contextLength: 32000,
    promptPricePerMillion: 0.05,
    completionPricePerMillion: 0,
    supportsImageInput: false,
    supportsVideoInput: false,
    supportsAudioInput: false,
    recommended: true,
    badge: 'Fast',
  },
  {
    id: 'cohere/rerank-4-pro',
    name: 'Cohere Rerank 4 Pro',
    description: 'High-precision enterprise reranker',
    contextLength: 32000,
    promptPricePerMillion: 0.25,
    completionPricePerMillion: 0,
    supportsImageInput: false,
    supportsVideoInput: false,
    supportsAudioInput: false,
    recommended: true,
  },
  {
    id: 'qwen/qwen3-reranker-0.6b',
    name: 'Qwen3 Reranker 0.6B',
    description: 'Cloud mirror of the compact on-device Qwen3 reranker',
    contextLength: 32768,
    promptPricePerMillion: 0.2,
    completionPricePerMillion: 0,
    supportsImageInput: false,
    supportsVideoInput: false,
    supportsAudioInput: false,
    recommended: false,
  },
];

export const RECOMMENDED_TRANSCRIPTION_MODELS: readonly OpenRouterModelCatalogEntry[] = [
  {
    id: 'openai/whisper-large-v3-turbo',
    name: 'Whisper Large V3 Turbo',
    description: 'Fast, accurate multilingual speech-to-text for voice diary notes',
    promptPricePerMillion: 0.04,
    completionPricePerMillion: 0,
    supportsImageInput: false,
    supportsVideoInput: false,
    supportsAudioInput: true,
    recommended: true,
    badge: 'Default',
  },
  {
    id: 'openai/gpt-4o-mini-transcribe',
    name: 'GPT-4o Mini Transcribe',
    description: 'Clean punctuation & natural speech transcription',
    promptPricePerMillion: 0.15,
    completionPricePerMillion: 0,
    supportsImageInput: false,
    supportsVideoInput: false,
    supportsAudioInput: true,
    recommended: true,
  },
  {
    id: 'openai/gpt-4o-transcribe',
    name: 'GPT-4o Transcribe',
    description: 'Highest accuracy for quiet or noisy recordings',
    promptPricePerMillion: 0.3,
    completionPricePerMillion: 0,
    supportsImageInput: false,
    supportsVideoInput: false,
    supportsAudioInput: true,
    recommended: false,
  },
];

export const RECOMMENDED_VISION_MODELS: readonly OpenRouterModelCatalogEntry[] = [
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Fast, low-cost photo, handwritten OCR, and direct short-video indexing',
    contextLength: 1000000,
    promptPricePerMillion: 0.15,
    completionPricePerMillion: 0.6,
    supportsImageInput: true,
    supportsVideoInput: true,
    supportsAudioInput: true,
    recommended: true,
    badge: 'Image + Video',
  },
  {
    id: 'google/gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    description: 'Ultra-budget photo, OCR, and video indexing',
    contextLength: 1000000,
    promptPricePerMillion: 0.075,
    completionPricePerMillion: 0.3,
    supportsImageInput: true,
    supportsVideoInput: true,
    supportsAudioInput: true,
    recommended: true,
    badge: 'Budget',
  },
  {
    id: 'openai/gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    description: 'Crisp handwritten OCR and photo descriptions (uses keyframes for video)',
    contextLength: 1000000,
    promptPricePerMillion: 0.4,
    completionPricePerMillion: 1.6,
    supportsImageInput: true,
    supportsVideoInput: false,
    supportsAudioInput: false,
    recommended: true,
  },
  {
    id: 'anthropic/claude-3.5-haiku',
    name: 'Claude 3.5 Haiku',
    description: 'Careful, restrained photo & handwritten page transcription',
    contextLength: 200000,
    promptPricePerMillion: 0.8,
    completionPricePerMillion: 4.0,
    supportsImageInput: true,
    supportsVideoInput: false,
    supportsAudioInput: false,
    recommended: false,
  },
];

// Price cache keyed by model ID (populated when catalog loads)
const priceCache = new Map<string, { prompt: number; completion: number }>();
for (const list of [
  RECOMMENDED_EMBEDDING_MODELS,
  RECOMMENDED_RERANKER_MODELS,
  RECOMMENDED_TRANSCRIPTION_MODELS,
  RECOMMENDED_VISION_MODELS,
]) {
  for (const m of list) {
    priceCache.set(m.id, {
      prompt: m.promptPricePerMillion,
      completion: m.completionPricePerMillion,
    });
  }
}

export function getKnownModelPricing(modelId: string): {
  prompt: number;
  completion: number;
} {
  return priceCache.get(modelId) ?? { prompt: 0.1, completion: 0.3 };
}

// ── Core HTTP helper with ZDR + 401/402/429 handling ────────────────────────

function buildHeaders(apiKey: string, contentType = 'application/json'): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://resonance.app',
    'X-Title': 'Resonance',
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

function getProviderRouting(): { data_collection: 'deny' } | undefined {
  return useOpenRouterStore.getState().zeroDataRetention
    ? { data_collection: 'deny' }
    : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openRouterFetch<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
    apiKeyOverride?: string;
    maxRetries?: number;
  } = {}
): Promise<T> {
  const apiKey = options.apiKeyOverride ?? useOpenRouterStore.getState().apiKey;
  if (!apiKey) {
    throw new OpenRouterApiError(
      'No OpenRouter API key configured.',
      401,
      'missing_key'
    );
  }

  const method = options.method ?? 'POST';
  const maxRetries = options.maxRetries ?? 2;
  const payload =
    options.body && method === 'POST'
      ? {
          ...options.body,
          ...(getProviderRouting() && !('provider' in options.body)
            ? { provider: getProviderRouting() }
            : {}),
        }
      : undefined;

  let attempt = 0;
  while (true) {
    let resp: Response;
    try {
      resp = await fetch(`${OPENROUTER_BASE}${path}`, {
        method,
        headers: buildHeaders(apiKey, method === 'POST' ? 'application/json' : ''),
        body: payload ? JSON.stringify(payload) : undefined,
      });
    } catch (err) {
      if (attempt < maxRetries) {
        attempt++;
        await sleep(500 * attempt);
        continue;
      }
      throw new OpenRouterApiError(
        err instanceof Error ? err.message : 'Network error reaching OpenRouter.',
        0,
        'network'
      );
    }

    if (resp.ok) {
      return (await resp.json()) as T;
    }

    let detail = `HTTP ${resp.status}`;
    try {
      const errJson = (await resp.json()) as {
        error?: { message?: string } | string;
        message?: string;
      };
      if (typeof errJson?.error === 'string') detail = errJson.error;
      else if (errJson?.error?.message) detail = errJson.error.message;
      else if (errJson?.message) detail = errJson.message;
    } catch {
      // keep status text
    }

    if (resp.status === 401 || resp.status === 403) {
      useOpenRouterStore.getState().setLastError(`OpenRouter key rejected: ${detail}`);
      throw new OpenRouterApiError(detail, resp.status, 'unauthorized');
    }

    if (resp.status === 402) {
      const msg =
        'OpenRouter credits exhausted (HTTP 402). Add credits on OpenRouter, then resume.';
      useOpenRouterStore.getState().setCreditsExhausted(true, msg);
      throw new OpenRouterApiError(msg, 402, 'insufficient_credits');
    }

    if ((resp.status === 429 || resp.status === 529 || resp.status >= 500) && attempt < maxRetries) {
      attempt++;
      const backoff = 700 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
      await sleep(backoff);
      continue;
    }

    if (resp.status === 404 && useOpenRouterStore.getState().zeroDataRetention && /data policy|zero data|endpoints/i.test(detail)) {
      const msg = `${detail} — try disabling "Zero Data Retention" in Settings → OpenRouter or choose another model.`;
      useOpenRouterStore.getState().setLastError(msg);
      throw new OpenRouterApiError(msg, 404, 'bad_request');
    }

    const code: OpenRouterErrorCode =
      resp.status === 429
        ? 'rate_limited'
        : resp.status === 400
          ? 'bad_request'
          : 'unknown';
    throw new OpenRouterApiError(detail, resp.status, code);
  }
}

async function logUsage(
  taskKind: OpenRouterTaskKind,
  modelId: string,
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  }
): Promise<void> {
  const promptTokens = usage?.prompt_tokens ?? usage?.total_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const pricing = getKnownModelPricing(modelId);
  const estimatedCostUsd =
    typeof usage?.cost === 'number' && Number.isFinite(usage.cost)
      ? usage.cost
      : estimateTokenCostUsd(promptTokens, pricing.prompt) +
        estimateTokenCostUsd(completionTokens, pricing.completion);
  await useOpenRouterStore.getState().recordUsage({
    taskKind,
    modelId,
    promptTokens,
    completionTokens,
    estimatedCostUsd,
  });
}

// ── 1. Key Verification ─────────────────────────────────────────────────────

export async function verifyOpenRouterKey(apiKey?: string): Promise<OpenRouterKeyStatus> {
  const key = (apiKey ?? useOpenRouterStore.getState().apiKey ?? '').trim();
  if (!key) {
    return {
      valid: false,
      label: null,
      limitUsd: null,
      limitRemainingUsd: null,
      usageUsd: null,
      isFreeTier: false,
      checkedAt: Date.now(),
      error: 'No API key entered.',
    };
  }
  try {
    const res = await openRouterFetch<{
      data?: {
        label?: string;
        limit?: number | null;
        limit_remaining?: number | null;
        usage?: number | null;
        is_free_tier?: boolean;
      };
    }>('/key', { method: 'GET', apiKeyOverride: key, maxRetries: 1 });

    const d = res.data ?? {};
    const status: OpenRouterKeyStatus = {
      valid: true,
      label: d.label ?? null,
      limitUsd: typeof d.limit === 'number' ? d.limit : null,
      limitRemainingUsd:
        typeof d.limit_remaining === 'number' ? d.limit_remaining : null,
      usageUsd: typeof d.usage === 'number' ? d.usage : null,
      isFreeTier: Boolean(d.is_free_tier),
      checkedAt: Date.now(),
      error: null,
    };
    useOpenRouterStore.getState().setKeyStatus(status);
    return status;
  } catch (err) {
    const status: OpenRouterKeyStatus = {
      valid: false,
      label: null,
      limitUsd: null,
      limitRemainingUsd: null,
      usageUsd: null,
      isFreeTier: false,
      checkedAt: Date.now(),
      error: err instanceof Error ? err.message : 'Key verification failed.',
    };
    useOpenRouterStore.getState().setKeyStatus(status);
    return status;
  }
}

// ── 2. Live Model Catalog Discovery ─────────────────────────────────────────

interface RawOpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  endpoints?: string[];
}

function parsePerMillion(v: string | number | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 1_000_000 * 10000) / 10000;
}

function mapRawCatalogModel(
  raw: RawOpenRouterModel,
  recommendedMap: Map<string, OpenRouterModelCatalogEntry>
): OpenRouterModelCatalogEntry {
  const rec = recommendedMap.get(raw.id);
  const inMods = raw.architecture?.input_modalities ?? [];
  const modality = (raw.architecture?.modality ?? '').toLowerCase();
  const promptPrice = parsePerMillion(raw.pricing?.prompt) || rec?.promptPricePerMillion || 0;
  const completionPrice =
    parsePerMillion(raw.pricing?.completion) || rec?.completionPricePerMillion || 0;

  priceCache.set(raw.id, { prompt: promptPrice, completion: completionPrice });

  return {
    id: raw.id,
    name: rec?.name ?? raw.name ?? raw.id,
    description: rec?.description ?? raw.description,
    contextLength: raw.context_length ?? rec?.contextLength,
    promptPricePerMillion: promptPrice,
    completionPricePerMillion: completionPrice,
    supportsImageInput:
      inMods.includes('image') || modality.includes('image') || Boolean(rec?.supportsImageInput),
    supportsVideoInput:
      inMods.includes('video') || modality.includes('video') || Boolean(rec?.supportsVideoInput),
    supportsAudioInput:
      inMods.includes('audio') || modality.includes('audio') || Boolean(rec?.supportsAudioInput),
    supportsContextualEmbeddings:
      modelSupportsContextualEmbeddings(raw.id) || rec?.supportsContextualEmbeddings,
    recommended: rec?.recommended ?? false,
    badge: rec?.badge,
  };
}

function mergeWithRecommended(
  live: OpenRouterModelCatalogEntry[],
  recommended: readonly OpenRouterModelCatalogEntry[]
): OpenRouterModelCatalogEntry[] {
  const byId = new Map<string, OpenRouterModelCatalogEntry>();
  for (const r of recommended) byId.set(r.id, r);
  for (const item of live) {
    byId.set(item.id, item);
  }
  const all = Array.from(byId.values());
  const recOrder = new Map(recommended.map((m, i) => [m.id, i]));
  all.sort((a, b) => {
    const ra = recOrder.has(a.id) ? recOrder.get(a.id)! : 9999;
    const rb = recOrder.has(b.id) ? recOrder.get(b.id)! : 9999;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
  return all;
}

export async function fetchOpenRouterCatalog(
  slot: 'embedding' | 'reranker' | 'transcription' | 'vision'
): Promise<OpenRouterModelCatalogEntry[]> {
  const recommended =
    slot === 'embedding'
      ? RECOMMENDED_EMBEDDING_MODELS
      : slot === 'reranker'
        ? RECOMMENDED_RERANKER_MODELS
        : slot === 'transcription'
          ? RECOMMENDED_TRANSCRIPTION_MODELS
          : RECOMMENDED_VISION_MODELS;
  const recMap = new Map(recommended.map((m) => [m.id, m]));

  try {
    const endpoint =
      slot === 'embedding'
        ? '/embeddings/models'
        : slot === 'reranker'
          ? '/models?endpoints=/api/v1/rerank'
          : slot === 'transcription'
            ? '/models?endpoints=/api/v1/audio/transcriptions'
            : '/models';
    const resp = await fetch(`${OPENROUTER_BASE}${endpoint}`, {
      method: 'GET',
      headers: {
        'HTTP-Referer': 'https://resonance.app',
        'X-Title': 'Resonance',
      },
    });
    if (!resp.ok) return [...recommended];
    const json = (await resp.json()) as { data?: RawOpenRouterModel[] };
    const rows = Array.isArray(json.data) ? json.data : [];

    const filtered = rows.filter((m) => {
      const idLower = m.id.toLowerCase();
      const outMods = m.architecture?.output_modalities ?? [];
      const inMods = m.architecture?.input_modalities ?? [];
      if (slot === 'embedding' || slot === 'reranker' || slot === 'transcription') {
        return true;
      }
      // vision / video
      return (
        inMods.includes('image') &&
        (outMods.includes('text') || outMods.length === 0) &&
        !idLower.includes('embed')
      );
    });

    const mapped = filtered.map((r) => mapRawCatalogModel(r, recMap));
    return mergeWithRecommended(mapped, recommended);
  } catch {
    return [...recommended];
  }
}

// ── 3. Cloud Embeddings (`POST /api/v1/embeddings`) ─────────────────────────

interface OpenRouterEmbeddingResponse {
  data?: Array<{
    index: number;
    embedding: number[];
    document_index?: number;
  }>;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
}

/**
 * Embed one or more texts via OpenRouter. Automatically applies model-specific
 * `dimensions`, `input_type`, Qwen3 query instructions, and L2 normalization.
 */
export async function embedTextsViaOpenRouter(
  texts: string[],
  options: {
    modelId?: string;
    inputType: 'query' | 'document';
    contextualDocumentChunks?: boolean;
  }
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const modelId = options.modelId ?? useOpenRouterStore.getState().embeddingModel ?? DEFAULT_OPENROUTER_EMBEDDING_MODEL;
  const normId = modelId.toLowerCase();

  // Apply Qwen3 query instruction for significantly better retrieval quality
  const preparedTexts = texts.map((t) => {
    const trimmed = t.trim();
    if (options.inputType === 'query' && normId.includes('qwen3-embedding')) {
      return `Instruct: Given a personal journal reflection or question, retrieve faithfully resonant Scripture passages, Christian writings, or personal diary memories.\nQuery: ${trimmed}`;
    }
    return trimmed;
  });

  const isContextualDoc =
    options.contextualDocumentChunks &&
    options.inputType === 'document' &&
    modelSupportsContextualEmbeddings(modelId);

  const body: Record<string, unknown> = {
    model: modelId,
    input: isContextualDoc ? [preparedTexts] : preparedTexts,
    encoding_format: 'float',
  };

  const preferredDim = getPreferredOpenRouterEmbedDim(modelId);
  if (preferredDim) {
    body.dimensions = preferredDim;
  }
  if (modelSupportsInputType(modelId)) {
    body.input_type = options.inputType;
  }

  let res: OpenRouterEmbeddingResponse;
  try {
    res = await openRouterFetch<OpenRouterEmbeddingResponse>('/embeddings', {
      method: 'POST',
      body,
    });
  } catch (err) {
    // Graceful retry without optional `dimensions` or `input_type` if a custom provider rejects them
    if (err instanceof OpenRouterApiError && err.status === 400) {
      const fallbackBody: Record<string, unknown> = {
        model: modelId,
        input: preparedTexts,
        encoding_format: 'float',
      };
      res = await openRouterFetch<OpenRouterEmbeddingResponse>('/embeddings', {
        method: 'POST',
        body: fallbackBody,
      });
    } else {
      throw err;
    }
  }

  await logUsage('embedding', modelId, res.usage);

  const items = [...(res.data ?? [])].sort((a, b) => a.index - b.index);
  return items.map((item) => l2Normalize(new Float32Array(item.embedding)));
}

/**
 * Direct multimodal embedding (`image_url` + optional text) for multimodal
 * OpenRouter embedding models (`cohere/embed-5-pro`, `gemini-embedding-2-preview`,
 * `pplx-embed-v2-context-9b`, `voyage-multimodal-3.5`).
 */
export async function embedMultimodalViaOpenRouter(params: {
  imageDataUri: string;
  text?: string | null;
  modelId?: string;
}): Promise<Float32Array | null> {
  const modelId = params.modelId ?? useOpenRouterStore.getState().embeddingModel;
  const content: Array<Record<string, unknown>> = [];
  if (params.text && params.text.trim().length > 0) {
    content.push({ type: 'text', text: params.text.trim() });
  }
  content.push({
    type: 'image_url',
    image_url: { url: params.imageDataUri },
  });

  const body: Record<string, unknown> = {
    model: modelId,
    input: [{ content }],
    encoding_format: 'float',
  };
  const preferredDim = getPreferredOpenRouterEmbedDim(modelId);
  if (preferredDim) body.dimensions = preferredDim;
  if (modelSupportsInputType(modelId)) body.input_type = 'document';

  const res = await openRouterFetch<OpenRouterEmbeddingResponse>('/embeddings', {
    method: 'POST',
    body,
  });
  await logUsage('embedding', modelId, res.usage);

  const first = res.data?.[0]?.embedding;
  if (!first || first.length === 0) return null;
  return l2Normalize(new Float32Array(first));
}

// ── 4. Cloud Neural Reranking (`POST /api/v1/rerank`) ───────────────────────

export interface OpenRouterRerankScore {
  index: number;
  relevanceScore: number;
}

export async function rerankViaOpenRouter(
  query: string,
  documents: string[],
  options?: { modelId?: string; topN?: number }
): Promise<OpenRouterRerankScore[]> {
  if (documents.length === 0) return [];
  const modelId =
    options?.modelId ??
    useOpenRouterStore.getState().rerankerModel ??
    DEFAULT_OPENROUTER_RERANKER_MODEL;

  const instructedQuery = modelId.toLowerCase().includes('qwen3-reranker')
    ? `Instruct: ${QWEN3_RERANKER_INSTRUCTION}\nQuery: ${query.trim()}`
    : `${QWEN3_RERANKER_INSTRUCTION}\n\nJournal entry: ${query.trim()}`;

  const body: Record<string, unknown> = {
    model: modelId,
    query: instructedQuery,
    documents,
    ...(options?.topN ? { top_n: options.topN } : {}),
  };

  const res = await openRouterFetch<{
    results?: Array<{ index: number; relevance_score: number }>;
    usage?: { prompt_tokens?: number; total_tokens?: number; cost?: number };
  }>('/rerank', { method: 'POST', body });

  await logUsage('rerank', modelId, res.usage);

  return (res.results ?? []).map((r) => ({
    index: r.index,
    relevanceScore: Math.max(0, Math.min(1, Number(r.relevance_score) || 0)),
  }));
}

// ── 5. Speech-to-Text Transcription (`POST /api/v1/audio/transcriptions`) ───

export async function transcribeAudioViaOpenRouter(params: {
  base64Audio: string;
  format: 'm4a' | 'mp3' | 'wav' | 'mp4' | 'webm' | 'ogg' | 'flac';
  language?: string;
  modelId?: string;
}): Promise<{ text: string; modelUsed: string }> {
  const modelId =
    params.modelId ??
    useOpenRouterStore.getState().transcriptionModel ??
    DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL;

  const body: Record<string, unknown> = {
    model: modelId,
    input_audio: {
      data: params.base64Audio,
      format: params.format,
    },
    ...(params.language ? { language: params.language } : {}),
  };

  const res = await openRouterFetch<{
    text?: string;
    usage?: { prompt_tokens?: number; total_tokens?: number; cost?: number };
  }>('/audio/transcriptions', { method: 'POST', body });

  await logUsage('transcription', modelId, res.usage);
  return {
    text: (res.text ?? '').trim(),
    modelUsed: modelId,
  };
}

// ── 6. Photo / Video Factual Memory Indexing & Scanned PDF OCR ──────────────

export interface MediaMemoryAnalysis {
  sceneSummary: string;
  visibleTextOcr: string;
  spokenTranscript: string;
  suggestedTags: string[];
  momentType: string;
  modelUsed: string;
}

const FACTUAL_MEMORY_SYSTEM_PROMPT =
  'You are a quiet, factual archivist indexing a private life diary. ' +
  'Describe ONLY what is visibly or audibly present in plain, grounded language. ' +
  'Extract any visible handwritten or printed text verbatim into visible_text_ocr. ' +
  'NEVER guess people\'s real names, NEVER diagnose emotions, and NEVER generate ' +
  'spiritual advice, sermons, or reflection prompts. ' +
  'Return strictly valid JSON with keys: scene_summary (string, 1-2 factual sentences), ' +
  'visible_text_ocr (string, verbatim text or empty string), ' +
  'spoken_transcript (string, verbatim speech for video or empty string), ' +
  'suggested_tags (array of 2-5 short lowercase keywords), ' +
  'moment_type (one of: "people", "handwritten_note", "book_page", "nature", "place", "everyday", "gathering").';

function parseMediaAnalysisJson(rawText: string, modelUsed: string): MediaMemoryAnalysis {
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      sceneSummary:
        typeof parsed.scene_summary === 'string' ? parsed.scene_summary.trim() : '',
      visibleTextOcr:
        typeof parsed.visible_text_ocr === 'string' ? parsed.visible_text_ocr.trim() : '',
      spokenTranscript:
        typeof parsed.spoken_transcript === 'string' ? parsed.spoken_transcript.trim() : '',
      suggestedTags: Array.isArray(parsed.suggested_tags)
        ? parsed.suggested_tags
            .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
            .slice(0, 6)
        : [],
      momentType:
        typeof parsed.moment_type === 'string' ? parsed.moment_type.trim() : 'everyday',
      modelUsed,
    };
  } catch {
    return {
      sceneSummary: cleaned.slice(0, 400),
      visibleTextOcr: '',
      spokenTranscript: '',
      suggestedTags: [],
      momentType: 'everyday',
      modelUsed,
    };
  }
}

export async function analyzePhotoViaOpenRouter(params: {
  imageDataUri: string;
  userCaption?: string | null;
  peopleNames?: string[];
  modelId?: string;
}): Promise<MediaMemoryAnalysis> {
  const modelId =
    params.modelId ??
    useOpenRouterStore.getState().visionModel ??
    DEFAULT_OPENROUTER_VISION_MODEL;

  const hintParts: string[] = ['Index this diary photo factually as JSON.'];
  if (params.userCaption?.trim()) {
    hintParts.push(`User caption: "${params.userCaption.trim()}"`);
  }
  if (params.peopleNames && params.peopleNames.length > 0) {
    hintParts.push(`User-tagged people: ${params.peopleNames.join(', ')}`);
  }

  const body: Record<string, unknown> = {
    model: modelId,
    temperature: 0.1,
    max_tokens: 600,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: FACTUAL_MEMORY_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: hintParts.join('\n') },
          { type: 'image_url', image_url: { url: params.imageDataUri } },
        ],
      },
    ],
  };

  const res = await openRouterFetch<{
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  }>('/chat/completions', { method: 'POST', body });

  await logUsage('vision', modelId, res.usage);
  const content = res.choices?.[0]?.message?.content ?? '';
  return parseMediaAnalysisJson(content, modelId);
}

export async function analyzeVideoViaOpenRouter(params: {
  videoDataUri?: string | null;
  frameDataUris?: string[];
  userCaption?: string | null;
  peopleNames?: string[];
  modelId?: string;
}): Promise<MediaMemoryAnalysis> {
  const modelId =
    params.modelId ??
    useOpenRouterStore.getState().visionModel ??
    DEFAULT_OPENROUTER_VISION_MODEL;

  const hintParts: string[] = [
    params.videoDataUri
      ? 'Index this short diary video factually as JSON, including any spoken words in spoken_transcript.'
      : 'Index these sequential keyframes from a diary video factually as JSON.',
  ];
  if (params.userCaption?.trim()) {
    hintParts.push(`User caption: "${params.userCaption.trim()}"`);
  }
  if (params.peopleNames && params.peopleNames.length > 0) {
    hintParts.push(`User-tagged people: ${params.peopleNames.join(', ')}`);
  }

  const userContent: Array<Record<string, unknown>> = [
    { type: 'text', text: hintParts.join('\n') },
  ];

  if (params.videoDataUri) {
    userContent.push({
      type: 'video_url',
      video_url: { url: params.videoDataUri },
    });
  } else if (params.frameDataUris && params.frameDataUris.length > 0) {
    for (const uri of params.frameDataUris) {
      userContent.push({
        type: 'image_url',
        image_url: { url: uri },
      });
    }
  }

  const body: Record<string, unknown> = {
    model: modelId,
    temperature: 0.1,
    max_tokens: 900,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: FACTUAL_MEMORY_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  };

  const res = await openRouterFetch<{
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  }>('/chat/completions', { method: 'POST', body });

  await logUsage('video', modelId, res.usage);
  const content = res.choices?.[0]?.message?.content ?? '';
  return parseMediaAnalysisJson(content, modelId);
}

/**
 * Transcribe a scanned PDF (sent via OpenRouter native PDF file attachment)
 * into clean verbatim plain text for Personal Library reading & embedding.
 */
export async function ocrPdfViaOpenRouter(params: {
  pdfBase64: string;
  filename: string;
  modelId?: string;
}): Promise<{ text: string; modelUsed: string }> {
  const modelId =
    params.modelId ??
    useOpenRouterStore.getState().visionModel ??
    DEFAULT_OPENROUTER_VISION_MODEL;

  const body: Record<string, unknown> = {
    model: modelId,
    temperature: 0,
    max_tokens: 8192,
    messages: [
      {
        role: 'system',
        content:
          'You are an exact document transcriber. Output ONLY the clean verbatim text from the PDF pages, preserving paragraph breaks and chapter headings. Do not add commentary, summaries, or markdown wrappers.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Transcribe all readable text from "${params.filename}" verbatim.`,
          },
          {
            type: 'file',
            file: {
              filename: params.filename,
              file_data: `data:application/pdf;base64,${params.pdfBase64}`,
            },
          },
        ],
      },
    ],
  };

  const res = await openRouterFetch<{
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  }>('/chat/completions', { method: 'POST', body });

  await logUsage('pdf_ocr', modelId, res.usage);
  return {
    text: (res.choices?.[0]?.message?.content ?? '').trim(),
    modelUsed: modelId,
  };
}
