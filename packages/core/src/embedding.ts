/**
 * Pure embedding utilities — model catalog, cosine similarity,
 * and vector serialization. No platform dependencies.
 */

import type { EmbeddingModelId, EmbeddingModelInfo } from './types';

export const EMBEDDING_DIM = 384;

export const EMBEDDING_MODELS: readonly EmbeddingModelInfo[] = [
  { id: 'gte-small', label: 'GTE-small', dim: 384, sizeMb: 33, license: 'MIT', tier: 'cloud' },
  { id: 'bge-small-en', label: 'BGE-small-en-v1.5', dim: 384, sizeMb: 34, license: 'MIT', tier: 'local' },
  { id: 'all-minilm-l6', label: 'all-MiniLM-L6-v2', dim: 384, sizeMb: 23, license: 'Apache 2.0', tier: 'local' },
] as const;

export const CLOUD_EMBEDDING_MODELS = EMBEDDING_MODELS.filter(m => m.tier === 'cloud');
export const LOCAL_EMBEDDING_MODELS = EMBEDDING_MODELS.filter(m => m.tier === 'local');

export function getModelInfo(id: EmbeddingModelId): EmbeddingModelInfo {
  return EMBEDDING_MODELS.find((m) => m.id === id) ?? EMBEDDING_MODELS[0];
}

/**
 * Cosine similarity between two vectors. Works on Float32Array or number[].
 * If vectors are pre-normalized (unit length), this is just the dot product.
 */
export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
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

/** Serialize a Float32Array into a BLOB for storage. */
export function vectorToBlob(vec: Float32Array): ArrayBuffer {
  return vec.buffer.slice(0, vec.byteLength) as ArrayBuffer;
}

/** Deserialize a BLOB back into a Float32Array. */
export function blobToVector(blob: Uint8Array | ArrayBuffer): Float32Array {
  const buf = blob instanceof ArrayBuffer
    ? blob
    : blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  return new Float32Array(buf);
}
