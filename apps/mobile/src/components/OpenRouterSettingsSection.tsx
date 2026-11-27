/**
 * Settings → OpenRouter section — encrypted BYOK key management, routing modes,
 * per-feature toggles, live searchable OpenRouter model pickers (Embedding,
 * Reranker, Transcription, Vision/Video), non-destructive Re-embed Library
 * sheet with upfront cost estimator, Zero Data Retention toggle, monthly spend
 * warning, and Storage Manager (Diary Media + Multi-Model Vectors).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  isVoyage4SharedSpace,
  type OpenRouterModelCatalogEntry,
  type OpenRouterRoutingMode,
} from '@resonance/core';
import { colors, fontFamilies, radii, spacing } from '@resonance/theme';
import {
  isMonthlyBudgetExceeded,
  useOpenRouterStore,
} from '../openrouter/openrouterStore';
import {
  fetchOpenRouterCatalog,
  verifyOpenRouterKey,
} from '../openrouter/openrouterClient';
import {
  deleteVectorsForModel,
  estimateReembedPlan,
  listStoredVectorModels,
  useReembedStore,
  type ReembedPlanEstimate,
  type ReembedScopeKey,
  type StoredVectorModelStats,
} from '../openrouter/reembedService';
import {
  getDiaryStorageStats,
  useDiaryMediaStore,
  type DiaryStorageStats,
} from '../diary/diaryMediaService';
import { clearHighlightVectors, clearLibraryVectors } from '../embedding/resonanceService';

type ModelSlot = 'embedding' | 'reranker' | 'transcription' | 'vision';

const BUDGET_PRESETS: Array<{ label: string; value: number | null }> = [
  { label: 'Off', value: null },
  { label: '$2', value: 2 },
  { label: '$5', value: 5 },
  { label: '$10', value: 10 },
  { label: '$25', value: 25 },
];

function formatUsd(usd: number): string {
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OpenRouterSettingsSection(): ReactNode {
  const {
    hasKey,
    keyStatus,
    routingMode,
    features,
    embeddingModel,
    rerankerModel,
    transcriptionModel,
    visionModel,
    zeroDataRetention,
    monthlyBudgetUsd,
    creditsExhausted,
    lastError,
    usage,
    saveApiKey,
    clearApiKey,
    setRoutingMode,
    setFeature,
    setEmbeddingModel,
    setRerankerModel,
    setTranscriptionModel,
    setVisionModel,
    setZeroDataRetention,
    setMonthlyBudgetUsd,
    resetUsageLog,
  } = useOpenRouterStore();

  const reembed = useReembedStore();

  const [keyDraft, setKeyDraft] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Live Model Picker modal state
  const [pickerSlot, setPickerSlot] = useState<ModelSlot | null>(null);
  const [catalog, setCatalog] = useState<OpenRouterModelCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [customModelDraft, setCustomModelDraft] = useState('');

  // Re-embed Library modal state
  const [reembedVisible, setReembedVisible] = useState(false);
  const [reembedPlan, setReembedPlan] = useState<ReembedPlanEstimate | null>(null);
  const [reembedPlanLoading, setReembedPlanLoading] = useState(false);
  const [selectedScopes, setSelectedScopes] = useState<ReembedScopeKey[]>([
    'bible',
    'church',
    'personal',
    'journal',
    'highlights',
  ]);

  // Storage Manager modal state
  const [storageVisible, setStorageVisible] = useState(false);
  const [vectorStats, setVectorStats] = useState<StoredVectorModelStats[]>([]);
  const [diaryStats, setDiaryStats] = useState<DiaryStorageStats | null>(null);

  const isVoyage4 = isVoyage4SharedSpace(embeddingModel);
  const budgetWarn = isMonthlyBudgetExceeded();

  const handleSaveKey = useCallback(async () => {
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    setVerifying(true);
    try {
      await saveApiKey(trimmed);
      const status = await verifyOpenRouterKey(trimmed);
      if (status.valid) {
        setKeyDraft('');
        setEditingKey(false);
        clearLibraryVectors();
        clearHighlightVectors();
        void useDiaryMediaStore.getState().processPendingMediaQueue();
      }
    } finally {
      setVerifying(false);
    }
  }, [keyDraft, saveApiKey]);

  const handleRefreshKey = useCallback(async () => {
    setVerifying(true);
    try {
      await verifyOpenRouterKey();
    } finally {
      setVerifying(false);
    }
  }, []);

  const handleRemoveKey = useCallback(() => {
    Alert.alert(
      'Remove OpenRouter key?',
      'Resonance will return to 100% on-device mode. Your local diary media, transcripts, and embeddings stay safely on your phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove key',
          style: 'destructive',
          onPress: () => {
            void clearApiKey().then(() => {
              clearLibraryVectors();
              clearHighlightVectors();
            });
          },
        },
      ]
    );
  }, [clearApiKey]);

  const openModelPicker = useCallback(async (slot: ModelSlot) => {
    setPickerSlot(slot);
    setCatalogSearch('');
    setCustomModelDraft('');
    setCatalogLoading(true);
    try {
      const list = await fetchOpenRouterCatalog(slot);
      setCatalog(list);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const openReembedSheet = useCallback(async (modelId: string) => {
    setReembedVisible(true);
    setReembedPlanLoading(true);
    try {
      const plan = await estimateReembedPlan(modelId);
      setReembedPlan(plan);
    } finally {
      setReembedPlanLoading(false);
    }
  }, []);

  const handlePickModel = useCallback(
    (modelId: string) => {
      const slot = pickerSlot;
      if (!slot) return;
      const cleaned = modelId.trim();
      if (!cleaned) return;
      setPickerSlot(null);

      if (slot === 'embedding') {
        setEmbeddingModel(cleaned);
        clearLibraryVectors();
        clearHighlightVectors();
        if (!isVoyage4SharedSpace(cleaned)) {
          void openReembedSheet(cleaned);
        }
      } else if (slot === 'reranker') {
        setRerankerModel(cleaned);
      } else if (slot === 'transcription') {
        setTranscriptionModel(cleaned);
      } else if (slot === 'vision') {
        setVisionModel(cleaned);
      }
    },
    [
      pickerSlot,
      setEmbeddingModel,
      setRerankerModel,
      setTranscriptionModel,
      setVisionModel,
      openReembedSheet,
    ]
  );

  const openStorageManager = useCallback(async () => {
    setStorageVisible(true);
    const [vecs, diary] = await Promise.all([
      listStoredVectorModels(),
      getDiaryStorageStats(),
    ]);
    setVectorStats(vecs);
    setDiaryStats(diary);
  }, []);

  const handleDeleteModelVectors = useCallback(
    (modelId: string) => {
      Alert.alert(
        'Clear stored vectors?',
        `Delete all cached SQLite vectors for "${modelId}"? Default .rvec files on disk are untouched and you can re-embed anytime.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void deleteVectorsForModel(modelId).then(async () => {
                setVectorStats(await listStoredVectorModels());
              });
            },
          },
        ]
      );
    },
    []
  );

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return catalog.slice(0, 60);
    return catalog
      .filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          (m.description ?? '').toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [catalog, catalogSearch]);

  const toggleScope = useCallback((scope: ReembedScopeKey) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  }, []);

  // Refresh re-embed plan counts after completion
  useEffect(() => {
    if (reembedVisible && !reembed.running) {
      void estimateReembedPlan(embeddingModel).then(setReembedPlan);
    }
  }, [reembedVisible, reembed.running, embeddingModel]);

  const selectedPlanSummary = useMemo(() => {
    if (!reembedPlan) return { items: 0, tokens: 0, cost: 0 };
    const chosen = reembedPlan.scopes.filter((s) => selectedScopes.includes(s.scope));
    return {
      items: chosen.reduce((a, b) => a + b.remainingItems, 0),
      tokens: chosen.reduce((a, b) => a + b.estimatedTokens, 0),
      cost: chosen.reduce((a, b) => a + b.estimatedCostUsd, 0),
    };
  }, [reembedPlan, selectedScopes]);

  return (
    <View style={styles.wrapper}>
      <Text style={styles.sectionTitle}>OpenRouter (Optional BYOK)</Text>
      <Text style={styles.sectionDesc}>
        Resonance works 100% offline by default. Optionally add your own OpenRouter API key
        to unlock cloud embeddings (any model), frontier reranking, scanned PDF OCR, and the
        Multimodal Life Diary (voice notes, photos, and videos).
      </Text>

      <View style={styles.card}>
        {/* 1. API Key setup / status */}
        {!hasKey || editingKey ? (
          <View style={styles.block}>
            <Text style={styles.label}>OpenRouter API Key</Text>
            <Text style={styles.hint}>
              Stored encrypted in your device keychain. Text or media you process via OpenRouter
              is sent only to your chosen provider.
            </Text>
            <TextInput
              value={keyDraft}
              onChangeText={setKeyDraft}
              placeholder="sk-or-v1-..."
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
            />
            <View style={styles.btnRow}>
              <Pressable
                onPress={() => void handleSaveKey()}
                disabled={verifying || !keyDraft.trim()}
                style={[
                  styles.primaryBtn,
                  (!keyDraft.trim() || verifying) && styles.btnDisabled,
                ]}
              >
                {verifying ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save & Verify Key</Text>
                )}
              </Pressable>
              {editingKey ? (
                <Pressable
                  onPress={() => {
                    setEditingKey(false);
                    setKeyDraft('');
                  }}
                  style={styles.ghostBtn}
                >
                  <Text style={styles.ghostBtnText}>Cancel</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => void Linking.openURL('https://openrouter.ai/keys')}
                  style={styles.ghostBtn}
                >
                  <Text style={styles.ghostBtnText}>Get a key ↗</Text>
                </Pressable>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.block}>
            <View style={styles.keyHeaderRow}>
              <View style={styles.keyStatusLeft}>
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor: creditsExhausted
                        ? '#a85c5c'
                        : keyStatus?.valid === false
                          ? '#a85c5c'
                          : '#4a7c59',
                    },
                  ]}
                />
                <Text style={styles.label}>
                  {creditsExhausted
                    ? 'Credits exhausted (HTTP 402)'
                    : keyStatus?.valid
                      ? `Connected${keyStatus.label ? ` · ${keyStatus.label}` : ''}`
                      : 'API key saved'}
                </Text>
              </View>
              <Pressable onPress={() => void handleRefreshKey()} hitSlop={8}>
                {verifying ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Feather name="refresh-cw" size={16} color={colors.textSecondary} />
                )}
              </Pressable>
            </View>

            {keyStatus?.limitRemainingUsd != null ? (
              <Text style={styles.hint}>
                Key remaining limit: {formatUsd(keyStatus.limitRemainingUsd)}
                {keyStatus.limitUsd != null ? ` / ${formatUsd(keyStatus.limitUsd)}` : ''}
              </Text>
            ) : null}
            {keyStatus?.error || lastError ? (
              <Text style={styles.errorText}>{keyStatus?.error ?? lastError}</Text>
            ) : null}

            <View style={styles.btnRow}>
              <Pressable
                onPress={() => {
                  setKeyDraft('');
                  setEditingKey(true);
                }}
                style={styles.ghostBtn}
              >
                <Text style={styles.ghostBtnText}>Change key</Text>
              </Pressable>
              <Pressable onPress={handleRemoveKey} style={styles.dangerGhostBtn}>
                <Text style={styles.dangerGhostText}>Remove key</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Controls below unlock once key is configured */}
        {hasKey ? (
          <>
            <View style={styles.divider} />

            {/* 2. Routing Mode */}
            <View style={styles.block}>
              <Text style={styles.label}>Routing Mode</Text>
              <View style={styles.pillGroup}>
                {(
                  [
                    { id: 'local_only', label: 'On-Device Only' },
                    { id: 'cloud_with_fallback', label: 'OpenRouter Cloud' },
                    { id: 'hybrid_books_only', label: 'Hybrid (Books)' },
                  ] as Array<{ id: OpenRouterRoutingMode; label: string }>
                ).map((opt) => {
                  const disabled = opt.id === 'hybrid_books_only' && !isVoyage4;
                  const active = routingMode === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      disabled={disabled}
                      onPress={() => {
                        setRoutingMode(opt.id);
                        clearLibraryVectors();
                        clearHighlightVectors();
                      }}
                      style={[
                        styles.modePill,
                        active && styles.modePillActive,
                        disabled && styles.btnDisabled,
                      ]}
                    >
                      <Text
                        style={[
                          styles.modePillText,
                          active && styles.modePillTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.hint}>
                {routingMode === 'local_only'
                  ? 'Paused — all features run strictly on-device.'
                  : routingMode === 'hybrid_books_only'
                    ? 'Books & PDF OCR embed via OpenRouter; journal entries stay strictly on-device (requires Voyage-4 space).'
                    : isVoyage4
                      ? 'Uses OpenRouter when online and falls back seamlessly to on-device Voyage-4-Nano when offline.'
                      : 'Uses your custom OpenRouter embedding space when online. Diary captures made offline auto-queue until reconnected.'}
              </Text>
            </View>

            <View style={styles.divider} />

            {/* 3. Per-Feature Toggles */}
            <ToggleLine
              label="Cloud Embeddings"
              hint="Use OpenRouter to embed books, journal entries, highlights, and searches."
              value={features.embeddings}
              onChange={(v) => {
                setFeature('embeddings', v);
                clearLibraryVectors();
                clearHighlightVectors();
              }}
            />
            <View style={styles.divider} />
            <ToggleLine
              label="Cloud Neural Reranking"
              hint="Rerank top matches on OpenRouter (e.g. Qwen3-Reranker-8B) without the 583 MB local model."
              value={features.reranking}
              onChange={(v) => setFeature('reranking', v)}
            />
            <View style={styles.divider} />
            <ToggleLine
              label="Voice Diary & Transcription"
              hint="Unlock the Voice recorder in Journal with OpenRouter speech-to-text."
              value={features.voice}
              onChange={(v) => setFeature('voice', v)}
            />
            <View style={styles.divider} />
            <ToggleLine
              label="Photos & Videos (Life Diary)"
              hint="Unlock Photo & Video capture, People tags, handwritten OCR, and Memories gallery."
              value={features.photosAndVideos}
              onChange={(v) => setFeature('photosAndVideos', v)}
            />
            <View style={styles.divider} />
            <ToggleLine
              label="Scanned PDF OCR"
              hint="Allow transcribing image-only PDFs in your Personal Library via OpenRouter Vision."
              value={features.scannedPdfOcr}
              onChange={(v) => setFeature('scannedPdfOcr', v)}
            />

            <View style={styles.divider} />

            {/* 4. Model Pickers */}
            <ModelPickerRow
              label="Embedding model"
              value={embeddingModel}
              badge={isVoyage4 ? 'Zero re-embed' : 'Custom space'}
              onPress={() => void openModelPicker('embedding')}
            />
            {!isVoyage4 ? (
              <Pressable
                onPress={() => void openReembedSheet(embeddingModel)}
                style={styles.reembedCallout}
              >
                <Feather name="layers" size={15} color={colors.accent} />
                <Text style={styles.reembedCalloutText}>
                  {reembed.running
                    ? `Re-embedding (${reembed.completed}/${reembed.total})…`
                    : 'Re-embed Bible, Church & Personal libraries for this model'}
                </Text>
                <Feather name="chevron-right" size={16} color={colors.accent} />
              </Pressable>
            ) : null}
            <View style={styles.divider} />
            <ModelPickerRow
              label="Reranker model"
              value={rerankerModel}
              onPress={() => void openModelPicker('reranker')}
            />
            <View style={styles.divider} />
            <ModelPickerRow
              label="Voice transcription model"
              value={transcriptionModel}
              onPress={() => void openModelPicker('transcription')}
            />
            <View style={styles.divider} />
            <ModelPickerRow
              label="Vision / Video / OCR model"
              value={visionModel}
              onPress={() => void openModelPicker('vision')}
            />

            <View style={styles.divider} />

            {/* 5. Privacy & Spend Guardrails */}
            <ToggleLine
              label="Zero Data Retention (deny logging)"
              hint="Sends provider.data_collection = 'deny' so providers do not store or train on your diary."
              value={zeroDataRetention}
              onChange={setZeroDataRetention}
            />
            <View style={styles.divider} />

            <View style={styles.block}>
              <Text style={styles.label}>Monthly spend alert</Text>
              <View style={styles.pillGroup}>
                {BUDGET_PRESETS.map((p) => {
                  const active = monthlyBudgetUsd === p.value;
                  return (
                    <Pressable
                      key={p.label}
                      onPress={() => setMonthlyBudgetUsd(p.value)}
                      style={[styles.budgetPill, active && styles.modePillActive]}
                    >
                      <Text
                        style={[
                          styles.modePillText,
                          active && styles.modePillTextActive,
                        ]}
                      >
                        {p.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.usageRow}>
                <Text style={[styles.hint, budgetWarn && styles.errorText]}>
                  This month: {formatUsd(usage.monthCostUsd)} · Lifetime:{' '}
                  {formatUsd(usage.totalCostUsd)} ({usage.requestCount} calls)
                </Text>
                {usage.requestCount > 0 ? (
                  <Pressable onPress={() => void resetUsageLog()} hitSlop={8}>
                    <Text style={styles.linkText}>Reset</Text>
                  </Pressable>
                ) : null}
              </View>
              {budgetWarn ? (
                <Text style={styles.errorText}>
                  Heads up: monthly estimated spend exceeded your {formatUsd(monthlyBudgetUsd!)}{' '}
                  warning threshold.
                </Text>
              ) : null}
            </View>

            <View style={styles.divider} />

            {/* 6. Storage Manager */}
            <Pressable onPress={() => void openStorageManager()} style={styles.actionRow}>
              <Text style={styles.actionLabel}>Manage diary media & vector storage</Text>
              <Feather name="chevron-right" size={16} color={colors.textTertiary} />
            </Pressable>
          </>
        ) : null}
      </View>

      {/* ── Live Model Picker Modal ─────────────────────────────────────── */}
      <Modal
        visible={pickerSlot !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerSlot(null)}
      >
        <View style={styles.modalScreen}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              Choose{' '}
              {pickerSlot === 'embedding'
                ? 'Embedding'
                : pickerSlot === 'reranker'
                  ? 'Reranker'
                  : pickerSlot === 'transcription'
                    ? 'Transcription'
                    : 'Vision & Video'}{' '}
              Model
            </Text>
            <Pressable onPress={() => setPickerSlot(null)} hitSlop={10}>
              <Feather name="x" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.modalSearchWrap}>
            <TextInput
              value={catalogSearch}
              onChangeText={setCatalogSearch}
              placeholder="Search live OpenRouter models…"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.customIdRow}>
              <TextInput
                value={customModelDraft}
                onChangeText={setCustomModelDraft}
                placeholder="Or enter any model ID (e.g. org/model)"
                placeholderTextColor={colors.textTertiary}
                style={[styles.input, { flex: 1, marginTop: 0 }]}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                disabled={!customModelDraft.trim()}
                onPress={() => handlePickModel(customModelDraft)}
                style={[
                  styles.primaryBtn,
                  !customModelDraft.trim() && styles.btnDisabled,
                ]}
              >
                <Text style={styles.primaryBtnText}>Use</Text>
              </Pressable>
            </View>
          </View>

          {catalogLoading ? (
            <View style={styles.centerLoader}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.hint}>Loading live OpenRouter catalog…</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.modalList}>
              {filteredCatalog.map((m) => {
                const currentId =
                  pickerSlot === 'embedding'
                    ? embeddingModel
                    : pickerSlot === 'reranker'
                      ? rerankerModel
                      : pickerSlot === 'transcription'
                        ? transcriptionModel
                        : visionModel;
                const selected = currentId === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => handlePickModel(m.id)}
                    style={[styles.modelCard, selected && styles.modelCardSelected]}
                  >
                    <View style={styles.modelCardTop}>
                      <Text style={styles.modelName} numberOfLines={1}>
                        {m.name}
                      </Text>
                      {m.badge ? (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{m.badge}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.modelId}>{m.id}</Text>
                    {m.description ? (
                      <Text style={styles.modelDesc} numberOfLines={2}>
                        {m.description}
                      </Text>
                    ) : null}
                    <Text style={styles.modelPrice}>
                      {m.promptPricePerMillion > 0
                        ? `$${m.promptPricePerMillion}/M tokens`
                        : 'See OpenRouter pricing'}
                      {m.supportsImageInput ? ' · Image' : ''}
                      {m.supportsVideoInput ? ' · Video' : ''}
                      {m.supportsContextualEmbeddings ? ' · Contextual' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Non-Destructive Re-Embed Library Sheet ─────────────────────── */}
      <Modal
        visible={reembedVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (!reembed.running) setReembedVisible(false);
        }}
      >
        <View style={styles.modalScreen}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Re-embed Libraries</Text>
            <Pressable
              onPress={() => setReembedVisible(false)}
              hitSlop={10}
              accessibilityLabel="Close re-embed modal"
            >
              <Feather name="x" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalList}>
            <Text style={styles.sectionDesc}>
              Model: <Text style={styles.monoStrong}>{embeddingModel}</Text>
              {'\n'}
              Your default on-device Voyage-4 vectors remain untouched so you can switch back
              anytime.
            </Text>

            {reembedPlanLoading || !reembedPlan ? (
              <View style={styles.centerLoader}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.hint}>Estimating chunks & cost…</Text>
              </View>
            ) : (
              <>
                {reembedPlan.scopes.map((s) => {
                  const checked = selectedScopes.includes(s.scope);
                  return (
                    <Pressable
                      key={s.scope}
                      onPress={() => toggleScope(s.scope)}
                      disabled={reembed.running}
                      style={[styles.scopeRow, checked && styles.scopeRowChecked]}
                    >
                      <Feather
                        name={checked ? 'check-square' : 'square'}
                        size={18}
                        color={checked ? colors.accent : colors.textTertiary}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.label}>{s.label}</Text>
                        <Text style={styles.hint}>
                          {s.alreadyEmbedded}/{s.totalItems} done · {s.remainingItems} remaining
                        </Text>
                      </View>
                      <Text style={styles.costCol}>{formatUsd(s.estimatedCostUsd)}</Text>
                    </Pressable>
                  );
                })}

                <View style={styles.estimateBox}>
                  <Text style={styles.label}>
                    Estimated remaining: {selectedPlanSummary.items.toLocaleString()} chunks
                  </Text>
                  <Text style={styles.hint}>
                    ~{Math.round(selectedPlanSummary.tokens / 1000).toLocaleString()}k tokens ·
                    est. {formatUsd(selectedPlanSummary.cost)}
                  </Text>
                </View>

                {reembed.running || reembed.completed > 0 ? (
                  <View style={styles.progressBox}>
                    <Text style={styles.label}>
                      {reembed.running
                        ? `Embedding ${reembed.currentScopeLabel ?? 'library'}…`
                        : reembed.paused
                          ? 'Paused — resume anytime'
                          : 'Re-embedding complete'}
                    </Text>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${
                              reembed.total > 0
                                ? Math.min(100, Math.round((reembed.completed / reembed.total) * 100))
                                : 100
                            }%`,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.hint}>
                      {reembed.completed.toLocaleString()} / {reembed.total.toLocaleString()}{' '}
                      chunks
                    </Text>
                  </View>
                ) : null}

                {reembed.error ? (
                  <Text style={styles.errorText}>{reembed.error}</Text>
                ) : null}

                <View style={styles.btnRow}>
                  {reembed.running ? (
                    <Pressable
                      onPress={() => reembed.pauseReembed()}
                      style={styles.ghostBtn}
                    >
                      <Text style={styles.ghostBtnText}>Pause</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      disabled={selectedPlanSummary.items === 0}
                      onPress={() =>
                        void reembed.startReembed(embeddingModel, selectedScopes)
                      }
                      style={[
                        styles.primaryBtn,
                        selectedPlanSummary.items === 0 && styles.btnDisabled,
                      ]}
                    >
                      <Text style={styles.primaryBtnText}>
                        {selectedPlanSummary.items === 0
                          ? 'All selected libraries embedded'
                          : `Start Re-embed (${formatUsd(selectedPlanSummary.cost)})`}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Storage Manager Modal ──────────────────────────────────────── */}
      <Modal
        visible={storageVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setStorageVisible(false)}
      >
        <View style={styles.modalScreen}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Diary & Vector Storage</Text>
            <Pressable onPress={() => setStorageVisible(false)} hitSlop={10}>
              <Feather name="x" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalList}>
            <Text style={styles.sectionTitle}>Local Diary Media</Text>
            <View style={styles.estimateBox}>
              <Text style={styles.label}>
                {diaryStats ? formatBytes(diaryStats.totalBytes) : '0 KB'} across{' '}
                {diaryStats?.totalFiles ?? 0} files
              </Text>
              <Text style={styles.hint}>
                Voice: {diaryStats?.voiceCount ?? 0} · Photos: {diaryStats?.photoCount ?? 0} ·
                Videos: {diaryStats?.videoCount ?? 0}
              </Text>
            </View>

            <Text style={[styles.sectionTitle, { marginTop: spacing.md }]}>
              Stored Embedding Vector Indexes
            </Text>
            {vectorStats.length === 0 ? (
              <Text style={styles.hint}>No custom SQLite vectors stored yet.</Text>
            ) : (
              vectorStats.map((st) => (
                <View key={st.modelId} style={styles.storageRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>{st.modelId}</Text>
                    <Text style={styles.hint}>
                      {st.passageVectors} library · {st.journalVectors} diary ·{' '}
                      {st.highlightVectors} highlights ({formatBytes(st.estimatedBytes)})
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleDeleteModelVectors(st.modelId)}
                    style={styles.dangerGhostBtn}
                  >
                    <Text style={styles.dangerGhostText}>Clear</Text>
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function ToggleLine({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}): ReactNode {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, paddingRight: spacing.sm }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

function ModelPickerRow({
  label,
  value,
  badge,
  onPress,
}: {
  label: string;
  value: string;
  badge?: string;
  onPress: () => void;
}): ReactNode {
  return (
    <Pressable onPress={onPress} style={styles.actionRow}>
      <View style={{ flex: 1, paddingRight: spacing.sm }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.modelId} numberOfLines={1}>
          {value}
        </Text>
      </View>
      {badge ? (
        <View style={[styles.badge, { marginRight: spacing.xs }]}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      <Feather name="chevron-right" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
  sectionDesc: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  block: {
    padding: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  label: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  hint: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 2,
  },
  errorText: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: '#a85c5c',
    marginTop: 4,
  },
  input: {
    marginTop: spacing.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.textPrimary,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: '#ffffff',
  },
  ghostBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  ghostBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.textPrimary,
  },
  dangerGhostBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: '#e2c5c5',
    backgroundColor: '#fdf6f6',
  },
  dangerGhostText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: '#a85c5c',
  },
  btnDisabled: {
    opacity: 0.45,
  },
  keyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  keyStatusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.xs,
    marginBottom: 4,
  },
  modePill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  budgetPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  modePillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  modePillText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textPrimary,
  },
  modePillTextActive: {
    color: '#ffffff',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  actionLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.accent,
  },
  reembedCallout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: '#f3efe6',
    borderWidth: 1,
    borderColor: colors.border,
  },
  reembedCalloutText: {
    flex: 1,
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.accent,
  },
  usageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  linkText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.accent,
  },
  modalScreen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  modalSearchWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  customIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  modalList: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  modelCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  modelCardSelected: {
    borderColor: colors.accent,
    backgroundColor: '#f6f2ea',
  },
  modelCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  modelName: {
    flex: 1,
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  modelId: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
  modelDesc: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 17,
  },
  modelPrice: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
    color: colors.accent,
    marginTop: 6,
  },
  badge: {
    backgroundColor: '#ece6da',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  badgeText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
    color: colors.accent,
  },
  monoStrong: {
    fontFamily: fontFamilies.sansSemibold,
    color: colors.textPrimary,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  scopeRowChecked: {
    borderColor: colors.accent,
  },
  costCol: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  estimateBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  progressBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: '#f3efe6',
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    backgroundColor: colors.accent,
  },
  storageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
