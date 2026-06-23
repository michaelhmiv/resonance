/**
 * Reflection prompt service — optional LLM-generated prompts from the
 * user's journal patterns using Qwen 2.5 1.5B via llama.rn.
 *
 * This is entirely opt-in (separate from the embedding model). The LLM
 * generates gentle reflection questions from journal clusters — never
 * writes prayers, interprets Scripture, or offers advice.
 *
 * (design spec §7.3 — LLM enhancement layer: opt-in, separate from
 *  embeddings, pre-computed daily/weekly, no loading indicators)
 */

import { Platform } from 'react-native';

export interface ReflectionPrompt {
  prompt: string;
  generatedAt: number;
}

// ── LLM session (llama.rn) ──────────────────────────────────────────────────

let llmSession: unknown | null = null;
let llmLoaded = false;

export type LlmModelId = 'qwen-2.5-1.5b' | 'none';

export interface LlmModelInfo {
  id: LlmModelId;
  label: string;
  sizeMb: number;
  license: string;
}

export const LLM_MODELS: readonly LlmModelInfo[] = [
  {
    id: 'qwen-2.5-1.5b',
    label: 'Qwen 2.5 1.5B (Q4)',
    sizeMb: 1024,
    license: 'Apache 2.0',
  },
] as const;

/**
 * Initialize the LLM session. Returns true if the model loaded successfully.
 * On platforms where llama.rn isn't linked, returns false (LLM features
 * simply don't appear).
 */
export async function initLlm(modelId: LlmModelId): Promise<boolean> {
  if (llmLoaded) return true;
  if (modelId === 'none') return false;
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;

  try {
    // Dynamic import so tsc doesn't require the native module.
    const { LlamaModel, LlamaContext } = await import('llama.rn');

    const modelPath = `models/${modelId}/model.gguf`;
    const model = await LlamaModel.create({
      model: modelPath,
      n_ctx: 2048,
      n_gpu_layers: 0,
      n_threads: 4,
    });
    llmSession = await LlamaContext.create(model, {
      n_ctx: 2048,
      temperature: 0.7,
      top_p: 0.8,
      top_k: 40,
    });
    llmLoaded = true;
    return true;
  } catch {
    llmLoaded = false;
    return false;
  }
}

export function isLlmReady(): boolean {
  return llmLoaded;
}

// ── Reflection prompt generation ─────────────────────────────────────────────

/**
 * System prompt template for the LLM. Strictly forbids:
 * - Writing prayers
 * - Interpreting Scripture
 * - Offering advice
 * - Generating devotional content
 *
 * Only generates a gentle reflection question.
 */
const SYSTEM_PROMPT = `You are a reflective journal companion. Given excerpts from a personal journal, generate ONE gentle, open-ended reflection question. Rules:
- Never write prayers
- Never interpret Scripture or offer spiritual guidance
- Never give advice
- Never generate devotional content
- Ask about patterns, feelings, or what the writer notices
- Keep it under 25 words
- Write in a warm, simple, non-religious tone
Output only the question, nothing else.`;

/**
 * Generate a single reflection prompt from journal excerpts. Returns null
 * if the LLM isn't loaded. Used for daily/weekly pre-computed prompts.
 */
export async function generateReflectionPrompt(
  journalExcerpts: string[]
): Promise<ReflectionPrompt | null> {
  if (!llmLoaded || !llmSession || journalExcerpts.length === 0) return null;

  try {
    const excerpts = journalExcerpts
      .slice(0, 5)
      .map((e) => e.slice(0, 200))
      .join('\n---\n');

    const prompt = `${SYSTEM_PROMPT}\n\nJournal excerpts:\n${excerpts}\n\nReflection question:`;

    const completion = await (llmSession as {
      completion: (args: { prompt: string; max_tokens: number }) => Promise<{ text: string }>;
    }).completion({
      prompt,
      max_tokens: 60,
    });

    const text = completion.text.trim();
    if (text.length === 0) return null;

    return {
      prompt: text,
      generatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

// ── Cluster labeling ────────────────────────────────────────────────────────

/**
 * Generate short labels (2-3 words) for clusters of similar journal
 * entries. Returns null if LLM isn't loaded.
 */
export async function generateClusterLabel(
  entryExcerpts: string[]
): Promise<string | null> {
  if (!llmLoaded || !llmSession || entryExcerpts.length === 0) return null;

  try {
    const excerpts = entryExcerpts
      .slice(0, 3)
      .map((e) => e.slice(0, 150))
      .join('\n');

    const prompt = `Summarize these journal entries in 2-3 words. Output only the label:\n${excerpts}\n\nLabel:`;

    const completion = await (llmSession as {
      completion: (args: { prompt: string; max_tokens: number }) => Promise<{ text: string }>;
    }).completion({
      prompt,
      max_tokens: 15,
    });

    const text = completion.text.trim();
    if (text.length === 0) return null;
    return text.split('\n')[0]; // first line only
  } catch {
    return null;
  }
}

// ── "What shifted" narrative ───────────────────────────────────────────────

/**
 * Generate a brief comparative narrative between two time periods.
 * Returns null if LLM isn't loaded.
 */
export async function generateShiftNarrative(
  period1Excerpts: string[],
  period2Excerpts: string[]
): Promise<string | null> {
  if (!llmLoaded || !llmSession) return null;

  try {
    const p1 = period1Excerpts.slice(0, 3).map((e) => e.slice(0, 150)).join('\n');
    const p2 = period2Excerpts.slice(0, 3).map((e) => e.slice(0, 150)).join('\n');

    const prompt = `Compare these two sets of journal entries. Write 2-3 sentences describing what shifted between them. Do not give advice.\n\nEarlier:\n${p1}\n\nLater:\n${p2}\n\nWhat shifted:`;

    const completion = await (llmSession as {
      completion: (args: { prompt: string; max_tokens: number }) => Promise<{ text: string }>;
    }).completion({
      prompt,
      max_tokens: 80,
    });

    const text = completion.text.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

export async function disposeLlm(): Promise<void> {
  if (llmSession) {
    try {
      const s = llmSession as { stop?: () => void; close?: () => void };
      s.stop?.();
      s.close?.();
    } catch {
      // ignore
    }
    llmSession = null;
    llmLoaded = false;
  }
}
