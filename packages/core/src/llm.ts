/**
 * LLM model catalog — pure data, no platform dependencies.
 */

import type { LlmModelId, LlmModelInfo, ReflectionPrompt } from './types';

export const LLM_MODELS: readonly LlmModelInfo[] = [
  { id: 'qwen-2.5-1.5b', label: 'Qwen 2.5 1.5B (Q4 local)', sizeMb: 1024, license: 'Apache 2.0', tier: 'local' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (cloud)', sizeMb: 0, license: 'Commercial API', tier: 'cloud' },
] as const;

export const CLOUD_LLM_MODELS = LLM_MODELS.filter(m => m.tier === 'cloud');
export const LOCAL_LLM_MODELS = LLM_MODELS.filter(m => m.tier === 'local');

export const DEFAULT_CLOUD_LLM_MODEL = 'deepseek/deepseek-v4-pro';

/**
 * System prompt reused by both local (llama.rn) and cloud (OpenRouter)
 * implementations. Strictly forbids writing prayers, interpreting Scripture,
 * or offering advice. Only generates a gentle reflection question.
 */
export const REFLECTION_SYSTEM_PROMPT = `You are a reflective journal companion. Given excerpts from a personal journal, generate ONE gentle, open-ended reflection question. Rules:
- Never write prayers
- Never interpret Scripture or offer spiritual guidance
- Never give advice
- Never generate devotional content
- Ask about patterns, feelings, or what the writer notices
- Keep it under 25 words
- Write in a warm, simple, non-religious tone
Output only the question, nothing else.`;
