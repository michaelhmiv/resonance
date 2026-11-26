/**
 * Reranker service — on-device pointwise Yes/No scoring via Qwen3-Reranker-0.6B
 * INT8 ONNX (`n24q02m/Qwen3-Reranker-0.6B-ONNX`, `model_yesno_quantized.onnx`).
 *
 * Zero generated prose: the reranker outputs ONLY a calibrated probability
 * `P(yes) = sigmoid(logit_yes - logit_no)` judging whether a candidate passage
 * is a faithful, pastoral echo of the user's journal entry (bake-off v2).
 *
 * All inference stays on the device. Nothing leaves the phone.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  QWEN3_RERANKER_INSTRUCTION,
  type RerankerModelId,
} from '@resonance/core';
import { getRerankerModelPaths } from '../packages/offlineEngineManager';

interface RerankerTokenizer {
  vocab: Map<string, number>;
  unkId: number;
  maxLen: number;
}

let session: unknown | null = null;
let tokenizer: RerankerTokenizer | null = null;
let activeRerankerId: RerankerModelId = 'none';

export function isRerankerReady(): boolean {
  return session !== null && tokenizer !== null && activeRerankerId === 'qwen3-reranker-0.6b';
}

export function getActiveRerankerModel(): RerankerModelId {
  return activeRerankerId;
}

export async function disposeReranker(): Promise<void> {
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
  tokenizer = null;
  activeRerankerId = 'none';
}

async function loadRerankerTokenizer(path: string): Promise<RerankerTokenizer | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    const parsed = JSON.parse(raw) as {
      model?: { vocab?: Record<string, number> };
      added_tokens?: Array<{ id: number; content: string }>;
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
    const unkId = vocab.get('<|endoftext|>') ?? vocab.get('<unk>') ?? 0;
    return { vocab, unkId, maxLen: 768 };
  } catch {
    return null;
  }
}

/**
 * Format a (journal query, candidate passage) pair using the exact chat
 * template validated in `scripts/bakeoff/rerank_qwen3.py`.
 */
export function formatQwen3RerankerPrompt(
  query: string,
  passageText: string,
  sourceLabel?: string
): string {
  const doc = sourceLabel ? `[${sourceLabel}] ${passageText}` : passageText;
  return (
    `<|im_start|>system\n` +
    `Judge whether the Document meets the requirements based on the Query and the Instruct provided. ` +
    `Note that the answer can only be "yes" or "no".<|im_end|>\n` +
    `<|im_start|>user\n` +
    `<Instruct>: ${QWEN3_RERANKER_INSTRUCTION}\n` +
    `<Query>: ${query.trim()}\n` +
    `<Document>: ${doc.trim()}<|im_end|>\n` +
    `<|im_start|>assistant\n<think>\n\n</think>\n\n`
  );
}

function encodePrompt(tok: RerankerTokenizer, text: string): number[] {
  const ids: number[] = [];
  // Split around Qwen3 special tokens first so they map to exact token IDs
  const segments = text.split(/(<\|im_start\|>|<\|im_end\|>|<think>|<\/think>|\n)/g);
  for (const seg of segments) {
    if (!seg || ids.length >= tok.maxLen) continue;
    const specialId = tok.vocab.get(seg);
    if (specialId !== undefined) {
      ids.push(specialId);
      continue;
    }
    const words = seg.split(/(\s+)/);
    for (let i = 0; i < words.length && ids.length < tok.maxLen; i++) {
      const w = words[i];
      if (!w || /^\s+$/.test(w)) continue;
      const hit =
        (i > 0 ? tok.vocab.get(`\u0120${w}`) : undefined) ??
        tok.vocab.get(w) ??
        tok.vocab.get(`\u0120${w.toLowerCase()}`) ??
        tok.vocab.get(w.toLowerCase());
      if (hit !== undefined) {
        ids.push(hit);
        continue;
      }
      // Subword fallback
      let pos = 0;
      while (pos < w.length && ids.length < tok.maxLen) {
        let bestEnd = pos + 1;
        let bestId = tok.unkId;
        const limit = Math.min(w.length, pos + 16);
        for (let end = limit; end > pos; end--) {
          const sub = w.slice(pos, end);
          const id =
            (pos === 0 && i > 0 ? tok.vocab.get(`\u0120${sub}`) : undefined) ??
            tok.vocab.get(sub);
          if (id !== undefined) {
            bestEnd = end;
            bestId = id;
            break;
          }
        }
        ids.push(bestId);
        pos = bestEnd;
      }
    }
  }
  return ids;
}

export async function initRerankerModel(
  modelId: RerankerModelId = 'qwen3-reranker-0.6b'
): Promise<boolean> {
  if (modelId === 'none') {
    await disposeReranker();
    return false;
  }
  if (isRerankerReady()) return true;

  await disposeReranker();
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return false;
  }

  try {
    const paths = getRerankerModelPaths();
    const [onnxInfo, tokInfo] = await Promise.all([
      FileSystem.getInfoAsync(paths.onnxPath),
      FileSystem.getInfoAsync(paths.tokenizerPath),
    ]);
    if (!onnxInfo.exists || !tokInfo.exists) return false;

    const loadedTok = await loadRerankerTokenizer(paths.tokenizerPath);
    if (!loadedTok) return false;

    const ort = await import('onnxruntime-react-native');
    if (!ort || typeof ort.InferenceSession?.create !== 'function') {
      console.warn('[rerankerService] onnxruntime-react-native InferenceSession.create missing');
      return false;
    }
    const cleanPath = paths.onnxPath.replace(/^file:\/\//, '');
    session = await ort.InferenceSession.create(cleanPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });
    tokenizer = loadedTok;
    activeRerankerId = 'qwen3-reranker-0.6b';
    return true;
  } catch (err) {
    console.warn('[rerankerService] initRerankerModel failed:', err);
    await disposeReranker();
    return false;
  }
}

export interface RerankScore {
  prob: number;
  logit: number;
}

/**
 * Score a single (query, passage) candidate using `model_yesno_quantized.onnx`.
 * Returns calibrated `P(yes)` and `logit_yes - logit_no`, or null on fallback.
 */
export async function scoreCandidatePair(
  query: string,
  passageText: string,
  sourceLabel?: string
): Promise<RerankScore | null> {
  if (!session || !tokenizer) return null;
  try {
    const prompt = formatQwen3RerankerPrompt(query, passageText, sourceLabel);
    const inputIds = encodePrompt(tokenizer, prompt);
    if (inputIds.length === 0) return null;

    const ort = await import('onnxruntime-react-native');
    const idTensor = new ort.Tensor(
      'int64',
      BigInt64Array.from(inputIds.map(BigInt)),
      [1, inputIds.length]
    );
    const maskTensor = new ort.Tensor(
      'int64',
      BigInt64Array.from(inputIds.map(() => BigInt(1))),
      [1, inputIds.length]
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
        feeds[name] = new ort.Tensor(
          'int64',
          BigInt64Array.from(inputIds.map((_, i) => BigInt(i))),
          [1, inputIds.length]
        );
      } else if (name.includes('token_type_ids')) {
        feeds[name] = new ort.Tensor(
          'int64',
          new BigInt64Array(inputIds.length),
          [1, inputIds.length]
        );
      } else {
        feeds[name] = idTensor;
      }
    }

    const firstOut = sess.outputNames[0];
    const out = await sess.run(feeds, firstOut ? [firstOut] : undefined);
    const tensor = firstOut ? out[firstOut] : undefined;
    if (!tensor || tensor.data.length === 0) return null;

    // `model_yesno_quantized.onnx` emits either [1, 2] ([logit_no, logit_yes])
    // or [1, 1] (single yes-no margin logit).
    let diffLogit: number;
    if (tensor.data.length >= 2) {
      const logitNo = tensor.data[tensor.data.length - 2];
      const logitYes = tensor.data[tensor.data.length - 1];
      diffLogit = logitYes - logitNo;
    } else {
      diffLogit = tensor.data[0];
    }

    const prob = 1 / (1 + Math.exp(-diffLogit));
    return { prob, logit: diffLogit };
  } catch (err) {
    console.warn('[rerankerService] scoreCandidatePair failed:', err);
    return null;
  }
}
