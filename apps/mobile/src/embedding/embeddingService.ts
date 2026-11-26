/**
 * Embedding service — on-device text → 512d vector via ONNX Runtime.
 *
 * Locked shipping model (bake-off v2): `Voyage-4-Nano` INT8 ONNX
 * (`onnx-community/voyage-4-nano-ONNX`), mean-pooled, MRL-sliced to 512d,
 * L2-normalized, and quantized to symmetric per-vector `int8` for storage.
 *
 * All embedding stays on the device. Nothing is sent to a server.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  EMBEDDING_DIM,
  EMBEDDING_MODELS,
  VOYAGE_DOC_PREFIX,
  VOYAGE_QUERY_PREFIX,
  blobToVector,
  cosineSimilarity,
  getModelInfo,
  l2Normalize,
  quantizeVectorInt8,
  vectorToBlob,
  type EmbeddingModelId,
  type EmbeddingModelInfo,
} from '@resonance/core';
import { getEmbedderModelPaths } from '../packages/offlineEngineManager';

export {
  EMBEDDING_DIM,
  EMBEDDING_MODELS,
  getModelInfo,
  cosineSimilarity,
  vectorToBlob,
  blobToVector,
  quantizeVectorInt8,
  type EmbeddingModelId,
  type EmbeddingModelInfo,
};

// ── Lightweight Hugging Face tokenizer.json loader ─────────────────────────

interface LoadedTokenizer {
  vocab: Map<string, number>;
  unkId: number;
  bosId: number | null;
  eosId: number | null;
  maxLen: number;
}

let tokenizer: LoadedTokenizer | null = null;
let lastEmbeddingError: string | null = null;

export function getLastEmbeddingError(): string | null {
  return lastEmbeddingError;
}

async function loadTokenizerFromJson(path: string, maxLen = 512): Promise<LoadedTokenizer | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) {
      lastEmbeddingError = 'Tokenizer file is missing.';
      return null;
    }
    const raw = await FileSystem.readAsStringAsync(path);
    const parsed = JSON.parse(raw) as {
      model?: { vocab?: Record<string, number> };
      added_tokens?: Array<{ id: number; content: string }>;
      post_processor?: { type?: string } | null;
    };
    const vocab = new Map<string, number>();
    if (parsed.model?.vocab) {
      for (const [tok, id] of Object.entries(parsed.model.vocab)) {
        vocab.set(tok, id);
      }
    }
    if (Array.isArray(parsed.added_tokens)) {
      for (const t of parsed.added_tokens) {
        vocab.set(t.content, t.id);
      }
    }
    if (vocab.size === 0) {
      lastEmbeddingError = 'Tokenizer vocabulary is empty.';
      return null;
    }
    const unkId =
      vocab.get('<unk>') ?? vocab.get('[UNK]') ?? vocab.get('<|endoftext|>') ?? 0;
    // Qwen2 / Voyage-4-Nano uses ByteLevel post-processing with bos_token=null
    // and adds neither BOS nor EOS when encoding passages/queries. Only attach
    // BOS/EOS for TemplateProcessing models (e.g., BERT/RoBERTa/BGE).
    const usesTemplateTokens = parsed.post_processor?.type === 'TemplateProcessing';
    const bosId = usesTemplateTokens
      ? (vocab.get('<s>') ?? vocab.get('[CLS]') ?? null)
      : null;
    const eosId = usesTemplateTokens
      ? (vocab.get('</s>') ?? vocab.get('[SEP]') ?? null)
      : null;
    return { vocab, unkId, bosId, eosId, maxLen };
  } catch (err) {
    lastEmbeddingError = `Failed to load tokenizer: ${err instanceof Error ? err.message : String(err)}`;
    console.warn('[embeddingService] loadTokenizerFromJson failed:', err);
    return null;
  }
}

/**
 * Greedy longest-prefix subword tokenizer operating on Hugging Face
 * `tokenizer.json` vocab (handles both ByteLevel `Ġ` and SentencePiece `▁`
 * prefixes cleanly on Hermes without native Rust bindings).
 */
export function encodeWithTokenizer(
  tok: LoadedTokenizer,
  text: string,
  maxLen = tok.maxLen
): { inputIds: number[]; attentionMask: number[] } {
  const ids: number[] = [];
  if (tok.bosId !== null) ids.push(tok.bosId);

  const words = text.trim().split(/(\s+)/);
  for (let wIdx = 0; wIdx < words.length && ids.length < maxLen - 1; wIdx++) {
    const piece = words[wIdx];
    if (!piece) continue;
    if (/^\s+$/.test(piece)) continue;

    // Try ByteLevel (Ġ) or SentencePiece (▁) prefix for non-initial words
    const prefixCandidates =
      wIdx > 0 ? [`\u0120${piece}`, `\u2581${piece}`, piece] : [piece, `\u2581${piece}`];

    let matchedWhole = false;
    for (const cand of prefixCandidates) {
      const id = tok.vocab.get(cand);
      if (id !== undefined) {
        ids.push(id);
        matchedWhole = true;
        break;
      }
    }
    if (matchedWhole) continue;

    // Greedy subword fallback
    let pos = 0;
    while (pos < piece.length && ids.length < maxLen - 1) {
      let bestEnd = pos + 1;
      let bestId = tok.unkId;
      const limit = Math.min(piece.length, pos + 20);
      for (let end = limit; end > pos; end--) {
        const sub = piece.slice(pos, end);
        const tries =
          pos === 0 && wIdx > 0
            ? [`\u0120${sub}`, `\u2581${sub}`, sub]
            : pos > 0
              ? [`##${sub}`, sub]
              : [sub];
        let found: number | undefined;
        for (const t of tries) {
          const hit = tok.vocab.get(t);
          if (hit !== undefined) {
            found = hit;
            break;
          }
        }
        if (found !== undefined) {
          bestEnd = end;
          bestId = found;
          break;
        }
      }
      ids.push(bestId);
      pos = bestEnd;
    }
  }

  if (tok.eosId !== null && ids.length < maxLen) ids.push(tok.eosId);
  return {
    inputIds: ids,
    attentionMask: ids.map(() => 1),
  };
}

// ── Session management ──────────────────────────────────────────────────────

let session: unknown | null = null;
let activeModelId: EmbeddingModelId | null = null;
let initInFlight: Promise<boolean> | null = null;

export function getActiveEmbeddingModel(): EmbeddingModelId | null {
  return activeModelId;
}

export function isEmbeddingReady(): boolean {
  return session !== null && activeModelId !== null && tokenizer !== null;
}

export async function disposeEmbeddingModel(): Promise<void> {
  if (session !== null) {
    try {
      const s = session as { release?: () => void; dispose?: () => void; close?: () => void };
      s.release?.();
      s.dispose?.();
      s.close?.();
    } catch {
      // ignore
    }
  }
  session = null;
  activeModelId = null;
  tokenizer = null;
}

/**
 * Initialize the ONNX session for the active local embedding model
 * (`voyage-4-nano` INT8 downloaded via `offlineEngineManager`).
 *
 * Coalesces concurrent calls and stores any diagnostic failure in
 * `getLastEmbeddingError()` so callers can surface honest UI feedback.
 */
export async function initEmbeddingModel(
  modelId: EmbeddingModelId = DEFAULT_LOCAL_EMBEDDING_MODEL
): Promise<boolean> {
  if (session !== null && activeModelId === modelId && tokenizer !== null) {
    lastEmbeddingError = null;
    return true;
  }

  if (initInFlight) {
    return initInFlight;
  }

  initInFlight = (async () => {
    lastEmbeddingError = null;
    await disposeEmbeddingModel();

    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      lastEmbeddingError = 'On-device ONNX embedding is only available on Android and iOS.';
      return false;
    }

    try {
      const paths = getEmbedderModelPaths();
      const [onnxInfo, dataInfo, tokInfo] = await Promise.all([
        FileSystem.getInfoAsync(paths.onnxPath),
        FileSystem.getInfoAsync(paths.dataPath),
        FileSystem.getInfoAsync(paths.tokenizerPath),
      ]);

      const onnxSize = (onnxInfo as { size?: number }).size ?? 0;
      const dataSize = (dataInfo as { size?: number }).size ?? 0;
      const tokSize = (tokInfo as { size?: number }).size ?? 0;

      if (
        !onnxInfo.exists ||
        !dataInfo.exists ||
        !tokInfo.exists ||
        onnxSize <= 0 ||
        dataSize <= 0 ||
        tokSize <= 0
      ) {
        lastEmbeddingError =
          'Offline Engine model files are not downloaded yet. Download the core engine in Settings.';
        return false;
      }

      const loadedTok = await loadTokenizerFromJson(paths.tokenizerPath, 512);
      if (!loadedTok) {
        return false;
      }

      const ort = await import('onnxruntime-react-native');
      if (!ort || typeof ort.InferenceSession?.create !== 'function') {
        lastEmbeddingError =
          'ONNX Runtime native module is unavailable in this build. Please reinstall the latest preview APK.';
        console.warn('[embeddingService] onnxruntime-react-native InferenceSession.create missing');
        return false;
      }

      const cleanPath = paths.onnxPath.replace(/^file:\/\//, '');
      session = await ort.InferenceSession.create(cleanPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      tokenizer = loadedTok;
      activeModelId = modelId;
      lastEmbeddingError = null;
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastEmbeddingError = `Could not initialize on-device embedder: ${msg}`;
      console.warn('[embeddingService] initEmbeddingModel failed:', err);
      await disposeEmbeddingModel();
      return false;
    } finally {
      initInFlight = null;
    }
  })();

  return initInFlight;
}

/**
 * Lazily initializes the Voyage-4-Nano ONNX session if weights are downloaded
 * on disk and the session hasn't been loaded yet in this app launch.
 */
export async function ensureEmbeddingReady(): Promise<boolean> {
  if (isEmbeddingReady()) return true;
  return initEmbeddingModel(DEFAULT_LOCAL_EMBEDDING_MODEL);
}

// ── Embed text (Voyage-4-Nano INT8 → 512d MRL → L2 normalize) ──────────────

async function embedRawText(text: string): Promise<Float32Array | null> {
  if (!session || !activeModelId || !tokenizer) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const { inputIds, attentionMask } = encodeWithTokenizer(tokenizer, trimmed, 512);
    if (inputIds.length === 0) return null;

    const ort = await import('onnxruntime-react-native');
    const inputTensor = new ort.Tensor(
      'int64',
      BigInt64Array.from(inputIds.map(BigInt)),
      [1, inputIds.length]
    );
    const maskTensor = new ort.Tensor(
      'int64',
      BigInt64Array.from(attentionMask.map(BigInt)),
      [1, attentionMask.length]
    );

    const sess = session as {
      inputNames: readonly string[];
      outputNames: readonly string[];
      run: (
        feeds: Record<string, unknown>,
        fetches?: readonly string[]
      ) => Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>;
    };

    const feeds: Record<string, unknown> = {};
    for (const name of sess.inputNames) {
      if (name.includes('attention_mask')) {
        feeds[name] = maskTensor;
      } else if (name.includes('position_ids')) {
        const posIds = BigInt64Array.from(inputIds.map((_, i) => BigInt(i)));
        feeds[name] = new ort.Tensor('int64', posIds, [1, inputIds.length]);
      } else if (name.includes('token_type_ids')) {
        const typeIds = new BigInt64Array(inputIds.length);
        feeds[name] = new ort.Tensor('int64', typeIds, [1, inputIds.length]);
      } else {
        feeds[name] = inputTensor;
      }
    }

    // Prefer pooled 2D output (`sentence_embedding` or `pooler_output`) to match
    // build_packs.py and avoid copying a large 3D `last_hidden_state` across JSI.
    const outName =
      sess.outputNames.find((n) => n.includes('sentence_embedding')) ??
      sess.outputNames.find((n) => n === 'pooler_output' || n.includes('pooler_output')) ??
      sess.outputNames[0];

    const results = await sess.run(feeds, outName ? [outName] : undefined);
    const outputTensor = outName ? results[outName] : undefined;
    if (!outputTensor) {
      lastEmbeddingError = 'Embedder returned no output tensor.';
      return null;
    }

    const dims = outputTensor.dims;
    let pooled: Float32Array;

    if (dims.length === 2) {
      // Already pooled [1, hidden_dim] -> MRL slice to 512d
      const hiddenDim = dims[1];
      const outDim = Math.min(hiddenDim, EMBEDDING_DIM);
      pooled = new Float32Array(outDim);
      for (let d = 0; d < outDim; d++) {
        pooled[d] = outputTensor.data[d];
      }
    } else {
      // Token-level [1, seq_len, hidden_dim] -> masked mean pool + MRL slice to 512d
      const seqLen = dims[1];
      const hiddenDim = dims[2] ?? EMBEDDING_DIM;
      const outDim = Math.min(hiddenDim, EMBEDDING_DIM);
      pooled = new Float32Array(outDim);
      let count = 0;
      for (let t = 0; t < seqLen; t++) {
        if (attentionMask[t] === 1) {
          const base = t * hiddenDim;
          for (let d = 0; d < outDim; d++) {
            pooled[d] += outputTensor.data[base + d];
          }
          count++;
        }
      }
      if (count === 0) return null;
      for (let d = 0; d < outDim; d++) {
        pooled[d] /= count;
      }
    }

    return l2Normalize(pooled);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastEmbeddingError = `Embedding inference failed: ${msg}`;
    console.warn('[embeddingService] embedRawText failed:', err);
    return null;
  }
}

/** Embed a user journal query (applies Voyage-4-Nano query instruction prefix). */
export async function embedQuery(text: string): Promise<Float32Array | null> {
  return embedRawText(`${VOYAGE_QUERY_PREFIX}${text.trim()}`);
}

/** Embed a Library or Personal Library passage (exact bake-off v2 document prefix). */
export async function embedPassage(
  text: string,
  titleContext?: string | null
): Promise<Float32Array | null> {
  const payload =
    titleContext && titleContext.trim().length > 0
      ? `${VOYAGE_DOC_PREFIX}[${titleContext.trim()}]\n${text.trim()}`
      : `${VOYAGE_DOC_PREFIX}${text.trim()}`;
  return embedRawText(payload);
}

/** Backward-compatible alias used by existing journal callers. */
export async function embedText(text: string): Promise<Float32Array | null> {
  return embedQuery(text);
}
