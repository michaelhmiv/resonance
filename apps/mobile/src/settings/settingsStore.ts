/**
 * Settings store — every user preference, persisted to the local
 * `app_settings` key/value table. Nothing here ever leaves the device.
 *
 * The defaults are deliberately quiet and reverent: embeddings on (pure
 * local math), the reflection LLM off, cream paper, a calm medium serif
 * for reading.
 *
 * Accessibility options actually affect the app: `textScale` and
 * `readingFontSize` are consumed via `useReadingTextStyle()` by the
 * reading surfaces (Journal, Word) so the Settings choices are live.
 *
 * (design spec §8.2 — Settings; implementation plan Task 7.1)
 */

import { create } from 'zustand';
import type { TextStyle } from 'react-native';

import { getDatabase } from '../db/database';
import type { EmbeddingModelId } from '@resonance/core';
import type { LlmModelId } from '@resonance/core';
import { serifText } from '@resonance/theme';

// ── Setting value types ───────────────────────────────────────────────────

export type TextScale = 'small' | 'medium' | 'large' | 'extra_large';
export type ReadingFontSize = 'small' | 'medium' | 'large';
export type ThemeMode = 'auto' | 'light';
export type TranslationPref = 'WEB' | 'KJV';

export interface Settings {
  /** Which embedding model is active for the resonance layer. */
  embeddingModel: EmbeddingModelId;
  /** Opt-in reflection (LLM) layer. Off by default. */
  llmEnabled: boolean;
  /** Which LLM model is used when llmEnabled. */
  llmModel: LlmModelId;
  /** Serif body size for reading surfaces. */
  readingFontSize: ReadingFontSize;
  /** Default Scripture translation in the Word tab. */
  readingTranslation: TranslationPref;
  /** 'auto' follows the system setting; 'light' is forced. */
  theme: ThemeMode;
  /** Accessibility: system-wide text scale. */
  textScale: TextScale;
  /** Accessibility: dampen animations to plain fades. */
  reduceMotion: boolean;
  /** App lock (biometric) — stub for now. */
  appLockEnabled: boolean;
  /** Automatically embed newly added Personal Library files on-device (default on). */
  autoEmbedPersonalFiles: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  embeddingModel: 'voyage-4-nano',
  llmEnabled: false,
  llmModel: 'none',
  readingFontSize: 'medium',
  readingTranslation: 'WEB',
  theme: 'auto',
  textScale: 'medium',
  reduceMotion: false,
  appLockEnabled: false,
  autoEmbedPersonalFiles: true,
};

// ── DB keys (columns are TEXT — primitives are serialized as strings) ─────

export const AUTO_EMBED_PERSONAL_FILES_KEY = 'auto_embed_personal_files';

const KEYS = {
  embeddingModel: 'embedding_model',
  llmEnabled: 'llm_enabled',
  llmModel: 'llm_model',
  readingFontSize: 'reading_font_size',
  readingTranslation: 'reading_translation',
  theme: 'theme',
  textScale: 'text_scale',
  reduceMotion: 'reduce_motion',
  appLockEnabled: 'app_lock_enabled',
  autoEmbedPersonalFiles: AUTO_EMBED_PERSONAL_FILES_KEY,
} as const;

// ── Store ─────────────────────────────────────────────────────────────────

interface SettingsStoreState extends Settings {
  /** True once settings have been read from SQLite. */
  loaded: boolean;

  /** Read every row from `app_settings` and merge into state. */
  load: () => Promise<void>;

  setEmbeddingModel: (id: EmbeddingModelId) => void;
  setLlmEnabled: (enabled: boolean) => void;
  setReadingFontSize: (s: ReadingFontSize) => void;
  setReadingTranslation: (t: TranslationPref) => void;
  setTheme: (t: ThemeMode) => void;
  setTextScale: (s: TextScale) => void;
  setReduceMotion: (v: boolean) => void;
  setAppLockEnabled: (v: boolean) => void;
  setAutoEmbedPersonalFiles: (v: boolean) => void;
}

// ── Persistence helpers ───────────────────────────────────────────────────

/** Upsert a single setting row. Fire-and-forget — UI updates immediately. */
function persist(key: string, value: string): void {
  const db = getDatabase();
  if (!db) return;
  db.runAsync(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [key, value]
  ).catch(() => {
    // Swallow — preferences are best-effort; the UI already reflects the
    // new value in memory and a retry on next change is harmless.
  });
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === null) return fallback;
  return v === 'true';
}

function coerce<T extends string>(
  v: string | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

// ── Font scale math ───────────────────────────────────────────────────────

const READING_FONT_BASE: Record<ReadingFontSize, number> = {
  small: 16,
  medium: 18,
  large: 20,
};

const TEXT_SCALE_MULTIPLIER: Record<TextScale, number> = {
  small: 0.9,
  medium: 1.0,
  large: 1.12,
  extra_large: 1.25,
};

/**
 * Live reading-text style derived from the user's font-size and accessibility
 * scale. Reading surfaces call this instead of hardcoding fontSize so the
 * Settings choices take effect immediately.
 */
export function useReadingTextStyle(): TextStyle {
  const readingFontSize = useSettingsStore((s) => s.readingFontSize);
  const textScale = useSettingsStore((s) => s.textScale);

  const base = READING_FONT_BASE[readingFontSize];
  const mult = TEXT_SCALE_MULTIPLIER[textScale];
  const fontSize = Math.round(base * mult);
  const lineHeight = Math.round(fontSize * 1.55);

  return {
    ...serifText,
    fontSize,
    lineHeight,
    color: serifText.color,
  };
}

// ── Store implementation ──────────────────────────────────────────────────

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,

  async load() {
    const db = getDatabase();
    if (!db) return;
    try {
      const rows = await db.getAllAsync<{ key: string; value: string }>(
        `SELECT key, value FROM app_settings;`
      );
      const map = new Map<string, string>();
      for (const r of rows) map.set(r.key, r.value);

      set({
        embeddingModel: coerce<EmbeddingModelId>(
          map.get(KEYS.embeddingModel),
          ['gte-small', 'bge-small-en', 'all-minilm-l6'],
          DEFAULT_SETTINGS.embeddingModel
        ),
        llmEnabled: parseBool(
          map.get(KEYS.llmEnabled),
          DEFAULT_SETTINGS.llmEnabled
        ),
        llmModel: coerce<LlmModelId>(
          map.get(KEYS.llmModel),
          ['qwen-2.5-1.5b', 'none'],
          DEFAULT_SETTINGS.llmModel
        ),
        readingFontSize: coerce<ReadingFontSize>(
          map.get(KEYS.readingFontSize),
          ['small', 'medium', 'large'],
          DEFAULT_SETTINGS.readingFontSize
        ),
        readingTranslation: coerce<TranslationPref>(
          map.get(KEYS.readingTranslation),
          ['WEB', 'KJV'],
          DEFAULT_SETTINGS.readingTranslation
        ),
        theme: coerce<ThemeMode>(
          map.get(KEYS.theme),
          ['auto', 'light'],
          DEFAULT_SETTINGS.theme
        ),
        textScale: coerce<TextScale>(
          map.get(KEYS.textScale),
          ['small', 'medium', 'large', 'extra_large'],
          DEFAULT_SETTINGS.textScale
        ),
        reduceMotion: parseBool(
          map.get(KEYS.reduceMotion),
          DEFAULT_SETTINGS.reduceMotion
        ),
        appLockEnabled: parseBool(
          map.get(KEYS.appLockEnabled),
          DEFAULT_SETTINGS.appLockEnabled
        ),
        autoEmbedPersonalFiles: parseBool(
          map.get(KEYS.autoEmbedPersonalFiles),
          DEFAULT_SETTINGS.autoEmbedPersonalFiles
        ),
        loaded: true,
      });
    } catch {
      // If the table isn't there yet, keep defaults in memory.
      set({ loaded: true });
    }
  },

  setEmbeddingModel(id) {
    set({ embeddingModel: id });
    persist(KEYS.embeddingModel, id);
  },
  setLlmEnabled(enabled) {
    set({ llmEnabled: enabled });
    persist(KEYS.llmEnabled, enabled ? 'true' : 'false');
  },
  setReadingFontSize(s) {
    set({ readingFontSize: s });
    persist(KEYS.readingFontSize, s);
  },
  setReadingTranslation(t) {
    set({ readingTranslation: t });
    persist(KEYS.readingTranslation, t);
  },
  setTheme(t) {
    set({ theme: t });
    persist(KEYS.theme, t);
  },
  setTextScale(s) {
    set({ textScale: s });
    persist(KEYS.textScale, s);
  },
  setReduceMotion(v) {
    set({ reduceMotion: v });
    persist(KEYS.reduceMotion, v ? 'true' : 'false');
  },
  setAppLockEnabled(v) {
    set({ appLockEnabled: v });
    persist(KEYS.appLockEnabled, v ? 'true' : 'false');
  },
  setAutoEmbedPersonalFiles(v) {
    set({ autoEmbedPersonalFiles: v });
    persist(KEYS.autoEmbedPersonalFiles, v ? 'true' : 'false');
  },
}));
