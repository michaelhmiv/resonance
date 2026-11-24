/**
 * Pure embedding, reranker, and vector-math utilities — model catalog,
 * pinned Hugging Face + GitHub Releases offline-engine manifest, int8
 * vector quantization, RVEC binary codec, and Per-Library Z-Score Fusion.
 *
 * No platform dependencies.
 */

import type {
  CorpusPacksManifest,
  DownloadArtifactSpec,
  EmbeddingModelId,
  EmbeddingModelInfo,
  OfflineEngineManifest,
  RerankerModelId,
  RerankerModelInfo,
} from './types';

/** Locked shipping vector dimension (Voyage-4-Nano MRL @ 512d, bake-off v2). */
export const EMBEDDING_DIM = 512;

/** Legacy 384d dimension retained for migrating pre-v2 SQLite vectors. */
export const LEGACY_EMBEDDING_DIM = 384;

export const DEFAULT_LOCAL_EMBEDDING_MODEL: EmbeddingModelId = 'voyage-4-nano';
export const DEFAULT_RERANKER_MODEL: RerankerModelId = 'qwen3-reranker-0.6b';

/** Exact pinned Hugging Face commit SHAs verified against HF tree API. */
export const VOYAGE_4_NANO_HF_REPO = 'onnx-community/voyage-4-nano-ONNX';
export const VOYAGE_4_NANO_COMMIT_SHA = 'fb6f32cceb63b6eac92e1fdc08e00d03c41cdf5a';

export const QWEN3_RERANKER_HF_REPO = 'n24q02m/Qwen3-Reranker-0.6B-ONNX';
export const QWEN3_RERANKER_COMMIT_SHA = '342a8a54de23bba03eb8cce5f5bef503edf18315';

/** GitHub Releases URL for editable/updatable corpus packs manifest. */
export const CORPUS_PACKS_RELEASE_BASE =
  'https://github.com/michaelhmiv/resonance/releases/download/corpus-packs-latest';
export const CORPUS_PACKS_MANIFEST_URL = `${CORPUS_PACKS_RELEASE_BASE}/packs-manifest.json`;

/** Query instruction prefix matching bake-off v2 & pack build pipeline. */
export const VOYAGE_QUERY_PREFIX =
  'Represent this query for retrieving relevant documents: ';

/** G09-calibrated posture rubric for Qwen3-Reranker-0.6B pointwise Yes/No scoring. */
export const QWEN3_RERANKER_INSTRUCTION =
  'Given a personal journal entry, judge whether the passage is a faithful, ' +
  'pastoral spiritual echo that meets the writer in their real situation ' +
  'without scolding, flattening grief, or offering harsh moralism.';

export const EMBEDDING_MODELS: readonly EmbeddingModelInfo[] = [
  {
    id: 'voyage-4-nano',
    label: 'Voyage-4-Nano (INT8 · 512d)',
    dim: 512,
    sizeMb: 411,
    license: 'Apache 2.0',
    tier: 'local',
    quantization: 'int8',
    huggingfaceRepo: VOYAGE_4_NANO_HF_REPO,
    commitSha: VOYAGE_4_NANO_COMMIT_SHA,
  },
  { id: 'gte-small', label: 'GTE-small (legacy)', dim: 384, sizeMb: 33, license: 'MIT', tier: 'cloud' },
  { id: 'bge-small-en', label: 'BGE-small-en-v1.5 (legacy)', dim: 384, sizeMb: 34, license: 'MIT', tier: 'local' },
  { id: 'all-minilm-l6', label: 'all-MiniLM-L6-v2 (legacy)', dim: 384, sizeMb: 23, license: 'Apache 2.0', tier: 'local' },
] as const;

export const RERANKER_MODELS: readonly RerankerModelInfo[] = [
  {
    id: 'qwen3-reranker-0.6b',
    label: 'Qwen3-Reranker-0.6B (INT8 Yes/No)',
    sizeMb: 583,
    license: 'Apache 2.0',
    quantization: 'int8',
    huggingfaceRepo: QWEN3_RERANKER_HF_REPO,
    commitSha: QWEN3_RERANKER_COMMIT_SHA,
  },
  {
    id: 'none',
    label: 'Disabled (retriever only)',
    sizeMb: 0,
    license: '—',
    quantization: 'none',
  },
] as const;

export const CLOUD_EMBEDDING_MODELS = EMBEDDING_MODELS.filter((m) => m.tier === 'cloud');
export const LOCAL_EMBEDDING_MODELS = EMBEDDING_MODELS.filter((m) => m.tier === 'local');

export function getModelInfo(id: EmbeddingModelId): EmbeddingModelInfo {
  return EMBEDDING_MODELS.find((m) => m.id === id) ?? EMBEDDING_MODELS[0];
}

export function getRerankerInfo(id: RerankerModelId): RerankerModelInfo {
  return RERANKER_MODELS.find((m) => m.id === id) ?? RERANKER_MODELS[0];
}

/**
 * Exact pinned model weight + tokenizer downloads (immutable HF commit SHAs +
 * verified SHA-256 digests). Total model weights: ~994 MB (411 + 583 MB).
 */
export const OFFLINE_MODEL_ARTIFACTS: readonly DownloadArtifactSpec[] = [
  {
    id: 'voyage-4-nano-onnx',
    group: 'embedder',
    label: 'Voyage-4-Nano ONNX graph',
    url: `https://huggingface.co/${VOYAGE_4_NANO_HF_REPO}/resolve/${VOYAGE_4_NANO_COMMIT_SHA}/onnx/model_quantized.onnx`,
    relativePath: 'models/voyage-4-nano/model_quantized.onnx',
    sizeBytes: 268_076,
    sha256: 'e2999ae63b575e34b7bef6a513f48c7f7701cebfb1bfffcb9db23ab0db324157',
  },
  {
    id: 'voyage-4-nano-data',
    group: 'embedder',
    label: 'Voyage-4-Nano INT8 weights',
    url: `https://huggingface.co/${VOYAGE_4_NANO_HF_REPO}/resolve/${VOYAGE_4_NANO_COMMIT_SHA}/onnx/model_quantized.onnx_data`,
    relativePath: 'models/voyage-4-nano/model_quantized.onnx_data',
    sizeBytes: 421_625_856,
    sha256: 'db94fc1655db1a1b55f67f7019ebbd803142f54e1bd83cfd1c2d6faadd6a648c',
  },
  {
    id: 'voyage-4-nano-tokenizer',
    group: 'embedder',
    label: 'Voyage-4-Nano tokenizer',
    url: `https://huggingface.co/${VOYAGE_4_NANO_HF_REPO}/resolve/${VOYAGE_4_NANO_COMMIT_SHA}/tokenizer.json`,
    relativePath: 'models/voyage-4-nano/tokenizer.json',
    sizeBytes: 9_116_486,
    sha256: 'c40c3736449ad0f4084a187dfe16f6850b2a2933dfe041394f850608b2890140',
  },
  {
    id: 'voyage-4-nano-tokenizer-config',
    group: 'embedder',
    label: 'Voyage-4-Nano tokenizer config',
    url: `https://huggingface.co/${VOYAGE_4_NANO_HF_REPO}/resolve/${VOYAGE_4_NANO_COMMIT_SHA}/tokenizer_config.json`,
    relativePath: 'models/voyage-4-nano/tokenizer_config.json',
    sizeBytes: 3_262,
    sha256: 'ca057610cc7151781181806adda7ac01a2b09c4d4756983a9e49d69252689522',
  },
  {
    id: 'qwen3-reranker-onnx',
    group: 'reranker',
    label: 'Qwen3-Reranker-0.6B INT8 Yes/No weights',
    url: `https://huggingface.co/${QWEN3_RERANKER_HF_REPO}/resolve/${QWEN3_RERANKER_COMMIT_SHA}/onnx/model_yesno_quantized.onnx`,
    relativePath: 'models/qwen3-reranker-0.6b/model_yesno_quantized.onnx',
    sizeBytes: 600_120_496,
    sha256: '2bc0a77812a15ff6ead003370f36149139ae2c1bb1faf779b00c00886cd919ef',
  },
  {
    id: 'qwen3-reranker-tokenizer',
    group: 'reranker',
    label: 'Qwen3-Reranker tokenizer',
    url: `https://huggingface.co/${QWEN3_RERANKER_HF_REPO}/resolve/${QWEN3_RERANKER_COMMIT_SHA}/tokenizer.json`,
    relativePath: 'models/qwen3-reranker-0.6b/tokenizer.json',
    sizeBytes: 11_422_818,
    sha256: '8579e1ca7cc5d82a9e0202eed555529996f4ffe7f563c2979a0290cf3db452d3',
  },
  {
    id: 'qwen3-reranker-tokenizer-config',
    group: 'reranker',
    label: 'Qwen3-Reranker tokenizer config',
    url: `https://huggingface.co/${QWEN3_RERANKER_HF_REPO}/resolve/${QWEN3_RERANKER_COMMIT_SHA}/tokenizer_config.json`,
    relativePath: 'models/qwen3-reranker-0.6b/tokenizer_config.json',
    sizeBytes: 349,
    sha256: 'bc3e7cb4dad833a185d4bfbb4880562dc9b0cb101c47b8985078122a122d553a',
  },
] as const;

/**
 * Fallback corpus packs catalog used when offline or before a remote
 * `packs-manifest.json` is fetched from GitHub Releases. Editing or replacing
 * assets on the `corpus-packs-latest` GitHub Release updates packs live without
 * shipping a new APK.
 */
export const FALLBACK_CORPUS_MANIFEST: CorpusPacksManifest = {
  schemaVersion: 1,
  releaseTag: 'corpus-packs-latest',
  updatedAt: '2026-11-24T00:00:00Z',
  modelId: 'voyage-4-nano',
  dim: 512,
  quantization: 'int8',
  packs: [
    {
      id: 'bible-web',
      label: 'World English Bible (512d vectors)',
      description: '6,220 Scripture passages pre-embedded with Voyage-4-Nano INT8.',
      version: '1.0.0',
      kind: 'bible',
      workCount: 66,
      passageCount: 6_220,
      dim: 512,
      quantization: 'int8',
      modelId: 'voyage-4-nano',
      passagesUrl: `${CORPUS_PACKS_RELEASE_BASE}/bible-web.passages.jsonl.gz`,
      passagesBytes: 1_258_291,
      passagesSha256: null,
      vectorsUrl: `${CORPUS_PACKS_RELEASE_BASE}/bible-web.vectors.rvec`,
      vectorsBytes: 3_209_568,
      vectorsSha256: null,
    },
    {
      id: 'witnesses-all',
      label: '80-Work Church Library (512d)',
      description: 'Church Fathers, Medieval Mystics, Reformers, and Modern Witnesses (104,673 passages).',
      version: '1.0.0',
      kind: 'witnesses',
      workCount: 80,
      passageCount: 104_673,
      dim: 512,
      quantization: 'int8',
      modelId: 'voyage-4-nano',
      passagesUrl: `${CORPUS_PACKS_RELEASE_BASE}/witnesses-all.passages.jsonl.gz`,
      passagesBytes: 27_367_833,
      passagesSha256: null,
      vectorsUrl: `${CORPUS_PACKS_RELEASE_BASE}/witnesses-all.vectors.rvec`,
      vectorsBytes: 54_011_296,
      vectorsSha256: null,
    },
  ],
};

/** Locked shipping offline engine specification (bake-off v2 confirmed 512d). */
export const OFFLINE_ENGINE_MANIFEST: OfflineEngineManifest = {
  version: '2.0.0',
  embeddingModelId: 'voyage-4-nano',
  rerankerModelId: 'qwen3-reranker-0.6b',
  dim: EMBEDDING_DIM,
  fusionAlpha: 0.60,
  silenceThreshold: 0.06,
  perWorkCap: 2,
  modelArtifacts: OFFLINE_MODEL_ARTIFACTS,
  corpusManifestUrl: CORPUS_PACKS_MANIFEST_URL,
  fallbackCorpusManifest: FALLBACK_CORPUS_MANIFEST,
};

// ── Cosine similarity & L2 normalization ────────────────────────────────────

export function l2Normalize(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i] / norm;
  }
  return out;
}

/**
 * Cosine similarity between two vectors. Works on Float32Array or number[].
 * If vectors are pre-normalized (unit length), this is just the dot product.
 */
export function cosineSimilarity(
  a: Float32Array | number[],
  b: Float32Array | number[]
): number {
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

// ── Symmetric per-vector int8 quantization (0.9952 top-50 overlap) ──────────

export interface QuantizedInt8Vector {
  quantized: Int8Array;
  scale: number;
}

/**
 * Truncate to `targetDim` (MRL), L2-normalize, and symmetrically quantize
 * into `Int8Array` + single `float32` scale (`scale = max(|v|) / 127`).
 */
export function quantizeVectorInt8(
  vec: Float32Array,
  targetDim: number = EMBEDDING_DIM
): QuantizedInt8Vector {
  const dim = Math.min(vec.length, targetDim);
  const sliced = dim === vec.length ? vec : vec.subarray(0, dim);
  const unit = l2Normalize(sliced);

  let maxAbs = 0;
  for (let i = 0; i < dim; i++) {
    const a = Math.abs(unit[i]);
    if (a > maxAbs) maxAbs = a;
  }

  const scale = maxAbs > 0 ? maxAbs / 127 : 1;
  const quantized = new Int8Array(dim);
  if (maxAbs > 0) {
    const inv = 127 / maxAbs;
    for (let i = 0; i < dim; i++) {
      const q = Math.round(unit[i] * inv);
      quantized[i] = q > 127 ? 127 : q < -127 ? -127 : q;
    }
  }
  return { quantized, scale };
}

/** Reconstruct a Float32Array from an int8 vector + scale. */
export function dequantizeVectorInt8(
  quantized: Int8Array,
  scale: number
): Float32Array {
  const out = new Float32Array(quantized.length);
  for (let i = 0; i < quantized.length; i++) {
    out[i] = quantized[i] * scale;
  }
  return out;
}

/**
 * Fast inner product between an L2-normalized Float32 query vector and a
 * contiguous int8 matrix row at `offset = rowIndex * dim`.
 */
export function dotProductFloat32Int8(
  query: Float32Array,
  matrix: Int8Array,
  offset: number,
  scale: number,
  dim: number = EMBEDDING_DIM
): number {
  let acc = 0;
  const len = Math.min(query.length, dim);
  for (let i = 0; i < len; i++) {
    acc += query[i] * matrix[offset + i];
  }
  return acc * scale;
}

// ── RVEC v1 binary codec (compact on-device int8 vector packs) ──────────────
//
// Layout (little-endian):
//   [0..3]   Magic bytes: "RVEC" (0x52, 0x56, 0x45, 0x43)
//   [4]      Version: 1
//   [5]      Quantization: 1 = symmetric per-vector int8
//   [6..7]   Dim (uint16, e.g. 512)
//   [8..11]  Count N (uint32)
//   [12..15] Reserved (uint32 = 0)
//   [16 .. 16 + 4*N)                  Float32Array scales (N floats)
//   [16 + 4*N .. 16 + 4*N + N*dim)    Int8Array vectors (N * dim signed bytes)

export const RVEC_HEADER_BYTES = 16;

export interface RvecData {
  version: number;
  quantization: number;
  dim: number;
  count: number;
  scales: Float32Array;
  vectors: Int8Array;
}

export function encodeRvec(
  vectors: Int8Array,
  scales: Float32Array,
  dim: number = EMBEDDING_DIM
): Uint8Array {
  const count = scales.length;
  if (vectors.length !== count * dim) {
    throw new Error(`encodeRvec shape mismatch: expected ${count * dim} bytes, got ${vectors.length}`);
  }
  const totalBytes = RVEC_HEADER_BYTES + count * 4 + count * dim;
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);
  out[0] = 0x52; // R
  out[1] = 0x56; // V
  out[2] = 0x45; // E
  out[3] = 0x43; // C
  view.setUint8(4, 1); // version 1
  view.setUint8(5, 1); // symmetric per-vector int8
  view.setUint16(6, dim, true);
  view.setUint32(8, count, true);
  view.setUint32(12, 0, true);

  for (let i = 0; i < count; i++) {
    view.setFloat32(RVEC_HEADER_BYTES + i * 4, scales[i], true);
  }
  const vecStart = RVEC_HEADER_BYTES + count * 4;
  out.set(new Uint8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength), vecStart);
  return out;
}

export function parseRvec(bytes: Uint8Array | ArrayBuffer): RvecData {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength < RVEC_HEADER_BYTES) {
    throw new Error('Invalid RVEC file: truncated header');
  }
  if (u8[0] !== 0x52 || u8[1] !== 0x56 || u8[2] !== 0x45 || u8[3] !== 0x43) {
    throw new Error('Invalid RVEC file: bad magic');
  }
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = view.getUint8(4);
  const quantization = view.getUint8(5);
  const dim = view.getUint16(6, true);
  const count = view.getUint32(8, true);

  const scalesOffset = RVEC_HEADER_BYTES;
  const vectorsOffset = scalesOffset + count * 4;
  const expectedBytes = vectorsOffset + count * dim;
  if (u8.byteLength < expectedBytes) {
    throw new Error(`Invalid RVEC file: expected ${expectedBytes} bytes, got ${u8.byteLength}`);
  }

  const scales = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    scales[i] = view.getFloat32(scalesOffset + i * 4, true);
  }
  const vectors = new Int8Array(u8.buffer, u8.byteOffset + vectorsOffset, count * dim);
  return { version, quantization, dim, count, scales, vectors };
}

// ── Per-Library Z-Score Fusion + Calibrated Silence (bake-off v2) ───────────

export interface FusionCandidate {
  id: string;
  workId: string;
  library: 'scripture' | 'witness' | 'personal';
  /** Raw retriever cosine score. */
  denseScore: number;
  /** Reranker P(yes) in [0, 1], or null when reranker is unavailable. */
  rerankProb: number | null;
  /** Optional raw reranker logit (yes - no). */
  rerankLogit?: number | null;
}

export interface FusedCandidate extends FusionCandidate {
  zDense: number;
  zRerank: number;
  fusedScore: number;
}

export interface PerLibraryFusionOptions {
  /** Weight on z(reranker) vs z(dense). Locked at 0.60 for 512d. */
  alpha?: number;
  /** Calibrated silence threshold on max P(yes). Locked at 0.06. */
  silenceThreshold?: number;
  /** Max passages surfaced from any single workId. Locked at 2. */
  perWorkCap?: number;
  /** Max total passages returned. */
  topK?: number;
}

function zScores(values: number[]): number[] {
  if (values.length === 0) return [];
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let varSum = 0;
  for (const v of values) {
    const d = v - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / values.length);
  if (std < 1e-8) return values.map(() => 0);
  return values.map((v) => (v - mean) / std);
}

/**
 * Exact TypeScript implementation of `scripts/bakeoff/fuse_perlib.py`.
 *
 * Normalizes dense similarity and reranker score within each library separately
 * (preventing cross-library domain scale bias), fuses via
 *   `fused = (1 - α) * z_dense + α * z_rerank`,
 * applies Calibrated Silence when `max(rerankProb) < silenceThreshold`, and
 * enforces a per-work cap (`perWorkCap = 2`).
 */
export function perLibraryZScoreFuse(
  candidates: FusionCandidate[],
  options: PerLibraryFusionOptions = {}
): { silent: boolean; maxRerankProb: number | null; results: FusedCandidate[] } {
  const alpha = options.alpha ?? OFFLINE_ENGINE_MANIFEST.fusionAlpha;
  const silenceThreshold =
    options.silenceThreshold ?? OFFLINE_ENGINE_MANIFEST.silenceThreshold;
  const perWorkCap = options.perWorkCap ?? OFFLINE_ENGINE_MANIFEST.perWorkCap;
  const topK = options.topK ?? 5;

  if (candidates.length === 0) {
    return { silent: true, maxRerankProb: null, results: [] };
  }

  const rerankedProbs = candidates
    .map((c) => c.rerankProb)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
  const hasReranker = rerankedProbs.length > 0;
  const maxRerankProb = hasReranker ? Math.max(...rerankedProbs) : null;

  // Calibrated Silence: when the reranker sees no genuine echo, stay quiet.
  if (hasReranker && maxRerankProb !== null && maxRerankProb < silenceThreshold) {
    return { silent: true, maxRerankProb, results: [] };
  }

  // Group by library (scripture vs witness+personal) for per-library z-scoring.
  const groups = new Map<string, FusionCandidate[]>();
  for (const c of candidates) {
    const bucket = c.library === 'scripture' ? 'scripture' : 'non_scripture';
    const list = groups.get(bucket) ?? [];
    list.push(c);
    groups.set(bucket, list);
  }

  const fusedAll: FusedCandidate[] = [];
  for (const group of groups.values()) {
    const zDenseArr = zScores(group.map((g) => g.denseScore));
    const rerankSignals = group.map((g) =>
      typeof g.rerankLogit === 'number' && Number.isFinite(g.rerankLogit)
        ? g.rerankLogit
        : g.rerankProb ?? 0
    );
    const zRerankArr = hasReranker ? zScores(rerankSignals) : group.map(() => 0);

    for (let i = 0; i < group.length; i++) {
      const zDense = zDenseArr[i];
      const zRerank = zRerankArr[i];
      const fusedScore = hasReranker
        ? (1 - alpha) * zDense + alpha * zRerank
        : zDense;
      fusedAll.push({
        ...group[i],
        zDense,
        zRerank,
        fusedScore,
      });
    }
  }

  fusedAll.sort((a, b) => b.fusedScore - a.fusedScore);

  const selected: FusedCandidate[] = [];
  const workCounts = new Map<string, number>();
  for (const item of fusedAll) {
    const count = workCounts.get(item.workId) ?? 0;
    if (count >= perWorkCap) continue;
    workCounts.set(item.workId, count + 1);
    selected.push(item);
    if (selected.length >= topK) break;
  }

  return { silent: selected.length === 0, maxRerankProb, results: selected };
}

// ── Float32 blob helpers (backward compatible with journal_segment_vectors) ─

/** Serialize a Float32Array into a BLOB for storage. */
export function vectorToBlob(vec: Float32Array): ArrayBuffer {
  return vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength) as ArrayBuffer;
}

/** Deserialize a BLOB back into a Float32Array. */
export function blobToVector(blob: Uint8Array | ArrayBuffer): Float32Array {
  const buf =
    blob instanceof ArrayBuffer
      ? blob
      : blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  return new Float32Array(buf);
}
