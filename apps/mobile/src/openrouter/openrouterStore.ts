/**
 * OpenRouter BYOK Store — encrypted key storage (`expo-secure-store`),
 * routing mode, per-feature toggles, selected model IDs, Zero Data Retention,
 * and local usage/spend tracking.
 *
 * Zero-cloud default: until a user explicitly saves an OpenRouter API key and
 * enables a cloud routing mode, nothing leaves the device.
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_RERANKER_MODEL,
  DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL,
  DEFAULT_OPENROUTER_VISION_MODEL,
  getVectorSpaceId,
  isVoyage4SharedSpace,
  type OpenRouterFeatureFlags,
  type OpenRouterKeyStatus,
  type OpenRouterRoutingMode,
  type OpenRouterTaskKind,
  type OpenRouterUsageSummary,
} from '@resonance/core';
import { getDatabase } from '../db/database';

const SECURE_KEY_NAME = 'resonance_openrouter_api_key_v1';

const SETTINGS_KEYS = {
  routingMode: 'or_routing_mode',
  features: 'or_features_json',
  embeddingModel: 'or_embedding_model',
  rerankerModel: 'or_reranker_model',
  transcriptionModel: 'or_transcription_model',
  visionModel: 'or_vision_model',
  zeroDataRetention: 'or_zdr_deny',
  monthlyBudgetUsd: 'or_monthly_budget_usd',
} as const;

export const DEFAULT_OPENROUTER_FEATURES: OpenRouterFeatureFlags = {
  embeddings: true,
  reranking: true,
  voice: true,
  photosAndVideos: true,
  scannedPdfOcr: true,
};

const EMPTY_USAGE: OpenRouterUsageSummary = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalCostUsd: 0,
  monthCostUsd: 0,
  requestCount: 0,
};

function persistSetting(key: string, value: string): void {
  const db = getDatabase();
  if (!db) return;
  db.runAsync(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [key, value]
  ).catch(() => {});
}

export interface OpenRouterStoreState {
  loaded: boolean;
  /** Stored securely in Android Keystore / iOS Keychain (cached in memory). */
  apiKey: string | null;
  hasKey: boolean;
  keyStatus: OpenRouterKeyStatus | null;
  routingMode: OpenRouterRoutingMode;
  features: OpenRouterFeatureFlags;
  embeddingModel: string;
  rerankerModel: string;
  transcriptionModel: string;
  visionModel: string;
  zeroDataRetention: boolean;
  monthlyBudgetUsd: number | null;
  creditsExhausted: boolean;
  lastError: string | null;
  usage: OpenRouterUsageSummary;

  load: () => Promise<void>;
  saveApiKey: (rawKey: string) => Promise<void>;
  clearApiKey: () => Promise<void>;
  setKeyStatus: (status: OpenRouterKeyStatus | null) => void;
  setRoutingMode: (mode: OpenRouterRoutingMode) => void;
  setFeature: <K extends keyof OpenRouterFeatureFlags>(
    key: K,
    enabled: boolean
  ) => void;
  setEmbeddingModel: (modelId: string) => void;
  setRerankerModel: (modelId: string) => void;
  setTranscriptionModel: (modelId: string) => void;
  setVisionModel: (modelId: string) => void;
  setZeroDataRetention: (deny: boolean) => void;
  setMonthlyBudgetUsd: (usd: number | null) => void;
  setCreditsExhausted: (exhausted: boolean, message?: string | null) => void;
  setLastError: (err: string | null) => void;
  recordUsage: (entry: {
    taskKind: OpenRouterTaskKind;
    modelId: string;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
  }) => Promise<void>;
  refreshUsageSummary: () => Promise<void>;
  resetUsageLog: () => Promise<void>;
}

export const useOpenRouterStore = create<OpenRouterStoreState>((set, get) => ({
  loaded: false,
  apiKey: null,
  hasKey: false,
  keyStatus: null,
  routingMode: 'local_only',
  features: { ...DEFAULT_OPENROUTER_FEATURES },
  embeddingModel: DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  rerankerModel: DEFAULT_OPENROUTER_RERANKER_MODEL,
  transcriptionModel: DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL,
  visionModel: DEFAULT_OPENROUTER_VISION_MODEL,
  zeroDataRetention: true,
  monthlyBudgetUsd: null,
  creditsExhausted: false,
  lastError: null,
  usage: { ...EMPTY_USAGE },

  async load() {
    let storedKey: string | null = null;
    try {
      storedKey = (await SecureStore.getItemAsync(SECURE_KEY_NAME))?.trim() || null;
    } catch {
      storedKey = null;
    }

    const db = getDatabase();
    let routingMode: OpenRouterRoutingMode = 'local_only';
    let features: OpenRouterFeatureFlags = { ...DEFAULT_OPENROUTER_FEATURES };
    let embeddingModel = DEFAULT_OPENROUTER_EMBEDDING_MODEL;
    let rerankerModel = DEFAULT_OPENROUTER_RERANKER_MODEL;
    let transcriptionModel = DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL;
    let visionModel = DEFAULT_OPENROUTER_VISION_MODEL;
    let zeroDataRetention = true;
    let monthlyBudgetUsd: number | null = null;

    if (db) {
      try {
        const rows = await db.getAllAsync<{ key: string; value: string }>(
          `SELECT key, value FROM app_settings WHERE key LIKE 'or_%';`
        );
        const map = new Map<string, string>();
        for (const r of rows) map.set(r.key, r.value);

        const rawMode = map.get(SETTINGS_KEYS.routingMode);
        if (
          rawMode === 'local_only' ||
          rawMode === 'cloud_with_fallback' ||
          rawMode === 'hybrid_books_only'
        ) {
          routingMode = rawMode;
        } else if (storedKey) {
          routingMode = 'cloud_with_fallback';
        }

        const rawFeatures = map.get(SETTINGS_KEYS.features);
        if (rawFeatures) {
          try {
            const parsed = JSON.parse(rawFeatures) as Partial<OpenRouterFeatureFlags>;
            features = { ...DEFAULT_OPENROUTER_FEATURES, ...parsed };
          } catch {
            // ignore malformed JSON
          }
        }

        if (map.get(SETTINGS_KEYS.embeddingModel)) {
          embeddingModel = map.get(SETTINGS_KEYS.embeddingModel)!.trim();
        }
        if (map.get(SETTINGS_KEYS.rerankerModel)) {
          rerankerModel = map.get(SETTINGS_KEYS.rerankerModel)!.trim();
        }
        if (map.get(SETTINGS_KEYS.transcriptionModel)) {
          transcriptionModel = map.get(SETTINGS_KEYS.transcriptionModel)!.trim();
        }
        if (map.get(SETTINGS_KEYS.visionModel)) {
          visionModel = map.get(SETTINGS_KEYS.visionModel)!.trim();
        }
        if (map.has(SETTINGS_KEYS.zeroDataRetention)) {
          zeroDataRetention = map.get(SETTINGS_KEYS.zeroDataRetention) !== 'false';
        }
        const rawBudget = map.get(SETTINGS_KEYS.monthlyBudgetUsd);
        if (rawBudget && rawBudget !== 'null') {
          const parsed = Number(rawBudget);
          if (Number.isFinite(parsed) && parsed > 0) {
            monthlyBudgetUsd = parsed;
          }
        }
      } catch {
        // ignore pre-init read issues
      }
    }

    // Never leave hybrid_books_only active if user moved to a non-Voyage space
    if (routingMode === 'hybrid_books_only' && !isVoyage4SharedSpace(embeddingModel)) {
      routingMode = 'cloud_with_fallback';
    }

    set({
      loaded: true,
      apiKey: storedKey,
      hasKey: Boolean(storedKey),
      routingMode: storedKey ? routingMode : 'local_only',
      features,
      embeddingModel,
      rerankerModel,
      transcriptionModel,
      visionModel,
      zeroDataRetention,
      monthlyBudgetUsd,
    });

    await get().refreshUsageSummary();
  },

  async saveApiKey(rawKey: string) {
    const cleaned = rawKey.trim();
    if (!cleaned) {
      await get().clearApiKey();
      return;
    }
    try {
      await SecureStore.setItemAsync(SECURE_KEY_NAME, cleaned);
    } catch (err) {
      console.warn('[openrouterStore] SecureStore save failed:', err);
    }
    const nextMode: OpenRouterRoutingMode =
      get().routingMode === 'local_only' ? 'cloud_with_fallback' : get().routingMode;
    persistSetting(SETTINGS_KEYS.routingMode, nextMode);
    set({
      apiKey: cleaned,
      hasKey: true,
      routingMode: nextMode,
      creditsExhausted: false,
      lastError: null,
    });
  },

  async clearApiKey() {
    try {
      await SecureStore.deleteItemAsync(SECURE_KEY_NAME);
    } catch {
      // ignore
    }
    persistSetting(SETTINGS_KEYS.routingMode, 'local_only');
    set({
      apiKey: null,
      hasKey: false,
      keyStatus: null,
      routingMode: 'local_only',
      creditsExhausted: false,
      lastError: null,
    });
  },

  setKeyStatus(status) {
    set({
      keyStatus: status,
      creditsExhausted: status?.valid ? false : get().creditsExhausted,
    });
  },

  setRoutingMode(mode) {
    // Hybrid mode requires shared Voyage-4 space so books + local journal match
    const effectiveMode: OpenRouterRoutingMode =
      mode === 'hybrid_books_only' && !isVoyage4SharedSpace(get().embeddingModel)
        ? 'cloud_with_fallback'
        : mode;
    persistSetting(SETTINGS_KEYS.routingMode, effectiveMode);
    set({ routingMode: effectiveMode, creditsExhausted: false, lastError: null });
  },

  setFeature(key, enabled) {
    const next = { ...get().features, [key]: enabled };
    persistSetting(SETTINGS_KEYS.features, JSON.stringify(next));
    set({ features: next });
  },

  setEmbeddingModel(modelId) {
    const cleaned = modelId.trim() || DEFAULT_OPENROUTER_EMBEDDING_MODEL;
    persistSetting(SETTINGS_KEYS.embeddingModel, cleaned);
    const currentMode = get().routingMode;
    const nextMode: OpenRouterRoutingMode =
      currentMode === 'hybrid_books_only' && !isVoyage4SharedSpace(cleaned)
        ? 'cloud_with_fallback'
        : currentMode;
    if (nextMode !== currentMode) {
      persistSetting(SETTINGS_KEYS.routingMode, nextMode);
    }
    set({ embeddingModel: cleaned, routingMode: nextMode });
  },

  setRerankerModel(modelId) {
    const cleaned = modelId.trim() || DEFAULT_OPENROUTER_RERANKER_MODEL;
    persistSetting(SETTINGS_KEYS.rerankerModel, cleaned);
    set({ rerankerModel: cleaned });
  },

  setTranscriptionModel(modelId) {
    const cleaned = modelId.trim() || DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL;
    persistSetting(SETTINGS_KEYS.transcriptionModel, cleaned);
    set({ transcriptionModel: cleaned });
  },

  setVisionModel(modelId) {
    const cleaned = modelId.trim() || DEFAULT_OPENROUTER_VISION_MODEL;
    persistSetting(SETTINGS_KEYS.visionModel, cleaned);
    set({ visionModel: cleaned });
  },

  setZeroDataRetention(deny) {
    persistSetting(SETTINGS_KEYS.zeroDataRetention, String(deny));
    set({ zeroDataRetention: deny });
  },

  setMonthlyBudgetUsd(usd) {
    const valid = usd != null && Number.isFinite(usd) && usd > 0 ? usd : null;
    persistSetting(SETTINGS_KEYS.monthlyBudgetUsd, valid === null ? 'null' : String(valid));
    set({ monthlyBudgetUsd: valid });
  },

  setCreditsExhausted(exhausted, message = null) {
    set({ creditsExhausted: exhausted, lastError: message ?? get().lastError });
  },

  setLastError(err) {
    set({ lastError: err });
  },

  async recordUsage(entry) {
    const db = getDatabase();
    if (!db) return;
    const id = `oru_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await db.runAsync(
        `INSERT INTO openrouter_usage_log
           (id, task_kind, model_id, prompt_tokens, completion_tokens, estimated_cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [
          id,
          entry.taskKind,
          entry.modelId,
          Math.max(0, Math.round(entry.promptTokens)),
          Math.max(0, Math.round(entry.completionTokens)),
          Math.max(0, entry.estimatedCostUsd),
          Date.now(),
        ]
      );
      await get().refreshUsageSummary();
    } catch {
      // non-fatal
    }
  },

  async refreshUsageSummary() {
    const db = getDatabase();
    if (!db) return;
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const totals = await db.getFirstAsync<{
        pt: number | null;
        ct: number | null;
        cost: number | null;
        cnt: number | null;
      }>(
        `SELECT SUM(prompt_tokens) AS pt, SUM(completion_tokens) AS ct,
                SUM(estimated_cost_usd) AS cost, COUNT(*) AS cnt
         FROM openrouter_usage_log;`
      );
      const monthly = await db.getFirstAsync<{ cost: number | null }>(
        `SELECT SUM(estimated_cost_usd) AS cost
         FROM openrouter_usage_log
         WHERE created_at >= ?;`,
        [monthStart]
      );
      set({
        usage: {
          totalPromptTokens: totals?.pt ?? 0,
          totalCompletionTokens: totals?.ct ?? 0,
          totalCostUsd: totals?.cost ?? 0,
          monthCostUsd: monthly?.cost ?? 0,
          requestCount: totals?.cnt ?? 0,
        },
      });
    } catch {
      // Table may not exist yet before v5 migration
    }
  },

  async resetUsageLog() {
    const db = getDatabase();
    if (!db) return;
    try {
      await db.runAsync(`DELETE FROM openrouter_usage_log;`);
      set({ usage: { ...EMPTY_USAGE } });
    } catch {
      // non-fatal
    }
  },
}));

// ── Synchronous routing selectors ──────────────────────────────────────────

export function isOpenRouterEnabledForFeature(
  feature: keyof OpenRouterFeatureFlags,
  scope: 'books' | 'journal' | 'general' = 'general'
): boolean {
  const s = useOpenRouterStore.getState();
  if (!s.hasKey || !s.apiKey || s.routingMode === 'local_only' || s.creditsExhausted) {
    return false;
  }
  if (!s.features[feature]) return false;
  if (s.routingMode === 'hybrid_books_only') {
    // Hybrid mode only routes books/PDF OCR to OpenRouter; journal/voice/photos stay local
    return scope === 'books' && (feature === 'embeddings' || feature === 'scannedPdfOcr');
  }
  return true;
}

/** True when the user has unlocked the OpenRouter-gated Multimodal Life Diary. */
export function isLifeDiaryMediaEnabled(): boolean {
  const s = useOpenRouterStore.getState();
  return (
    s.hasKey &&
    s.routingMode === 'cloud_with_fallback' &&
    (s.features.voice || s.features.photosAndVideos)
  );
}

/**
 * Returns the active embedding model ID for the requested scope.
 * When OpenRouter embeddings are active, returns the configured OpenRouter model;
 * otherwise returns the local `voyage-4-nano` model.
 */
export function getActiveEmbeddingModelId(
  scope: 'books' | 'journal' | 'search' = 'search'
): string {
  const s = useOpenRouterStore.getState();
  if (s.hasKey && s.routingMode !== 'local_only' && s.features.embeddings) {
    if (s.routingMode === 'hybrid_books_only') {
      return scope === 'books' ? s.embeddingModel : DEFAULT_LOCAL_EMBEDDING_MODEL;
    }
    return s.embeddingModel;
  }
  return DEFAULT_LOCAL_EMBEDDING_MODEL;
}

/** Canonical vector-space ID currently active for retrieval & storage. */
export function getActiveVectorSpaceId(): string {
  return getVectorSpaceId(getActiveEmbeddingModelId('search'));
}

/** True if the active retrieval space is compatible with shipped 512d Voyage-4 `.rvec` packs. */
export function isActiveSpaceVoyage4(): boolean {
  return isVoyage4SharedSpace(getActiveEmbeddingModelId('search'));
}

/** True when the user's monthly OpenRouter spend exceeded their optional warning threshold. */
export function isMonthlyBudgetExceeded(): boolean {
  const s = useOpenRouterStore.getState();
  return s.monthlyBudgetUsd != null && s.usage.monthCostUsd >= s.monthlyBudgetUsd;
}
