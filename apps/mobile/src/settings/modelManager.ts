/**
 * Model manager — the bridge between Settings and the on-device model
 * sessions. Tapping a model in Settings goes through here.
 *
 * This is intentionally a thin stub for now: it triggers the embedding
 * service's `initEmbeddingModel` (which gracefully degrades when the ONNX
 * native module isn't linked) and the LLM loader. A production build would
 * also re-index existing journal vectors after an embedding-model switch.
 *
 * (design spec §7.1, §7.3; implementation plan Task 7.1)
 */

import { initEmbeddingModel } from '../embedding/embeddingService';
import { initLlm, disposeLlm } from '../embedding/reflectionService';
import type { EmbeddingModelId } from '@resonance/core';
import type { LlmModelId } from '@resonance/core';

/**
 * Switch the active embedding model. Replaces the live ONNX session. Returns
 * true if the new session initialized.
 */
export async function switchEmbeddingModel(
  id: EmbeddingModelId
): Promise<boolean> {
  return initEmbeddingModel(id);
}

/**
 * Enable or disable the reflection (LLM) layer. When enabling, the Qwen model
 * is loaded; when disabling, the session is torn down.
 */
export async function setLlmActive(
  modelId: LlmModelId,
  enabled: boolean
): Promise<boolean> {
  if (!enabled) {
    await disposeLlm();
    return true;
  }
  if (modelId === 'deepseek-v4-pro') {
    // DeepSeek is a cloud-only premium/web model. The local mobile manager must
    // not pass it to llama.rn; premium mobile will use the cloud DataLayer.
    await disposeLlm();
    return false;
  }
  return initLlm(modelId);
}
