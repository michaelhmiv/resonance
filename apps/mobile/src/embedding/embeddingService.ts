/**
 * Embedding service — on-device text → vector via ONNX Runtime.
 *
 * The embedding model (GTE-small default, 33 MB) runs locally through
 * `onnxruntime-react-native`. Vectors are Float32Array, 384 dimensions
 * for GTE-small. The model file and tokenizer sit in bundled assets.
 *
 * All embedding stays on the device. Nothing is sent to a server.
 *
 * (design spec §7.1 — embeddings, model selection, first-launch prompt)
 */

import { Platform } from 'react-native';

// ONNX Runtime is imported dynamically so that the module loads only on
// native platforms (not web) and only after the model file is resolved.
// This keeps the TypeScript surface clean even if the native module isn't
// linked in every build configuration.

/** Dimension of the embedding vectors for the active model. */
export const EMBEDDING_DIM = 384;

/** Model identifiers that the app supports. */
export type EmbeddingModelId = 'gte-small' | 'bge-small-en' | 'all-minilm-l6';

export interface EmbeddingModelInfo {
  id: EmbeddingModelId;
  label: string;
  dim: number;
  sizeMb: number;
  license: string;
}

export const EMBEDDING_MODELS: readonly EmbeddingModelInfo[] = [
  {
    id: 'gte-small',
    label: 'GTE-small',
    dim: 384,
    sizeMb: 33,
    license: 'MIT',
  },
  {
    id: 'bge-small-en',
    label: 'BGE-small-en-v1.5',
    dim: 384,
    sizeMb: 34,
    license: 'MIT',
  },
  {
    id: 'all-minilm-l6',
    label: 'all-MiniLM-L6-v2',
    dim: 384,
    sizeMb: 23,
    license: 'Apache 2.0',
  },
] as const;

export function getModelInfo(id: EmbeddingModelId): EmbeddingModelInfo {
  return EMBEDDING_MODELS.find((m) => m.id === id) ?? EMBEDDING_MODELS[0];
}

// ── Session management ─────────────────────────────────────────────────────

let session: unknown | null = null;
let activeModelId: EmbeddingModelId | null = null;

export function getActiveEmbeddingModel(): EmbeddingModelId | null {
  return activeModelId;
}

export function isEmbeddingReady(): boolean {
  return session !== null && activeModelId !== null;
}

/**
 * Initialize the ONNX session for the given model. Downloads/bundled
 * asset resolution is handled here. Safe to call multiple times — if
 * the model is already loaded, it's a no-op; if switching models, the
 * old session is disposed first.
 *
 * On platforms where the ONNX runtime isn't linked, this resolves to
 * `false` — callers should gracefully degrade (no resonance features).
 */
export async function initEmbeddingModel(
  modelId: EmbeddingModelId
): Promise<boolean> {
  if (session !== null && activeModelId === modelId) {
    return true; // already loaded
  }

  // Dispose previous session if switching models.
  if (session !== null) {
    try {
      // The session object's dispose method varies by binding; we try
      // the common path and ignore failures.
      const s = session as { dispose?: () => void; close?: () => void };
      s.dispose?.();
      s.close?.();
    } catch {
      // ignore
    }
    session = null;
    activeModelId = null;
  }

  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return false;
  }

  try {
    // Dynamic import so the native module isn't required at build time
    // for every configuration (e.g. when running tsc --noEmit without
    // native modules linked).
    const ort = await import('onnxruntime-react-native');

    // In a full production build the model file path would be resolved
    // from the asset bundle or the downloaded package directory. For
    // now we construct the path from the model id convention.
    const modelPath = `models/${modelId}/model.onnx`;

    // Attempt to create the session. If the model file doesn't exist or
    // the native module isn't linked, this throws — we catch and return
    // false so the caller can degrade gracefully.
    session = await ort.InferenceSession.create(modelPath);
    activeModelId = modelId;
    return true;
  } catch {
    session = null;
    activeModelId = null;
    return false;
  }
}

// ── Tokenizer (simplified word-piece for GTE-small / BERT-family) ──────────
//
// A production build ships a proper tokenizer vocabulary file. The
// interface here is the contract: `tokenize` splits text into input_ids
// and attention_mask tensors that the ONNX model expects.

interface TokenizerResult {
  inputIds: number[];
  attentionMask: number[];
}

/**
 * Placeholder tokenizer that produces empty tensors. The real tokenizer
 * is loaded from the model's vocab.txt alongside the ONNX file. This
 * keeps the interface clean for tsc while the native bridge is wired.
 */
async function tokenize(text: string): Promise<TokenizerResult> {
  // In production: load vocab, do word-piece tokenization, truncate/pad
  // to max_seq_len (128 for GTE-small), produce input_ids + attention_mask.
  // For now, return empty — the embedding function will return zeros,
  // which means cosine similarity returns 0 (no match) gracefully.
  const _text = text;
  return {
    inputIds: [],
    attentionMask: [],
  };
}

// ── Embed text ──────────────────────────────────────────────────────────────

/**
 * Embed a single text string into a Float32Array of dimension EMBEDDING_DIM.
 *
 * Returns null if the model isn't loaded or embedding fails. Callers should
 * check for null and skip resonance for that segment (graceful degradation).
 *
 * The pipeline: tokenize → ONNX run → mean-pool over tokens (with attention
 * mask) → L2 normalize → Float32Array.
 */
export async function embedText(text: string): Promise<Float32Array | null> {
  if (!session || !activeModelId) return null;

  try {
    const { inputIds, attentionMask } = await tokenize(text);
    if (inputIds.length === 0) return null;

    const ort = await import('onnxruntime-react-native');

    // Create input tensors.
    const inputTensor = new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]);
    const maskTensor = new ort.Tensor('int64', BigInt64Array.from(attentionMask.map(BigInt)), [1, attentionMask.length]);

    // Run inference.
    const feeds: Record<string, unknown> = {};
    const inputNames = (session as { inputNames: string[] }).inputNames;
    feeds[inputNames[0]] = inputTensor;
    if (inputNames.length > 1) {
      feeds[inputNames[1]] = maskTensor;
    }

    const outputNamesList = (session as { outputNames: string[] }).outputNames;
    const results = await (session as { run: (feeds: Record<string, unknown>, outputs: string[]) => Promise<Record<string, unknown>> }).run(feeds, outputNamesList);

    // Output is [1, seq_len, dim] — mean-pool + L2 normalize.
    const outputTensor = results[outputNamesList[0]] as { data: Float32Array; dims: number[] };
    const dims = outputTensor.dims;
    const seqLen = dims[1];
    const dim = dims[2] ?? EMBEDDING_DIM;

    // Mean pooling with attention mask.
    const pooled = new Float32Array(dim);
    let count = 0;
    for (let t = 0; t < seqLen; t++) {
      if (attentionMask[t] === 1) {
        for (let d = 0; d < dim; d++) {
          pooled[d] += outputTensor.data[t * dim + d];
        }
        count++;
      }
    }
    if (count === 0) return null;
    for (let d = 0; d < dim; d++) {
      pooled[d] /= count;
    }

    // L2 normalize.
    let norm = 0;
    for (let d = 0; d < dim; d++) {
      norm += pooled[d] * pooled[d];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let d = 0; d < dim; d++) {
        pooled[d] /= norm;
      }
    }

    return pooled;
  } catch {
    return null;
  }
}

// ── Cosine similarity ──────────────────────────────────────────────────────

/**
 * Cosine similarity between two L2-normalized vectors. If the vectors aren't
 * pre-normalized, this still computes the correct cosine (dot product / norms).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Vector blob ↔ Float32Array ─────────────────────────────────────────────

/** Serialize a Float32Array into a BLOB for SQLite storage. */
export function vectorToBlob(vec: Float32Array): ArrayBuffer {
  return vec.buffer.slice(0, vec.byteLength) as ArrayBuffer;
}

/** Deserialize a BLOB from SQLite back into a Float32Array. */
export function blobToVector(blob: Uint8Array | ArrayBuffer): Float32Array {
  const buf = blob instanceof ArrayBuffer ? blob : blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  return new Float32Array(buf);
}
