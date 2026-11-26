/**
 * Settings screen — full-screen, 7 sections.
 *
 * Every preference lives on the device. The language is deliberately quiet
 * and reverent: no "AI assistant" voice, no cleverness, no dark patterns.
 *
 * Sections:
 *   1. Embedding Model      — local math that finds echoes in your Library
 *   2. Reflection Model     — optional, opt-in LLM layer (off by default)
 *   3. Reading Preferences  — translation, reading font size, theme
 *   4. Privacy & Data       — export, erase, lock
 *   5. Storage              — local footprint breakdown
 *   6. Accessibility        — text scale, reduced motion (these are live)
 *   7. Licenses & Acknowledgments — a long, discreet list at the bottom
 *
 * (design spec §8.2, implementation plan Task 7.1)
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fontFamilies, layout, spacing } from '@resonance/theme';
import { OFFLINE_ENGINE_MANIFEST } from '@resonance/core';
import { useSettingsStore } from '../settings/settingsStore';
import { useOfflineEngineStore } from '../packages/offlineEngineManager';
import { usePersonalLibraryStore } from '../personal/personalLibraryService';
import { PersonalLibraryImportModal } from '../components/PersonalLibraryImportModal';
import { LibraryCatalogModal } from '../components/LibraryCatalogModal';
import { EmbeddingProgressCard } from '../components/EmbeddingProgressCard';
import {
  getStorageInfo,
  clearAllJournalData,
  clearResonanceVectors,
  exportJournalToFile,
  formatBytes,
  type StorageInfo,
} from '../db/queries/settingsQueries';
import {
  Section,
  ToggleRow,
  SegmentedRow,
  ActionRow,
  InfoRow,
  RowDivider,
  QuietNote,
} from './settings/components';
import { LICENSE_GROUPS } from './settings/licenses';

// ── Screen ────────────────────────────────────────────────────────────────

export function SettingsScreen(): ReactNode {
  const loaded = useSettingsStore((s) => s.loaded);
  const load = useSettingsStore((s) => s.load);

  // Load persisted settings once the SQLite connection is live.
  useEffect(() => {
    if (!loaded) {
      void load();
    }
  }, [loaded, load]);

  if (!loaded) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accentMuted} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <OfflineEngineSection />
      <PersonalLibrarySection />
      <ReadingPreferencesSection />
      <PrivacyDataSection />
      <StorageSection />
      <AccessibilitySection />
      <LicensesSection />

      <Text style={styles.footer}>
        Resonance — a private, offline-first spiritual journal.{'\n'}
        Everything you read and write stays on this device.
      </Text>
    </ScrollView>
  );
}

// ── 1. Offline Resonance Engine (Voyage-4-Nano 512d + Qwen3-Reranker-0.6B) ──

function OfflineEngineSection(): ReactNode {
  const {
    phase,
    rerankerPhase,
    rerankerError,
    wifiOnly,
    downloadedBytes,
    totalBytes,
    groups,
    corpusManifest,
    installedWorkIds,
    setSheetVisible,
    setWifiOnly,
    startDownload,
    pauseDownload,
    downloadReranker,
    pauseRerankerDownload,
    removeReranker,
    syncCorpusManifest,
    removeOfflineEngine,
    refreshStatus,
  } = useOfflineEngineStore();

  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [catalogVisible, setCatalogVisible] = useState(false);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const pct =
    totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
  const rerankerPct =
    groups.reranker.totalBytes > 0
      ? Math.min(
          100,
          Math.round((groups.reranker.downloadedBytes / groups.reranker.totalBytes) * 100)
        )
      : 0;

  const coreSizeLabel = formatBytes(totalBytes);
  const rerankerSizeLabel = formatBytes(groups.reranker.totalBytes);

  const phaseLabel =
    phase === 'ready'
      ? 'Ready offline'
      : phase === 'downloading'
        ? `Downloading (${pct}%)`
        : phase === 'paused'
          ? `Paused (${pct}%)`
          : phase === 'error'
            ? 'Interrupted — tap to retry'
            : `Not downloaded (~${coreSizeLabel})`;

  const rerankerLabel =
    rerankerPhase === 'ready' || groups.reranker.ready
      ? 'Qwen3-Reranker-0.6B · Ready'
      : rerankerPhase === 'downloading'
        ? `Downloading (${rerankerPct}%)`
        : rerankerPhase === 'paused'
          ? `Paused (${rerankerPct}%)`
          : `Optional · ${rerankerSizeLabel}`;

  const totalCatalogWorks = corpusManifest.works?.length || 72;

  const handleCheckUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    setStatusNote(null);
    try {
      const m = await syncCorpusManifest();
      const count = m.works?.length ?? 0;
      setStatusNote(
        count > 0
          ? `Synced ${count} catalog works across ${m.collections?.length ?? 4} collections.`
          : 'Catalog manifest checked — packs are still publishing on GitHub Releases.'
      );
    } finally {
      setCheckingUpdates(false);
    }
  }, [syncCorpusManifest]);

  return (
    <Section
      title="Offline Resonance Engine"
      description={
        'Local-only passage search & relevance scoring. Never generates prose, ' +
        'prayers, or advice — only surfaces real passages from Scripture and your Library.'
      }
    >
      <InfoRow label="Core engine" value={phaseLabel} />
      <RowDivider />
      <InfoRow
        label="Embedder"
        value={
          groups.embedder.ready
            ? 'Voyage-4-Nano 512d · Ready'
            : `Voyage-4-Nano 512d · ${formatBytes(groups.embedder.totalBytes)}`
        }
      />
      <RowDivider />
      <InfoRow label="Reranker (optional)" value={rerankerLabel} />
      <RowDivider />
      <InfoRow
        label="Church Library"
        value={`${installedWorkIds.length} / ${totalCatalogWorks} books downloaded`}
      />
      <RowDivider />
      <InfoRow
        label="Fusion & Silence"
        value={`α=${OFFLINE_ENGINE_MANIFEST.fusionAlpha.toFixed(2)} · τ=${OFFLINE_ENGINE_MANIFEST.silenceThreshold.toFixed(2)}`}
      />
      <RowDivider />
      <ToggleRow
        label="Prefer Wi-Fi for downloads"
        hint={`Recommended for the ~${coreSizeLabel} one-time core engine download.`}
        value={wifiOnly}
        onToggle={(v) => void setWifiOnly(v)}
      />
      <RowDivider />

      {phase === 'downloading' ? (
        <>
          <ActionRow
            label={`View engine download progress (${pct}%)`}
            onPress={() => setSheetVisible(true)}
          />
          <RowDivider />
          <ActionRow label="Pause download" onPress={() => void pauseDownload()} />
        </>
      ) : phase === 'paused' ? (
        <ActionRow
          label={`Resume core engine download (${pct}%)`}
          onPress={() => {
            setSheetVisible(true);
            void startDownload();
          }}
        />
      ) : phase !== 'ready' ? (
        <ActionRow
          label={`Download core engine (~${coreSizeLabel})`}
          onPress={() => setSheetVisible(true)}
        />
      ) : null}

      <RowDivider />
      {rerankerPhase === 'downloading' ? (
        <ActionRow
          label={`Pause optional reranker download (${rerankerPct}%)`}
          onPress={() => void pauseRerankerDownload()}
        />
      ) : rerankerPhase === 'paused' ? (
        <ActionRow
          label={`Resume optional reranker (${rerankerPct}%)`}
          onPress={() => void downloadReranker()}
        />
      ) : rerankerPhase === 'ready' || groups.reranker.ready ? (
        <ActionRow
          label={`Remove optional reranker (reclaim ~${rerankerSizeLabel})`}
          destructive
          onPress={() => void removeReranker()}
        />
      ) : (
        <ActionRow
          label={`Download optional reranker (~${rerankerSizeLabel})`}
          onPress={() => void downloadReranker()}
        />
      )}

      <RowDivider />
      <ActionRow
        label="Browse Library Catalog (choose books or collections)"
        onPress={() => setCatalogVisible(true)}
      />
      <RowDivider />
      <ActionRow
        label={
          checkingUpdates
            ? 'Checking GitHub Releases…'
            : 'Refresh catalog from GitHub Releases'
        }
        onPress={() => void handleCheckUpdates()}
      />

      {downloadedBytes > 0 || groups.reranker.downloadedBytes > 0 || installedWorkIds.length > 0 ? (
        <>
          <RowDivider />
          <ActionRow
            label={`Remove offline engine & downloaded packs`}
            destructive
            onPress={() => setConfirmRemove(true)}
          />
        </>
      ) : null}

      {rerankerError ? <QuietNote>{rerankerError}</QuietNote> : null}
      {statusNote ? <QuietNote>{statusNote}</QuietNote> : null}

      <LibraryCatalogModal
        visible={catalogVisible}
        onClose={() => setCatalogVisible(false)}
      />

      <ConfirmModal
        visible={confirmRemove}
        title="Remove offline engine?"
        body="Deletes the downloaded ONNX models and optional Church Library packs to reclaim storage. Your journal entries, Scripture, and Personal Library imports stay intact."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          setConfirmRemove(false);
          void removeOfflineEngine();
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </Section>
  );
}

// ── 2. Personal Library Folder (EPUB, PDF, DOCX, HTML, MD, TXT) ────────────

function PersonalLibrarySection(): ReactNode {
  const {
    connectedFolderLabel,
    works,
    scanning,
    embeddingActiveBookId,
    initialize,
    scanFolders,
    processEmbeddingQueue,
    pauseEmbeddingQueue,
  } = usePersonalLibraryStore();

  const autoEmbedPersonalFiles = useSettingsStore((s) => s.autoEmbedPersonalFiles);
  const setAutoEmbedPersonalFiles = useSettingsStore((s) => s.setAutoEmbedPersonalFiles);
  const embedderReady = useOfflineEngineStore(
    (s) => s.phase === 'ready' || s.groups.embedder.ready
  );

  const [importVisible, setImportVisible] = useState(false);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const readyCount = works.filter((w) => w.embeddingStatus === 'ready').length;
  const pendingCount = works.filter(
    (w) =>
      w.totalChunks > 0 &&
      !w.ocrRequired &&
      (w.embeddingStatus === 'pending' || w.embeddingStatus === 'embedding')
  ).length;
  const errorCount = works.filter(
    (w) => w.totalChunks > 0 && !w.ocrRequired && w.embeddingStatus === 'error'
  ).length;

  // If auto-embed is enabled and the embedder is ready, kick off any queued works automatically.
  useEffect(() => {
    if (autoEmbedPersonalFiles && embedderReady && pendingCount > 0 && !embeddingActiveBookId) {
      void processEmbeddingQueue();
    }
  }, [
    autoEmbedPersonalFiles,
    embedderReady,
    pendingCount,
    embeddingActiveBookId,
    processEmbeddingQueue,
  ]);

  const handleToggleAutoEmbed = useCallback(
    (enabled: boolean) => {
      setAutoEmbedPersonalFiles(enabled);
      if (enabled) {
        void processEmbeddingQueue({ force: true, retryErrors: true });
      } else {
        pauseEmbeddingQueue();
      }
    },
    [setAutoEmbedPersonalFiles, processEmbeddingQueue, pauseEmbeddingQueue]
  );

  const manualEmbedCount = pendingCount + errorCount;

  return (
    <Section
      title="Personal Library"
      description={
        'Import individual books or link a folder from your device, Google Drive, or iCloud ' +
        '(EPUB, PDF, DOCX, HTML, Markdown, TXT). Extracted, editable, and embedded 100% locally.'
      }
    >
      <InfoRow
        label="Connected folder"
        value={connectedFolderLabel ?? 'Not linked'}
      />
      <RowDivider />
      <InfoRow
        label="Imported works"
        value={
          works.length === 0
            ? 'None yet'
            : `${works.length} (${readyCount} embedded)`
        }
      />
      <RowDivider />
      <ToggleRow
        label="Auto-embed added files"
        hint="Automatically embed newly imported books and notes on-device for Resonance echoes and semantic search."
        value={autoEmbedPersonalFiles}
        onToggle={handleToggleAutoEmbed}
      />
      <RowDivider />
      <ActionRow
        label="Import files or manage folder"
        onPress={() => setImportVisible(true)}
      />
      <RowDivider />
      <ActionRow
        label={scanning ? 'Scanning folder…' : 'Scan folder for new books'}
        onPress={() => void scanFolders()}
      />
      {manualEmbedCount > 0 && !autoEmbedPersonalFiles && !embeddingActiveBookId ? (
        <>
          <RowDivider />
          <ActionRow
            label={`Embed ${manualEmbedCount} pending work${manualEmbedCount === 1 ? '' : 's'} now`}
            onPress={() =>
              void processEmbeddingQueue({ force: true, retryErrors: true })
            }
          />
        </>
      ) : errorCount > 0 && !embeddingActiveBookId ? (
        <>
          <RowDivider />
          <ActionRow
            label={`Retry ${errorCount} paused work${errorCount === 1 ? '' : 's'}`}
            onPress={() =>
              void processEmbeddingQueue({ force: true, retryErrors: true })
            }
          />
        </>
      ) : null}
      <EmbeddingProgressCard style={styles.embeddingCard} />
      <QuietNote>
        Edit any book&apos;s title, author, era, shelf, tags, or echo toggle anytime
        from Word → Library.
      </QuietNote>

      <PersonalLibraryImportModal
        visible={importVisible}
        onClose={() => setImportVisible(false)}
      />
    </Section>
  );
}

// ── 3. Reading Preferences ────────────────────────────────────────────────

const FONT_SIZE_OPTIONS = [
  { value: 'small' as const, label: 'Small' },
  { value: 'medium' as const, label: 'Medium' },
  { value: 'large' as const, label: 'Large' },
];

const TRANSLATION_OPTIONS = [
  { value: 'WEB' as const, label: 'WEB' },
  { value: 'KJV' as const, label: 'KJV' },
];

const THEME_OPTIONS = [
  { value: 'auto' as const, label: 'Auto' },
  { value: 'light' as const, label: 'Light' },
];

function ReadingPreferencesSection(): ReactNode {
  const readingFontSize = useSettingsStore((s) => s.readingFontSize);
  const readingTranslation = useSettingsStore((s) => s.readingTranslation);
  const theme = useSettingsStore((s) => s.theme);
  const setReadingFontSize = useSettingsStore((s) => s.setReadingFontSize);
  const setReadingTranslation = useSettingsStore((s) => s.setReadingTranslation);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <Section title="Reading Preferences">
      <SegmentedRow
        label="Default translation"
        options={TRANSLATION_OPTIONS}
        selected={readingTranslation}
        onChoose={setReadingTranslation}
      />
      <RowDivider />
      <SegmentedRow
        label="Reading font size"
        options={FONT_SIZE_OPTIONS}
        selected={readingFontSize}
        onChoose={setReadingFontSize}
      />
      <RowDivider />
      <SegmentedRow
        label="Theme"
        options={THEME_OPTIONS}
        selected={theme}
        onChoose={setTheme}
      />
      <QuietNote>Dark mode is not yet supported.</QuietNote>
    </Section>
  );
}

// ── 4. Privacy & Data ─────────────────────────────────────────────────────

function PrivacyDataSection(): ReactNode {
  const appLockEnabled = useSettingsStore((s) => s.appLockEnabled);
  const setAppLockEnabled = useSettingsStore((s) => s.setAppLockEnabled);

  const [status, setStatus] = useState<string | null>(null);
  const [confirmType, setConfirmType] = useState<null | 'journal' | 'vectors'>(null);

  const handleExport = useCallback(async () => {
    const result = await exportJournalToFile();
    setStatus(
      result.path
        ? `Exported ${result.segmentCount} segment(s) to your device.`
        : 'Nothing to export yet.'
    );
  }, []);

  const confirmClearJournal = useCallback(async () => {
    await clearAllJournalData();
    setConfirmType(null);
    setStatus('Journal cleared.');
  }, []);

  const confirmClearVectors = useCallback(async () => {
    await clearResonanceVectors();
    setConfirmType(null);
    setStatus('Resonance vectors cleared.');
  }, []);

  return (
    <Section
      title="Privacy & Data"
      description="What you write never leaves this device. Export, erase, or lock your data."
    >
      <ActionRow label="Export journal to a file" onPress={handleExport} />
      <RowDivider />
      <ActionRow
        label="Clear all journal data"
        destructive
        onPress={() => setConfirmType('journal')}
      />
      <RowDivider />
      <ActionRow
        label="Clear resonance vectors"
        destructive
        onPress={() => setConfirmType('vectors')}
      />
      <RowDivider />
      <ToggleRow
        label="App lock"
        hint="Require biometric unlock to open. (Coming soon.)"
        value={appLockEnabled}
        onToggle={setAppLockEnabled}
      />
      {status ? <QuietNote>{status}</QuietNote> : null}

      <ConfirmModal
        visible={confirmType !== null}
        title={confirmType === 'journal' ? 'Clear journal?' : 'Clear resonance vectors?'}
        body={
          confirmType === 'journal'
            ? 'This permanently removes every journal entry on this device. This cannot be undone.'
            : 'Embeddings of your writing will be deleted and rebuilt on next indexing. Your entries stay.'
        }
        confirmLabel="Clear"
        destructive
        onConfirm={confirmType === 'journal' ? confirmClearJournal : confirmClearVectors}
        onCancel={() => setConfirmType(null)}
      />
    </Section>
  );
}

// ── 5. Storage ────────────────────────────────────────────────────────────

function StorageSection(): ReactNode {
  const [info, setInfo] = useState<StorageInfo | null>(null);

  useEffect(() => {
    let mounted = true;
    void getStorageInfo().then((i) => {
      if (mounted) setInfo(i);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const totalBytes =
    info && info.dbFileSizeBytes > 0
      ? info.dbFileSizeBytes
      : info?.estimatedTotalBytes ?? 0;

  return (
    <Section title="Storage" description="Library footprint, per-package size, storage headroom.">
      {info ? (
        <>
          <InfoRow label="Total used" value={formatBytes(totalBytes)} />
          {info.dbFileSizeBytes === 0 ? (
            <QuietNote>Estimated — on-disk size unavailable in this build.</QuietNote>
          ) : null}
        </>
      ) : (
        <View style={styles.loadingInline}>
          <ActivityIndicator color={colors.accentMuted} size="small" />
        </View>
      )}

      {info && info.packages.length > 0 ? (
        <View style={styles.subBlock}>
          <RowDivider />
          {info.packages.map((p) => (
            <View key={p.label} style={styles.packageRow}>
              <View style={styles.packageLabel}>
                <Text style={styles.packageText}>{p.label}</Text>
              </View>
              <Text style={styles.packageMeta}>
                {formatBytes(p.bytes)} · {p.count.toLocaleString()} rows
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <QuietNote>All data is stored locally on this device.</QuietNote>
    </Section>
  );
}

// ── 6. Accessibility ──────────────────────────────────────────────────────

const TEXT_SCALE_OPTIONS = [
  { value: 'small' as const, label: 'S' },
  { value: 'medium' as const, label: 'M' },
  { value: 'large' as const, label: 'L' },
  { value: 'extra_large' as const, label: 'XL' },
];

function AccessibilitySection(): ReactNode {
  const textScale = useSettingsStore((s) => s.textScale);
  const reduceMotion = useSettingsStore((s) => s.reduceMotion);
  const setTextScale = useSettingsStore((s) => s.setTextScale);
  const setReduceMotion = useSettingsStore((s) => s.setReduceMotion);

  // A live preview of the accessibility text scale.
  const previewSize = (() => {
    const map: Record<typeof textScale, number> = {
      small: 13,
      medium: 15,
      large: 17,
      extra_large: 19,
    };
    return map[textScale];
  })();

  return (
    <Section title="Accessibility">
      <SegmentedRow
        label="Text scale"
        options={TEXT_SCALE_OPTIONS}
        selected={textScale}
        onChoose={setTextScale}
      />
      <Text style={[styles.previewText, { fontSize: previewSize }]}>
        The Lord is my shepherd; I shall not want.
      </Text>
      <RowDivider />
      <ToggleRow
        label="Reduce motion"
        hint="Soften transitions; avoid entrance animations."
        value={reduceMotion}
        onToggle={setReduceMotion}
      />
      <QuietNote>These apply across the app on your next interaction.</QuietNote>
    </Section>
  );
}

// ── 7. Licenses & Acknowledgments ─────────────────────────────────────────

function LicensesSection(): ReactNode {
  return (
    <Section
      title="Licenses & Acknowledgments"
      description="All third-party content and software. Not hidden — just discreet."
    >
      <QuietNote>Every voice is given freely to the Church. Used here with gratitude.</QuietNote>
      {LICENSE_GROUPS.map((group) => (
        <View key={group.title} style={styles.licenseGroup}>
          <Text style={styles.licenseGroupTitle}>{group.title}</Text>
          {group.entries.map((entry) => (
            <View key={`${group.title}-${entry.name}`} style={styles.licenseEntry}>
              <Text style={styles.licenseName}>{entry.name}</Text>
              <Text style={styles.licenseMeta}>
                {entry.license}
                {entry.detail ? ` · ${entry.detail}` : ''}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </Section>
  );
}

// ── Confirm modal ─────────────────────────────────────────────────────────

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({
  visible,
  title,
  body,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
}: ConfirmModalProps): ReactNode {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.modalOverlay} onPress={onCancel}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.modalBody}>{body}</Text>
          <View style={styles.modalActions}>
            <Pressable style={styles.modalAction} onPress={onCancel} hitSlop={8}>
              <Text style={styles.modalActionText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.modalAction} onPress={onConfirm} hitSlop={8}>
              <Text
                style={[
                  styles.modalActionText,
                  destructive && styles.modalActionDestructive,
                ]}
              >
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: layout.screenPaddingX,
    paddingVertical: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingInline: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  subBlock: {
    gap: 0,
  },
  previewText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginLeft: spacing.xs,
  },
  footer: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 13,
    lineHeight: 19,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.xxl,
    marginBottom: spacing.xl,
  },

  // Storage package rows
  packageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  packageLabel: {
    flex: 1,
  },
  packageText: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.textPrimary,
  },
  packageMeta: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.textTertiary,
  },

  // Licenses
  licenseGroup: {
    marginTop: spacing.md,
  },
  licenseGroupTitle: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.accentMuted,
    marginBottom: spacing.xs,
  },
  licenseEntry: {
    paddingVertical: spacing.xs - 1,
  },
  licenseName: {
    fontFamily: fontFamilies.serif,
    fontSize: 14.5,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  licenseMeta: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textTertiary,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 340,
  },
  modalTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 18,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  modalBody: {
    fontFamily: fontFamilies.serif,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
  },
  modalAction: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  modalActionText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 14,
    color: colors.accent,
  },
  modalActionDestructive: {
    color: '#a85c5c',
  },
  embeddingCard: {
    marginTop: spacing.sm,
  },
});
