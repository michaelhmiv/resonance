/**
 * Personal Library Import & Metadata Modal — the complete on-device flow for
 * adding user-owned books and documents (EPUB, PDF, DOCX, HTML, Markdown, TXT)
 * from a connected device folder or Resonance Inbox, inspecting extracted
 * chapters/passages, editing full metadata, saving to Library, and managing
 * on-device 512d int8 embeddings.
 *
 * Also doubles as the Edit Metadata sheet for any existing personal book in
 * the Library (title, author, era, collection/shelf, tags, notes, include in
 * Resonance toggle, re-embed, delete).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fontFamilies, layout, radii, spacing } from '@resonance/theme';
import type { PersonalSourceFormat, PersonalWorkMetadata } from '@resonance/core';
import {
  PERSONAL_INBOX_DIR,
  usePersonalLibraryStore,
  type DiscoveredFolderFile,
  type InspectedDocument,
  type PersonalImportMetadataForm,
} from '../personal/personalLibraryService';
import { useOfflineEngineStore } from '../packages/offlineEngineManager';
import { useSettingsStore } from '../settings/settingsStore';
import { useOpenRouterStore } from '../openrouter/openrouterStore';
import {
  estimatePdfOcrCost,
  transcribeScannedPersonalPdf,
} from '../openrouter/pdfOcrService';
import { formatBytes } from '../db/queries/settingsQueries';
import { BottomSheetModal } from './BottomSheetModal';
import { EmbeddingProgressCard } from './EmbeddingProgressCard';

const ERA_PRESETS = [
  'Patristic',
  'Medieval',
  'Reformation',
  'Modern',
  'Contemporary',
  'Personal',
] as const;

const COLLECTION_PRESETS = [
  'Personal Library',
  'Sermons',
  'Study Notes',
  'Commentaries',
] as const;

interface PersonalLibraryImportModalProps {
  visible: boolean;
  /** If provided, opens directly in Edit Metadata mode for this existing book. */
  editingWork?: PersonalWorkMetadata | null;
  onClose: () => void;
  /** Called after an import or metadata update so callers can open the book. */
  onImportedBook?: (bookId: string) => void;
}

type ModalStep = 'folder' | 'paste' | 'review' | 'edit';
type StatusFilter = 'all' | 'new' | 'imported';
type SortKey = 'new_first' | 'name_asc' | 'name_desc' | 'folder' | 'format' | 'size_desc';

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'new_first', label: 'New first' },
  { key: 'name_asc', label: 'A → Z' },
  { key: 'name_desc', label: 'Z → A' },
  { key: 'folder', label: 'Folder' },
  { key: 'format', label: 'Format' },
  { key: 'size_desc', label: 'Largest' },
];

const PAGE_SIZE = 40;

export function PersonalLibraryImportModal(
  props: PersonalLibraryImportModalProps
): ReactNode {
  if (!props.visible) return null;
  return <PersonalLibraryImportModalInner {...props} />;
}

function PersonalLibraryImportModalInner({
  visible,
  editingWork = null,
  onClose,
  onImportedBook,
}: PersonalLibraryImportModalProps): ReactNode {
  // Granular Zustand selectors so unrelated background updates (e.g. embedding `works` ticks)
  // never trigger full modal re-renders while browsing files.
  const connectedFolderLabel = usePersonalLibraryStore((s) => s.connectedFolderLabel);
  const discoveredFiles = usePersonalLibraryStore((s) => s.discoveredFiles);
  const scanning = usePersonalLibraryStore((s) => s.scanning);
  const scanProgress = usePersonalLibraryStore((s) => s.scanProgress);
  const scanNotice = usePersonalLibraryStore((s) => s.scanNotice);
  const scanError = usePersonalLibraryStore((s) => s.scanError);
  const batchImporting = usePersonalLibraryStore((s) => s.batchImporting);
  const batchProgress = usePersonalLibraryStore((s) => s.batchProgress);
  const batchSummary = usePersonalLibraryStore((s) => s.batchSummary);
  const batchError = usePersonalLibraryStore((s) => s.batchError);
  const embeddingActiveBookId = usePersonalLibraryStore((s) => s.embeddingActiveBookId);
  const liveEditingWork = usePersonalLibraryStore((s) =>
    editingWork
      ? s.works.find((w) => w.bookId === editingWork.bookId) ?? editingWork
      : null
  );

  const initialize = usePersonalLibraryStore((s) => s.initialize);
  const pickFiles = usePersonalLibraryStore((s) => s.pickFiles);
  const connectDeviceFolder = usePersonalLibraryStore((s) => s.connectDeviceFolder);
  const disconnectDeviceFolder = usePersonalLibraryStore((s) => s.disconnectDeviceFolder);
  const scanFolders = usePersonalLibraryStore((s) => s.scanFolders);
  const cancelScan = usePersonalLibraryStore((s) => s.cancelScan);
  const inspectFile = usePersonalLibraryStore((s) => s.inspectFile);
  const commitImport = usePersonalLibraryStore((s) => s.commitImport);
  const startBatchImport = usePersonalLibraryStore((s) => s.startBatchImport);
  const cancelBatchImport = usePersonalLibraryStore((s) => s.cancelBatchImport);
  const clearBatchBanner = usePersonalLibraryStore((s) => s.clearBatchBanner);
  const importPastedText = usePersonalLibraryStore((s) => s.importPastedText);
  const updateMetadata = usePersonalLibraryStore((s) => s.updateMetadata);
  const removeWork = usePersonalLibraryStore((s) => s.removeWork);
  const reembedWork = usePersonalLibraryStore((s) => s.reembedWork);
  const processEmbeddingQueue = usePersonalLibraryStore((s) => s.processEmbeddingQueue);

  const localEmbedderReady = useOfflineEngineStore(
    (s) => s.phase === 'ready' || s.groups.embedder.ready
  );
  const openRouterEmbedReady = useOpenRouterStore(
    (s) => s.hasKey && s.routingMode !== 'local_only' && s.features.embeddings && !s.creditsExhausted
  );
  const openRouterPdfOcrEnabled = useOpenRouterStore(
    (s) =>
      s.hasKey &&
      s.routingMode !== 'local_only' &&
      s.features.scannedPdfOcr &&
      !s.creditsExhausted
  );
  const embedderReady = localEmbedderReady || openRouterEmbedReady;
  const setEngineSheetVisible = useOfflineEngineStore((s) => s.setSheetVisible);
  const autoEmbedPersonalFiles = useSettingsStore((s) => s.autoEmbedPersonalFiles);
  const refreshWorks = usePersonalLibraryStore((s) => s.refreshWorks);

  const [step, setStep] = useState<ModalStep>(editingWork ? 'edit' : 'folder');
  const [ocrRunningBookId, setOcrRunningBookId] = useState<string | null>(null);
  const [pickingFiles, setPickingFiles] = useState(false);
  const [inspectingFile, setInspectingFile] = useState<string | null>(null);
  const [inspected, setInspected] = useState<InspectedDocument | null>(null);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // List search, filter, sort, pagination, and multi-select state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [formatFilter, setFormatFilter] = useState<'all' | PersonalSourceFormat>('all');
  const [subfolderFilter, setSubfolderFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortKey>('new_first');
  const [visibleLimit, setVisibleLimit] = useState<number>(PAGE_SIZE);
  const [selectedUris, setSelectedUris] = useState<Set<string>>(() => new Set());

  // Paste text mode state
  const [pasteText, setPasteText] = useState('');
  const [pasteFormat, setPasteFormat] = useState<'txt' | 'md'>('md');

  // Shared metadata form state (used for review, paste, and edit modes)
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [era, setEra] = useState('Personal');
  const [collection, setCollection] = useState('Personal Library');
  const [tagsDraft, setTagsDraft] = useState('');
  const [notes, setNotes] = useState('');
  const [includeInResonance, setIncludeInResonance] = useState(true);

  const resetForm = useCallback((initial?: Partial<PersonalImportMetadataForm>) => {
    setTitle(initial?.title ?? '');
    setAuthor(initial?.author ?? '');
    setEra(initial?.era ?? 'Personal');
    setCollection(initial?.collection ?? 'Personal Library');
    setTagsDraft((initial?.tags ?? []).join(', '));
    setNotes(initial?.notes ?? '');
    setIncludeInResonance(initial?.includeInResonance ?? true);
  }, []);

  // Closing the modal cancels any in-flight folder browse scan immediately so the JS
  // thread stays free, while background batch imports & embeddings continue untouched.
  const handleClose = useCallback(() => {
    cancelScan();
    onClose();
  }, [cancelScan, onClose]);

  useEffect(() => {
    setLocalError(null);
    setSelectedUris(new Set());
    setSearchQuery('');
    setStatusFilter('all');
    setFormatFilter('all');
    setSubfolderFilter('all');
    setSortBy('new_first');
    setVisibleLimit(PAGE_SIZE);

    let cancelled = false;
    let scanTimer: ReturnType<typeof setTimeout> | null = null;

    void initialize().then(() => {
      if (cancelled || editingWork) return;
      const store = usePersonalLibraryStore.getState();
      // Never re-walk folders while a batch import is actively running or when scanned recently
      const isFresh =
        store.lastScannedAt !== null &&
        Date.now() - store.lastScannedAt < 2 * 60_000 &&
        store.discoveredFiles.length > 0;
      if (!store.batchImporting && !store.scanning && !isFresh) {
        // Defer folder walk by 300ms so sheet slide-in & immediate close/swipe stay 60fps
        scanTimer = setTimeout(() => {
          if (!cancelled) {
            void scanFolders();
          }
        }, 300);
      }
    });

    if (editingWork) {
      setStep('edit');
      setInspected(null);
      resetForm({
        title: editingWork.title,
        author: editingWork.author,
        era: editingWork.era,
        collection: editingWork.collection,
        tags: editingWork.tags,
        notes: editingWork.notes,
        includeInResonance: editingWork.includeInResonance,
      });
    } else {
      setStep('folder');
      setInspected(null);
      setPasteText('');
      resetForm();
    }

    return () => {
      cancelled = true;
      if (scanTimer) clearTimeout(scanTimer);
    };
  }, [editingWork, initialize, scanFolders, resetForm]);

  // Reset pagination whenever filters or search query change
  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [searchQuery, statusFilter, formatFilter, subfolderFilter, sortBy]);

  // If viewing a pending book while auto-embed is on and the embedder is ready, start automatically
  useEffect(() => {
    if (
      step === 'edit' &&
      liveEditingWork &&
      liveEditingWork.totalChunks > 0 &&
      !liveEditingWork.ocrRequired &&
      liveEditingWork.embeddingStatus === 'pending' &&
      autoEmbedPersonalFiles &&
      embedderReady &&
      !embeddingActiveBookId
    ) {
      void processEmbeddingQueue();
    }
  }, [
    step,
    liveEditingWork,
    autoEmbedPersonalFiles,
    embedderReady,
    embeddingActiveBookId,
    processEmbeddingQueue,
  ]);

  // Prune any selected URIs that are no longer in discoveredFiles
  useEffect(() => {
    setSelectedUris((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(discoveredFiles.map((f) => f.uri));
      let changed = false;
      const next = new Set<string>();
      for (const uri of prev) {
        if (valid.has(uri)) next.add(uri);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [discoveredFiles]);

  // Available formats & subfolders for dynamic filter chips
  const availableFormats = useMemo(() => {
    const counts = new Map<PersonalSourceFormat, number>();
    for (const f of discoveredFiles) {
      counts.set(f.format, (counts.get(f.format) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [discoveredFiles]);

  const availableSubfolders = useMemo(() => {
    const counts = new Map<string, number>();
    let hasRoot = false;
    for (const f of discoveredFiles) {
      if (f.subfolder) {
        counts.set(f.subfolder, (counts.get(f.subfolder) ?? 0) + 1);
      } else {
        hasRoot = true;
      }
    }
    const list = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return { list, hasRoot };
  }, [discoveredFiles]);

  const totalNewCount = useMemo(
    () => discoveredFiles.filter((f) => !f.alreadyImportedBookId).length,
    [discoveredFiles]
  );
  const totalImportedCount = discoveredFiles.length - totalNewCount;

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = discoveredFiles.filter((f) => {
      if (statusFilter === 'new' && f.alreadyImportedBookId) return false;
      if (statusFilter === 'imported' && !f.alreadyImportedBookId) return false;
      if (formatFilter !== 'all' && f.format !== formatFilter) return false;
      if (subfolderFilter === '__root__' && f.subfolder !== null) return false;
      if (
        subfolderFilter !== 'all' &&
        subfolderFilter !== '__root__' &&
        f.subfolder !== subfolderFilter
      ) {
        return false;
      }
      if (q) {
        const hay = `${f.filename} ${f.subfolder ?? ''} ${f.format}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'name_asc':
          return a.filename.localeCompare(b.filename);
        case 'name_desc':
          return b.filename.localeCompare(a.filename);
        case 'folder': {
          const fa = a.subfolder ?? '';
          const fb = b.subfolder ?? '';
          if (fa !== fb) return fa.localeCompare(fb);
          return a.filename.localeCompare(b.filename);
        }
        case 'format': {
          if (a.format !== b.format) return a.format.localeCompare(b.format);
          return a.filename.localeCompare(b.filename);
        }
        case 'size_desc': {
          if (a.sizeBytes !== b.sizeBytes) return b.sizeBytes - a.sizeBytes;
          return a.filename.localeCompare(b.filename);
        }
        case 'new_first':
        default: {
          const aPicked = a.source === 'picked' ? 0 : 1;
          const bPicked = b.source === 'picked' ? 0 : 1;
          if (aPicked !== bPicked) return aPicked - bPicked;
          const aNew = a.alreadyImportedBookId === null ? 0 : 1;
          const bNew = b.alreadyImportedBookId === null ? 0 : 1;
          if (aNew !== bNew) return aNew - bNew;
          return a.filename.localeCompare(b.filename);
        }
      }
    });
    return sorted;
  }, [discoveredFiles, searchQuery, statusFilter, formatFilter, subfolderFilter, sortBy]);

  const visibleNewFiles = useMemo(
    () => filteredFiles.filter((f) => !f.alreadyImportedBookId),
    [filteredFiles]
  );

  const selectedFiles = useMemo(
    () => discoveredFiles.filter((f) => selectedUris.has(f.uri)),
    [discoveredFiles, selectedUris]
  );

  const allVisibleSelected =
    filteredFiles.length > 0 && filteredFiles.every((f) => selectedUris.has(f.uri));

  const toggleSelectUri = (uri: string) => {
    setSelectedUris((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedUris((prev) => {
        const next = new Set(prev);
        for (const f of filteredFiles) next.delete(f.uri);
        return next;
      });
    } else {
      setSelectedUris((prev) => {
        const next = new Set(prev);
        for (const f of filteredFiles) next.add(f.uri);
        return next;
      });
    }
  };

  const handleSelectAllNewVisible = () => {
    setSelectedUris((prev) => {
      const next = new Set(prev);
      for (const f of visibleNewFiles) next.add(f.uri);
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedUris(new Set());
  };

  const parsedTags = tagsDraft
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const buildMetaForm = (): PersonalImportMetadataForm => ({
    title: title.trim() || 'Untitled Work',
    author: author.trim(),
    era: era.trim() || 'Personal',
    collection: collection.trim() || 'Personal Library',
    tags: parsedTags,
    notes: notes.trim(),
    includeInResonance,
  });

  const handleInspectFile = async (file: DiscoveredFolderFile) => {
    setInspectingFile(file.uri);
    setLocalError(null);
    try {
      const result = await inspectFile(file);
      setInspected(result);
      resetForm({
        title: result.processed.suggestedTitle,
        author: result.processed.suggestedAuthor,
        era: result.processed.suggestedEra || 'Personal',
        collection: 'Personal Library',
        tags: result.processed.suggestedTags,
        notes: result.processed.suggestedNotes,
        includeInResonance: !result.processed.ocrRequired,
      });
      setStep('review');
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : `Could not read ${file.filename}`
      );
    } finally {
      setInspectingFile(null);
    }
  };

  const handlePickFiles = async () => {
    setPickingFiles(true);
    setLocalError(null);
    try {
      const added = await pickFiles();
      if (added.length === 1) {
        await handleInspectFile(added[0]);
      } else if (added.length > 1) {
        // Pre-select newly picked files so the user can import them in 1 tap
        setSelectedUris((prev) => {
          const next = new Set(prev);
          for (const f of added) next.add(f.uri);
          return next;
        });
      }
    } finally {
      setPickingFiles(false);
    }
  };

  const handleBatchImportFiles = async (targets: DiscoveredFolderFile[]) => {
    if (targets.length === 0) return;
    setLocalError(null);
    clearBatchBanner();
    setSelectedUris(new Set());
    void startBatchImport(targets);
  };

  const handleCommitReviewedImport = async (replaceExistingBookId?: string) => {
    if (!inspected) return;
    if (inspected.processed.chunks.length === 0) {
      setLocalError('No readable passages were extracted from this file.');
      return;
    }
    setSaving(true);
    setLocalError(null);
    try {
      const saved = await commitImport(inspected, buildMetaForm(), {
        replaceExistingBookId,
      });
      onClose();
      onImportedBook?.(saved.bookId);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save work.');
    } finally {
      setSaving(false);
    }
  };

  const handleImportPaste = async () => {
    if (pasteText.trim().length < 20) {
      setLocalError('Paste at least a short paragraph before importing.');
      return;
    }
    setSaving(true);
    setLocalError(null);
    try {
      const saved = await importPastedText(pasteText, pasteFormat, buildMetaForm());
      onClose();
      onImportedBook?.(saved.bookId);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to import text.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMetadataEdits = async () => {
    if (!editingWork) return;
    setSaving(true);
    setLocalError(null);
    try {
      await updateMetadata(editingWork.bookId, buildMetaForm());
      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not update metadata.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteWork = () => {
    if (!editingWork) return;
    Alert.alert(
      'Remove from Personal Library?',
      `"${editingWork.title}" and its on-device embeddings will be removed from Resonance. Your original file outside the app is untouched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void removeWork(editingWork.bookId).then(() => onClose());
          },
        },
      ]
    );
  };

  const newFilesCount = totalNewCount;
  const visibleFiles = useMemo(
    () => filteredFiles.slice(0, visibleLimit),
    [filteredFiles, visibleLimit]
  );
  const remainingHiddenCount = Math.max(0, filteredFiles.length - visibleFiles.length);

  const modalHeader = (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        {step === 'review' ? (
          <Pressable
            onPress={() => setStep('folder')}
            hitSlop={10}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back to files"
          >
            <Feather name="arrow-left" size={18} color={colors.accent} />
          </Pressable>
        ) : null}
        <Text style={styles.headerTitle} numberOfLines={1}>
          {step === 'edit'
            ? 'Edit Book Metadata'
            : step === 'review'
              ? 'Review & Edit Metadata'
              : 'Add to Your Library'}
        </Text>
      </View>
      <Pressable
        onPress={handleClose}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
      >
        <Feather name="x" size={20} color={colors.textSecondary} />
      </Pressable>
    </View>
  );

  const modalFooter =
    step === 'folder' && selectedFiles.length > 0 ? (
      <View style={styles.selectionFooter}>
        <View style={styles.selectionFooterLeft}>
          <Text style={styles.selectionFooterCount}>
            {batchImporting && batchProgress
              ? `Importing ${batchProgress.currentIndex} of ${batchProgress.total}…`
              : `${selectedFiles.length} selected`}
          </Text>
          {!batchImporting ? (
            <Pressable onPress={handleClearSelection} hitSlop={8}>
              <Text style={styles.selectionFooterClear}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => void handleBatchImportFiles(selectedFiles)}
          disabled={batchImporting}
          style={[
            styles.selectionFooterImportBtn,
            batchImporting && styles.disabledBtn,
          ]}
        >
          {batchImporting ? (
            <ActivityIndicator size="small" color={colors.surface} />
          ) : (
            <Feather name="download" size={14} color={colors.surface} />
          )}
          <Text style={styles.selectionFooterImportText}>
            {batchImporting ? 'Importing…' : `Import ${selectedFiles.length}`}
          </Text>
        </Pressable>
      </View>
    ) : null;

  return (
    <BottomSheetModal
      visible={visible}
      onClose={handleClose}
      height="90%"
      header={modalHeader}
      footer={modalFooter}
    >

          {/* Source Switcher (Files & Folder vs Paste Text) */}
          {step === 'folder' || step === 'paste' ? (
            <View style={styles.modeTabs}>
              <Pressable
                onPress={() => setStep('folder')}
                style={[styles.modeTab, step === 'folder' && styles.modeTabActive]}
              >
                <Text
                  style={[
                    styles.modeTabText,
                    step === 'folder' && styles.modeTabTextActive,
                  ]}
                >
                  Files &amp; Folder
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setStep('paste')}
                style={[styles.modeTab, step === 'paste' && styles.modeTabActive]}
              >
                <Text
                  style={[
                    styles.modeTabText,
                    step === 'paste' && styles.modeTabTextActive,
                  ]}
                >
                  Paste Text / Notes
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* Pinned Batch Import Progress Banner (always visible during batch import) */}
          {batchImporting && batchProgress ? (
            <View style={styles.batchBanner}>
              <View style={styles.batchBannerTop}>
                <ActivityIndicator size="small" color={colors.accent} />
                <View style={styles.flexOne}>
                  <Text style={styles.batchBannerTitle} numberOfLines={1}>
                    Importing {batchProgress.currentIndex} of {batchProgress.total} (
                    {Math.round(
                      ((batchProgress.imported +
                        batchProgress.skipped +
                        batchProgress.failed) /
                        Math.max(1, batchProgress.total)) *
                        100
                    )}
                    %)
                  </Text>
                  <Text style={styles.batchBannerSub} numberOfLines={1}>
                    {batchProgress.stage === 'downloading'
                      ? 'Downloading'
                      : batchProgress.stage === 'extracting'
                        ? 'Extracting chapters'
                        : 'Saving to Library'}
                    : {batchProgress.currentFilename}
                  </Text>
                </View>
                <Pressable
                  onPress={() => cancelBatchImport()}
                  style={styles.batchCancelBtn}
                >
                  <Text style={styles.batchCancelText}>Stop</Text>
                </Pressable>
              </View>
              <View style={styles.batchTrack}>
                <View
                  style={[
                    styles.batchFill,
                    {
                      width: `${Math.max(
                        4,
                        Math.min(
                          100,
                          Math.round(
                            ((batchProgress.imported +
                              batchProgress.skipped +
                              batchProgress.failed +
                              0.35) /
                              Math.max(1, batchProgress.total)) *
                              100
                          )
                        )
                      )}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.batchCounts}>
                {batchProgress.imported} imported
                {batchProgress.skipped > 0 ? ` · ${batchProgress.skipped} already in Library` : ''}
                {batchProgress.failed > 0 ? ` · ${batchProgress.failed} failed` : ''}
                {' · Continues in background if closed'}
              </Text>
            </View>
          ) : null}

          {/* Pinned Live On-Device Embedding Progress Bar (model load, chunks, or error) */}
          {!batchImporting ? (
            <EmbeddingProgressCard compact onOpenEngineSheet={handleClose} />
          ) : null}

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollBody}
          >
            {localError || batchError || scanError ? (
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>
                  {localError ?? batchError ?? scanError}
                </Text>
              </View>
            ) : null}

            {batchSummary && step === 'folder' ? (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>{batchSummary}</Text>
              </View>
            ) : null}

            {scanNotice && step === 'folder' ? (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>{scanNotice}</Text>
              </View>
            ) : null}

            {/* ── STEP 1: INDIVIDUAL FILES, CONNECTED FOLDER & INBOX ─────── */}
            {step === 'folder' ? (
              <>
                <View style={styles.card}>
                  <View style={styles.cardRowBetween}>
                    <View style={styles.flexOne}>
                      <Text style={styles.cardTitle}>Import Individual Files</Text>
                      <Text style={styles.cardMeta}>
                        Pick one or more books from your phone, Google Drive, iCloud, or
                        Downloads. Copied and embedded locally on your device.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.inlineBtnRow}>
                    <Pressable
                      onPress={() => void handlePickFiles()}
                      disabled={pickingFiles || inspectingFile !== null || batchImporting}
                      style={[
                        styles.accentFilledBtn,
                        (pickingFiles || inspectingFile !== null || batchImporting) &&
                          styles.disabledBtn,
                      ]}
                    >
                      {pickingFiles ? (
                        <ActivityIndicator size="small" color={colors.surface} />
                      ) : (
                        <Feather name="file-plus" size={14} color={colors.surface} />
                      )}
                      <Text style={styles.accentFilledText}>
                        {pickingFiles ? 'Opening files…' : 'Choose files'}
                      </Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.card}>
                  <View style={styles.cardRowBetween}>
                    <View style={styles.flexOne}>
                      <Text style={styles.cardTitle}>Connected Folder</Text>
                      <Text style={styles.cardMeta}>
                        {connectedFolderLabel
                          ? `${connectedFolderLabel} · includes subfolders`
                          : 'Optional — link a folder on your device, Google Drive, or iCloud. Subfolders are scanned automatically.'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.inlineBtnRow}>
                    <Pressable
                      onPress={() => void connectDeviceFolder()}
                      disabled={batchImporting}
                      style={styles.accentOutlineBtn}
                    >
                      <Feather name="folder-plus" size={14} color={colors.accent} />
                      <Text style={styles.accentOutlineText}>
                        {connectedFolderLabel ? 'Change folder' : 'Choose folder'}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => void scanFolders()}
                      style={styles.subtleBtn}
                      disabled={scanning || batchImporting}
                    >
                      <Feather name="refresh-cw" size={14} color={colors.textSecondary} />
                      <Text style={styles.subtleBtnText}>
                        {scanning ? 'Scanning…' : 'Scan now'}
                      </Text>
                    </Pressable>

                    {connectedFolderLabel ? (
                      <Pressable
                        onPress={() => void disconnectDeviceFolder()}
                        disabled={batchImporting}
                        style={styles.subtleBtn}
                      >
                        <Text style={styles.subtleBtnText}>Unlink</Text>
                      </Pressable>
                    ) : null}
                  </View>

                  <Text style={styles.inboxNote} numberOfLines={2}>
                    Managed inbox: {PERSONAL_INBOX_DIR.replace(/^file:\/\//, '')}
                  </Text>
                </View>

                {/* Supported formats & honest guidance (chunking-spec §7.2) */}
                <View style={styles.formatRow}>
                  {['EPUB', 'PDF', 'DOCX', 'HTML', 'MD', 'TXT'].map((fmt) => (
                    <View key={fmt} style={styles.formatPill}>
                      <Text style={styles.formatPillText}>{fmt}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.guidanceText}>
                  EPUB preserves chapters and metadata best. Text-based PDFs import
                  cleanly; scanned image PDFs are flagged so garbled text never
                  pollutes your echoes. Everything stays on your device.
                </Text>

                {/* Discovered Files Header + Quick Select Bar */}
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionLabel}>
                    READY TO IMPORT ({filteredFiles.length}
                    {filteredFiles.length !== discoveredFiles.length
                      ? ` OF ${discoveredFiles.length}`
                      : ''}
                    )
                  </Text>
                  {newFilesCount > 1 && selectedFiles.length === 0 ? (
                    <Pressable
                      onPress={() =>
                        void handleBatchImportFiles(
                          discoveredFiles.filter((f) => !f.alreadyImportedBookId)
                        )
                      }
                      disabled={batchImporting || scanning}
                    >
                      <Text style={styles.batchLink}>
                        {batchImporting
                          ? 'Importing…'
                          : `Import all ${newFilesCount} new`}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>

                {/* Search, Filter, Sort & Quick Select Controls */}
                {!scanning && discoveredFiles.length > 0 ? (
                  <View style={styles.listControls}>
                    {/* Search input */}
                    <View style={styles.searchWrap}>
                      <Feather name="search" size={15} color={colors.textTertiary} />
                      <TextInput
                        style={styles.searchInput}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder="Search books, subfolders, or formats…"
                        placeholderTextColor={colors.placeholder}
                      />
                      {searchQuery.length > 0 ? (
                        <Pressable
                          onPress={() => setSearchQuery('')}
                          hitSlop={8}
                          accessibilityLabel="Clear search"
                        >
                          <Feather name="x-circle" size={15} color={colors.textTertiary} />
                        </Pressable>
                      ) : null}
                    </View>

                    {/* Status + Format filter pills */}
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.pillScroll}
                      contentContainerStyle={styles.pillScrollContent}
                    >
                      {(
                        [
                          { key: 'all', label: `All (${discoveredFiles.length})` },
                          { key: 'new', label: `New (${totalNewCount})` },
                          { key: 'imported', label: `In Library (${totalImportedCount})` },
                        ] as Array<{ key: StatusFilter; label: string }>
                      ).map((opt) => {
                        const active = statusFilter === opt.key;
                        return (
                          <Pressable
                            key={opt.key}
                            onPress={() => setStatusFilter(opt.key)}
                            style={[styles.filterPill, active && styles.filterPillActive]}
                          >
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.filterPillText,
                                active && styles.filterPillTextActive,
                              ]}
                            >
                              {opt.label}
                            </Text>
                          </Pressable>
                        );
                      })}

                      {availableFormats.length > 1 ? (
                        <>
                          <View style={styles.pillDivider} />
                          <Pressable
                            onPress={() => setFormatFilter('all')}
                            style={[
                              styles.filterPill,
                              formatFilter === 'all' && styles.filterPillActive,
                            ]}
                          >
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.filterPillText,
                                formatFilter === 'all' && styles.filterPillTextActive,
                              ]}
                            >
                              All types
                            </Text>
                          </Pressable>
                          {availableFormats.map(([fmt, count]) => {
                            const active = formatFilter === fmt;
                            return (
                              <Pressable
                                key={fmt}
                                onPress={() =>
                                  setFormatFilter(active ? 'all' : fmt)
                                }
                                style={[
                                  styles.filterPill,
                                  active && styles.filterPillActive,
                                ]}
                              >
                                <Text
                                  numberOfLines={1}
                                  style={[
                                    styles.filterPillText,
                                    active && styles.filterPillTextActive,
                                  ]}
                                >
                                  {fmt.toUpperCase()} ({count})
                                </Text>
                              </Pressable>
                            );
                          })}
                        </>
                      ) : null}
                    </ScrollView>

                    {/* Subfolder filter pills (only shown when files span subfolders) */}
                    {availableSubfolders.list.length > 0 ? (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.pillScroll}
                        contentContainerStyle={styles.pillScrollContent}
                      >
                        <Pressable
                          onPress={() => setSubfolderFilter('all')}
                          style={[
                            styles.filterPill,
                            subfolderFilter === 'all' && styles.filterPillActive,
                          ]}
                        >
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.filterPillText,
                              subfolderFilter === 'all' && styles.filterPillTextActive,
                            ]}
                          >
                            All folders
                          </Text>
                        </Pressable>
                        {availableSubfolders.hasRoot ? (
                          <Pressable
                            onPress={() =>
                              setSubfolderFilter(
                                subfolderFilter === '__root__' ? 'all' : '__root__'
                              )
                            }
                            style={[
                              styles.filterPill,
                              subfolderFilter === '__root__' && styles.filterPillActive,
                            ]}
                          >
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.filterPillText,
                                subfolderFilter === '__root__' &&
                                  styles.filterPillTextActive,
                              ]}
                            >
                              Top folder
                            </Text>
                          </Pressable>
                        ) : null}
                        {availableSubfolders.list.map(([sub, count]) => {
                          const active = subfolderFilter === sub;
                          return (
                            <Pressable
                              key={sub}
                              onPress={() =>
                                setSubfolderFilter(active ? 'all' : sub)
                              }
                              style={[
                                styles.filterPill,
                                active && styles.filterPillActive,
                              ]}
                            >
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.filterPillText,
                                  active && styles.filterPillTextActive,
                                ]}
                              >
                                {sub} ({count})
                              </Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    ) : null}

                    {/* Sort pills */}
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.pillScroll}
                      contentContainerStyle={styles.pillScrollContent}
                    >
                      <Text style={styles.sortPrefix}>Sort:</Text>
                      {SORT_OPTIONS.map((opt) => {
                        const active = sortBy === opt.key;
                        return (
                          <Pressable
                            key={opt.key}
                            onPress={() => setSortBy(opt.key)}
                            style={[styles.sortPill, active && styles.sortPillActive]}
                          >
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.sortPillText,
                                active && styles.sortPillTextActive,
                              ]}
                            >
                              {opt.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>

                    {/* Quick selection toolbar */}
                    <View style={styles.quickSelectBar}>
                      <Pressable
                        onPress={handleSelectAllVisible}
                        disabled={filteredFiles.length === 0 || batchImporting}
                        style={styles.quickSelectBtn}
                      >
                        <Feather
                          name={allVisibleSelected ? 'check-square' : 'square'}
                          size={13}
                          color={colors.accent}
                        />
                        <Text style={styles.quickSelectBtnText}>
                          {allVisibleSelected
                            ? `Deselect visible (${filteredFiles.length})`
                            : `Select all (${filteredFiles.length})`}
                        </Text>
                      </Pressable>

                      {visibleNewFiles.length > 0 &&
                      visibleNewFiles.length < filteredFiles.length ? (
                        <Pressable
                          onPress={handleSelectAllNewVisible}
                          disabled={batchImporting}
                          style={styles.quickSelectBtn}
                        >
                          <Text style={styles.quickSelectBtnText}>
                            Select new ({visibleNewFiles.length})
                          </Text>
                        </Pressable>
                      ) : null}

                      {selectedFiles.length > 0 ? (
                        <Pressable
                          onPress={handleClearSelection}
                          disabled={batchImporting}
                          style={styles.quickClearBtn}
                        >
                          <Text style={styles.quickClearBtnText}>
                            Clear ({selectedFiles.length})
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                ) : null}

                {scanning ? (
                  <View style={styles.centerPad}>
                    <ActivityIndicator color={colors.accent} />
                    <Text style={styles.scanProgressText}>
                      {scanProgress && scanProgress.foldersScanned > 0
                        ? `Scanning folders (${scanProgress.foldersScanned} checked · ${scanProgress.filesFound} book${scanProgress.filesFound === 1 ? '' : 's'} found)…`
                        : 'Scanning folder & subfolders…'}
                    </Text>
                    <Pressable
                      onPress={cancelScan}
                      style={styles.subtleBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Stop scan"
                    >
                      <Text style={styles.subtleBtnText}>Stop scan</Text>
                    </Pressable>
                  </View>
                ) : discoveredFiles.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyCardTitle}>No books selected yet</Text>
                    <Text style={styles.emptyCardBody}>
                      Tap &ldquo;Choose files&rdquo; above to pick individual EPUB, PDF,
                      DOCX, Markdown, HTML, or TXT files — or link a folder to scan all
                      books inside it and its subfolders.
                    </Text>
                  </View>
                ) : filteredFiles.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyCardTitle}>No matching books</Text>
                    <Text style={styles.emptyCardBody}>
                      Try clearing your search or switching the filter pills above.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.card}>
                    {visibleFiles.map((file, idx) => {
                      const isInspecting = inspectingFile === file.uri;
                      const isSelected = selectedUris.has(file.uri);
                      const locationLabel = file.subfolder
                        ? file.subfolder
                        : file.source === 'picked'
                          ? 'Selected file'
                          : file.source === 'inbox'
                            ? 'Inbox'
                            : 'Connected folder';
                      return (
                        <View key={file.uri}>
                          {idx > 0 ? <View style={styles.divider} /> : null}
                          <View style={styles.fileRow}>
                            <Pressable
                              onPress={() => toggleSelectUri(file.uri)}
                              disabled={batchImporting}
                              hitSlop={8}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: isSelected }}
                              style={[
                                styles.checkbox,
                                isSelected && styles.checkboxChecked,
                              ]}
                            >
                              {isSelected ? (
                                <Feather name="check" size={12} color={colors.surface} />
                              ) : null}
                            </Pressable>

                            <Pressable
                              onPress={() => {
                                if (selectedUris.size > 0) {
                                  toggleSelectUri(file.uri);
                                } else {
                                  void handleInspectFile(file);
                                }
                              }}
                              disabled={inspectingFile !== null || batchImporting}
                              style={styles.fileRowMain}
                            >
                              <View style={styles.fileBadge}>
                                <Text style={styles.fileBadgeText}>
                                  {file.format.toUpperCase()}
                                </Text>
                              </View>
                              <View style={styles.flexOne}>
                                <Text style={styles.fileName} numberOfLines={1}>
                                  {file.filename}
                                </Text>
                                <Text style={styles.fileSub} numberOfLines={1}>
                                  {file.sizeBytes > 0
                                    ? `${formatBytes(file.sizeBytes)} · `
                                    : ''}
                                  {locationLabel}
                                  {file.alreadyImportedBookId ? ' · In Library' : ' · New'}
                                </Text>
                              </View>
                            </Pressable>

                            <Pressable
                              onPress={() => void handleInspectFile(file)}
                              disabled={inspectingFile !== null || batchImporting}
                              hitSlop={8}
                              accessibilityLabel={`Review ${file.filename}`}
                              style={styles.inspectChevronBtn}
                            >
                              {isInspecting ? (
                                <ActivityIndicator size="small" color={colors.accent} />
                              ) : (
                                <Feather
                                  name="chevron-right"
                                  size={18}
                                  color={colors.textTertiary}
                                />
                              )}
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                    {remainingHiddenCount > 0 ? (
                      <>
                        <View style={styles.divider} />
                        <Pressable
                          onPress={() => setVisibleLimit((n) => n + PAGE_SIZE)}
                          style={styles.showMoreBtn}
                          accessibilityRole="button"
                        >
                          <Text style={styles.showMoreText}>
                            Show {Math.min(PAGE_SIZE, remainingHiddenCount)} more (
                            {remainingHiddenCount} remaining)
                          </Text>
                        </Pressable>
                      </>
                    ) : null}
                  </View>
                )}
              </>
            ) : null}

            {/* ── PASTE TEXT / NOTES MODE ───────────────────────────────── */}
            {step === 'paste' ? (
              <>
                <View style={styles.card}>
                  <View style={styles.cardRowBetween}>
                    <Text style={styles.cardTitle}>Source Format</Text>
                    <View style={styles.inlineChipRow}>
                      {(['md', 'txt'] as const).map((fmt) => (
                        <Pressable
                          key={fmt}
                          onPress={() => setPasteFormat(fmt)}
                          style={[
                            styles.chip,
                            pasteFormat === fmt && styles.chipActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              pasteFormat === fmt && styles.chipTextActive,
                            ]}
                          >
                            {fmt === 'md' ? 'Markdown' : 'Plain Text'}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  <TextInput
                    style={[styles.input, styles.multilineInput]}
                    value={pasteText}
                    onChangeText={setPasteText}
                    placeholder="Paste a sermon, letter, book excerpt, or OCR'd text. Use # Heading lines for chapters…"
                    placeholderTextColor={colors.placeholder}
                    multiline
                    textAlignVertical="top"
                  />
                </View>

                <MetadataFields
                  title={title}
                  setTitle={setTitle}
                  author={author}
                  setAuthor={setAuthor}
                  era={era}
                  setEra={setEra}
                  collection={collection}
                  setCollection={setCollection}
                  tagsDraft={tagsDraft}
                  setTagsDraft={setTagsDraft}
                  parsedTags={parsedTags}
                  notes={notes}
                  setNotes={setNotes}
                  includeInResonance={includeInResonance}
                  setIncludeInResonance={setIncludeInResonance}
                />

                <Pressable
                  onPress={() => void handleImportPaste()}
                  disabled={saving}
                  style={styles.primaryBtn}
                >
                  <Text style={styles.primaryBtnText}>
                    {saving ? 'Adding to Library…' : 'Add to Library'}
                  </Text>
                </Pressable>
              </>
            ) : null}

            {/* ── STEP 2: REVIEW EXTRACTION + METADATA BEFORE IMPORT ────── */}
            {step === 'review' && inspected ? (
              <>
                {/* Extraction Diagnostics Card */}
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Extraction Summary</Text>
                  <View style={styles.statsGrid}>
                    <StatPill
                      label="Format"
                      value={inspected.processed.format.toUpperCase()}
                    />
                    <StatPill
                      label="Sections"
                      value={String(Math.max(1, inspected.processed.divisions.length))}
                    />
                    <StatPill
                      label="Passages"
                      value={String(inspected.processed.chunks.length)}
                    />
                    <StatPill
                      label="Words"
                      value={inspected.processed.wordCount.toLocaleString()}
                    />
                  </View>

                  {inspected.processed.quarantinedCount > 0 ? (
                    <Text style={styles.cardMeta}>
                      Quarantined {inspected.processed.quarantinedCount} low-quality/index
                      block(s) automatically.
                    </Text>
                  ) : null}

                  {inspected.processed.warnings.map((w, i) => (
                    <View key={i} style={styles.warningBox}>
                      <Text style={styles.warningText}>{w}</Text>
                    </View>
                  ))}

                  {inspected.duplicateWork ? (
                    <View style={styles.infoBox}>
                      <Text style={styles.infoText}>
                        This exact file is already in your Library as &ldquo;
                        {inspected.duplicateWork.title}&rdquo;. You can replace it or
                        import a separate copy.
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Preview of first 2 rendered chunks */}
                {inspected.processed.chunks.length > 0 ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Rendered Passage Preview</Text>
                    {inspected.processed.chunks.slice(0, 2).map((chunk) => (
                      <View key={chunk.chunkIndex} style={styles.previewChunk}>
                        {chunk.division ? (
                          <Text style={styles.previewDivision}>{chunk.division}</Text>
                        ) : null}
                        <Text style={styles.previewText} numberOfLines={4}>
                          {chunk.text}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* Full Metadata Editor */}
                <MetadataFields
                  title={title}
                  setTitle={setTitle}
                  author={author}
                  setAuthor={setAuthor}
                  era={era}
                  setEra={setEra}
                  collection={collection}
                  setCollection={setCollection}
                  tagsDraft={tagsDraft}
                  setTagsDraft={setTagsDraft}
                  parsedTags={parsedTags}
                  notes={notes}
                  setNotes={setNotes}
                  includeInResonance={includeInResonance}
                  setIncludeInResonance={setIncludeInResonance}
                />

                {!embedderReady ? (
                  <View style={styles.infoBox}>
                    <Text style={styles.infoText}>
                      The Offline Engine isn&apos;t downloaded yet. This book will be
                      readable in your Library immediately
                      {autoEmbedPersonalFiles
                        ? ' and will embed automatically once the engine is ready.'
                        : '.'}
                    </Text>
                  </View>
                ) : !autoEmbedPersonalFiles ? (
                  <View style={styles.infoBox}>
                    <Text style={styles.infoText}>
                      Auto-embedding is turned off in Settings. You can embed this book
                      anytime from its Edit sheet or Settings → Personal Library.
                    </Text>
                  </View>
                ) : null}

                <View style={styles.actionStack}>
                  <Pressable
                    onPress={() => void handleCommitReviewedImport()}
                    disabled={saving || inspected.processed.chunks.length === 0}
                    style={[
                      styles.primaryBtn,
                      inspected.processed.chunks.length === 0 && styles.disabledBtn,
                    ]}
                  >
                    <Text style={styles.primaryBtnText}>
                      {saving
                        ? 'Saving to Library…'
                        : inspected.duplicateWork
                          ? 'Import as New Copy'
                          : 'Add to Library'}
                    </Text>
                  </Pressable>

                  {inspected.duplicateWork ? (
                    <Pressable
                      onPress={() =>
                        void handleCommitReviewedImport(
                          inspected.duplicateWork?.bookId
                        )
                      }
                      disabled={saving}
                      style={styles.secondaryBtn}
                    >
                      <Text style={styles.secondaryBtnText}>
                        Replace &ldquo;{inspected.duplicateWork.title}&rdquo;
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : null}

            {/* ── EDIT EXISTING PERSONAL WORK METADATA & EMBEDDING ─────── */}
            {step === 'edit' && liveEditingWork ? (
              <>
                <View style={styles.card}>
                  <View style={styles.cardRowBetween}>
                    <Text style={styles.cardTitle}>Embedding Status</Text>
                    <View style={styles.formatPill}>
                      <Text style={styles.formatPillText}>
                        {liveEditingWork.sourceFormat.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  {(() => {
                    const activeBookModel = useOpenRouterStore.getState().hasKey &&
                      useOpenRouterStore.getState().routingMode !== 'local_only' &&
                      useOpenRouterStore.getState().features.embeddings
                      ? useOpenRouterStore.getState().embeddingModel
                      : 'voyage-4-nano';
                    const storedModel = liveEditingWork.embeddingModel || 'voyage-4-nano';
                    const isStoredCloud = storedModel !== 'voyage-4-nano';
                    const storedSpaceMatches =
                      storedModel === activeBookModel ||
                      (storedModel.toLowerCase().includes('voyage-4') &&
                        activeBookModel.toLowerCase().includes('voyage-4'));
                    return (
                      <>
                        <Text style={styles.cardMeta}>
                          {liveEditingWork.embeddingStatus === 'ready'
                            ? `Embedded (${liveEditingWork.embeddedChunks}/${liveEditingWork.totalChunks} passages · ${isStoredCloud ? `OpenRouter: ${storedModel}` : 'On-Device: Voyage-4-Nano 512d'})`
                            : liveEditingWork.embeddingStatus === 'embedding' ||
                                embeddingActiveBookId === liveEditingWork.bookId
                              ? `Embedding via ${openRouterEmbedReady ? `OpenRouter (${activeBookModel})` : 'On-Device (Voyage-4-Nano)'} (${liveEditingWork.embeddedChunks} / ${liveEditingWork.totalChunks} passages)…`
                              : liveEditingWork.embeddingStatus === 'error'
                                ? liveEditingWork.lastError ?? 'Embedding paused before finishing.'
                                : !embedderReady
                                  ? `Waiting for embedder — download Offline Engine or connect OpenRouter in Settings (${liveEditingWork.totalChunks} passages readable now)`
                                  : autoEmbedPersonalFiles
                                    ? `Queued for ${openRouterEmbedReady ? `OpenRouter (${activeBookModel})` : 'On-Device'} embedding (${liveEditingWork.embeddedChunks}/${liveEditingWork.totalChunks} passages)`
                                    : `Not embedded yet (${liveEditingWork.totalChunks} passages · auto-embedding is off in Settings)`}
                        </Text>
                        {liveEditingWork.embeddingStatus === 'ready' && !storedSpaceMatches ? (
                          <Text style={[styles.cardMeta, { color: '#9c6419', marginTop: 4 }]}>
                            Note: embedded with {storedModel}, but your active model is {activeBookModel}. Tap Re-embed below to include this book in your active space.
                          </Text>
                        ) : null}
                      </>
                    );
                  })()}

                  {liveEditingWork.ocrRequired ? (
                    <View style={styles.inlineBtnRow}>
                      {openRouterPdfOcrEnabled ? (
                        <Pressable
                          disabled={ocrRunningBookId === liveEditingWork.bookId}
                          onPress={() => {
                            const est = estimatePdfOcrCost(liveEditingWork.fileSizeBytes);
                            if (est.tooLarge) {
                              Alert.alert(
                                'PDF too large for mobile OCR',
                                'Files over 12 MB should be split or compressed before transcribing via OpenRouter.'
                              );
                              return;
                            }
                            const costStr =
                              est.estimatedCostUsd < 0.01
                                ? `$${est.estimatedCostUsd.toFixed(4)}`
                                : `$${est.estimatedCostUsd.toFixed(2)}`;
                            Alert.alert(
                              'Transcribe Scanned PDF via OpenRouter?',
                              `Model: ${est.modelId}\nEstimated ~${est.estimatedPages} pages · est. ${costStr}.\n\nExtracted text will save locally and auto-embed for Resonance.`,
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Transcribe',
                                  onPress: () => {
                                    setOcrRunningBookId(liveEditingWork.bookId);
                                    void transcribeScannedPersonalPdf(liveEditingWork.bookId)
                                      .then(async (res) => {
                                        await refreshWorks();
                                        void processEmbeddingQueue({ force: true });
                                        Alert.alert(
                                          'OCR Complete',
                                          `Extracted ${res.chunkCount} passages via ${res.modelUsed}.`
                                        );
                                      })
                                      .catch((err) => {
                                        Alert.alert(
                                          'OCR Failed',
                                          err instanceof Error ? err.message : 'Please try again.'
                                        );
                                      })
                                      .finally(() => setOcrRunningBookId(null));
                                  },
                                },
                              ]
                            );
                          }}
                          style={styles.accentFilledBtn}
                        >
                          {ocrRunningBookId === liveEditingWork.bookId ? (
                            <ActivityIndicator size="small" color={colors.surface} />
                          ) : (
                            <Feather name="file-text" size={14} color={colors.surface} />
                          )}
                          <Text style={styles.accentFilledText}>
                            {ocrRunningBookId === liveEditingWork.bookId
                              ? 'Transcribing PDF…'
                              : 'Transcribe Scanned PDF (OpenRouter)'}
                          </Text>
                        </Pressable>
                      ) : (
                        <Text style={styles.cardMeta}>
                          Scanned PDF requires OCR — enable OpenRouter Scanned PDF OCR in Settings
                          to transcribe it automatically.
                        </Text>
                      )}
                    </View>
                  ) : !embedderReady ? (
                    <View style={styles.inlineBtnRow}>
                      <Pressable
                        onPress={() => {
                          handleClose();
                          setEngineSheetVisible(true);
                        }}
                        style={styles.accentOutlineBtn}
                      >
                        <Feather name="download" size={14} color={colors.accent} />
                        <Text style={styles.accentOutlineText}>
                          Download Offline Engine
                        </Text>
                      </Pressable>
                    </View>
                  ) : liveEditingWork.embeddingStatus === 'embedding' ||
                    embeddingActiveBookId === liveEditingWork.bookId ? (
                    <View style={styles.inlineBtnRow}>
                      <ActivityIndicator size="small" color={colors.accent} />
                      <Text style={styles.cardMeta}>Running in background…</Text>
                    </View>
                  ) : liveEditingWork.embeddingStatus === 'ready' ? (
                    <View style={styles.inlineBtnRow}>
                      <Pressable
                        onPress={() => void reembedWork(liveEditingWork.bookId)}
                        style={styles.accentOutlineBtn}
                      >
                        <Feather name="cpu" size={14} color={colors.accent} />
                        <Text style={styles.accentOutlineText}>
                          Re-embed passages
                        </Text>
                      </Pressable>
                    </View>
                  ) : liveEditingWork.embeddingStatus === 'error' ? (
                    <View style={styles.inlineBtnRow}>
                      <Pressable
                        onPress={() =>
                          void processEmbeddingQueue({
                            force: true,
                            retryErrors: true,
                          })
                        }
                        style={styles.accentOutlineBtn}
                      >
                        <Feather name="cpu" size={14} color={colors.accent} />
                        <Text style={styles.accentOutlineText}>
                          Retry embedding
                        </Text>
                      </Pressable>
                    </View>
                  ) : !autoEmbedPersonalFiles ? (
                    <View style={styles.inlineBtnRow}>
                      <Pressable
                        onPress={() =>
                          void processEmbeddingQueue({
                            force: true,
                            retryErrors: true,
                          })
                        }
                        style={styles.accentOutlineBtn}
                      >
                        <Feather name="cpu" size={14} color={colors.accent} />
                        <Text style={styles.accentOutlineText}>Embed now</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>

                <MetadataFields
                  title={title}
                  setTitle={setTitle}
                  author={author}
                  setAuthor={setAuthor}
                  era={era}
                  setEra={setEra}
                  collection={collection}
                  setCollection={setCollection}
                  tagsDraft={tagsDraft}
                  setTagsDraft={setTagsDraft}
                  parsedTags={parsedTags}
                  notes={notes}
                  setNotes={setNotes}
                  includeInResonance={includeInResonance}
                  setIncludeInResonance={setIncludeInResonance}
                />

                <View style={styles.actionStack}>
                  <Pressable
                    onPress={() => void handleSaveMetadataEdits()}
                    disabled={saving}
                    style={styles.primaryBtn}
                  >
                    <Text style={styles.primaryBtnText}>
                      {saving ? 'Saving…' : 'Save Metadata'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleDeleteWork}
                    style={styles.destructiveBtn}
                  >
                    <Text style={styles.destructiveBtnText}>
                      Remove from Personal Library
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </ScrollView>
    </BottomSheetModal>
  );
}

// ── Reusable Metadata Form Fields ───────────────────────────────────────────

function MetadataFields(props: {
  title: string;
  setTitle: (v: string) => void;
  author: string;
  setAuthor: (v: string) => void;
  era: string;
  setEra: (v: string) => void;
  collection: string;
  setCollection: (v: string) => void;
  tagsDraft: string;
  setTagsDraft: (v: string) => void;
  parsedTags: string[];
  notes: string;
  setNotes: (v: string) => void;
  includeInResonance: boolean;
  setIncludeInResonance: (v: boolean) => void;
}): ReactNode {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Work Metadata</Text>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Title</Text>
        <TextInput
          style={styles.input}
          value={props.title}
          onChangeText={props.setTitle}
          placeholder="Book or document title"
          placeholderTextColor={colors.placeholder}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Author</Text>
        <TextInput
          style={styles.input}
          value={props.author}
          onChangeText={props.setAuthor}
          placeholder="Author, preacher, or speaker (optional)"
          placeholderTextColor={colors.placeholder}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Era / Tradition</Text>
        <View style={styles.inlineChipRow}>
          {ERA_PRESETS.map((preset) => (
            <Pressable
              key={preset}
              onPress={() => props.setEra(preset)}
              style={[styles.chip, props.era === preset && styles.chipActive]}
            >
              <Text
                style={[
                  styles.chipText,
                  props.era === preset && styles.chipTextActive,
                ]}
              >
                {preset}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          style={styles.input}
          value={props.era}
          onChangeText={props.setEra}
          placeholder="Custom era or tradition"
          placeholderTextColor={colors.placeholder}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Library Shelf / Collection</Text>
        <View style={styles.inlineChipRow}>
          {COLLECTION_PRESETS.map((preset) => (
            <Pressable
              key={preset}
              onPress={() => props.setCollection(preset)}
              style={[
                styles.chip,
                props.collection === preset && styles.chipActive,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  props.collection === preset && styles.chipTextActive,
                ]}
              >
                {preset}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          style={styles.input}
          value={props.collection}
          onChangeText={props.setCollection}
          placeholder="Shelf name in Word → Library"
          placeholderTextColor={colors.placeholder}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Tags (comma-separated)</Text>
        <TextInput
          style={styles.input}
          value={props.tagsDraft}
          onChangeText={props.setTagsDraft}
          placeholder="prayer, grief, psalms, retreat"
          placeholderTextColor={colors.placeholder}
        />
        {props.parsedTags.length > 0 ? (
          <View style={styles.inlineChipRow}>
            {props.parsedTags.map((tag) => (
              <View key={tag} style={styles.tagPill}>
                <Text style={styles.tagPillText}>#{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Notes / Provenance</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          value={props.notes}
          onChangeText={props.setNotes}
          placeholder="Edition details, translation note, or personal context…"
          placeholderTextColor={colors.placeholder}
          multiline
          textAlignVertical="top"
        />
      </View>

      <View style={styles.divider} />

      <View style={styles.toggleRow}>
        <View style={styles.flexOne}>
          <Text style={styles.toggleLabel}>Include in Resonance echoes</Text>
          <Text style={styles.toggleHint}>
            When on, passages from this work can surface alongside Scripture and
            Voices as you journal.
          </Text>
        </View>
        <Switch
          value={props.includeInResonance}
          onValueChange={props.setIncludeInResonance}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor={colors.surface}
        />
      </View>
    </View>
  );
}

function StatPill({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  closeBtnPressed: {
    opacity: 0.65,
  },
  showMoreBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  showMoreText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13,
    color: colors.accent,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  modeTabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  modeTabActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  modeTabText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13.5,
    color: colors.textSecondary,
  },
  modeTabTextActive: {
    color: colors.surface,
  },
  batchBanner: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    padding: spacing.md,
    gap: spacing.xs + 2,
    marginBottom: spacing.sm,
  },
  batchBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  batchBannerTitle: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  batchBannerSub: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  batchCancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  batchCancelText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textSecondary,
  },
  batchTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  batchFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  batchCounts: {
    fontFamily: fontFamilies.sans,
    fontSize: 11.5,
    color: colors.textTertiary,
  },
  scrollBody: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: layout.cardPadding,
    gap: spacing.sm,
  },
  cardRowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  flexOne: {
    flex: 1,
  },
  cardTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  cardMeta: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  inboxNote: {
    fontFamily: fontFamilies.sans,
    fontSize: 11.5,
    color: colors.textTertiary,
  },
  inlineBtnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  accentFilledBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
  },
  accentFilledText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13.5,
    color: colors.surface,
  },
  accentOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.background,
  },
  accentOutlineText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.accent,
  },
  subtleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  subtleBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },
  formatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  formatPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#f3ede2',
  },
  formatPillText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11,
    color: colors.accent,
  },
  guidanceText: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textTertiary,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  sectionLabel: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11.5,
    letterSpacing: 0.6,
    color: colors.textTertiary,
  },
  batchLink: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13,
    color: colors.accent,
  },
  centerPad: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  emptyCardTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 17,
    color: colors.textSecondary,
  },
  emptyCardBody: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  listControls: {
    gap: spacing.xs + 2,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 0,
  },
  pillScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  pillScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
    paddingRight: spacing.md,
  },
  pillDivider: {
    width: 1,
    height: 18,
    backgroundColor: colors.border,
    marginHorizontal: 2,
  },
  filterPill: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterPillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  filterPillText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12.5,
    lineHeight: 16,
    includeFontPadding: false,
    color: colors.textSecondary,
  },
  filterPillTextActive: {
    color: colors.surface,
  },
  sortPrefix: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textTertiary,
    marginRight: 2,
  },
  sortPill: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  sortPillActive: {
    backgroundColor: '#f3ede2',
    borderColor: colors.accent,
  },
  sortPillText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    lineHeight: 16,
    includeFontPadding: false,
    color: colors.textSecondary,
  },
  sortPillTextActive: {
    color: colors.accent,
  },
  quickSelectBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingTop: 2,
  },
  quickSelectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  quickSelectBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    lineHeight: 16,
    includeFontPadding: false,
    color: colors.accent,
  },
  quickClearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
  },
  quickClearBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    lineHeight: 16,
    includeFontPadding: false,
    color: colors.textTertiary,
  },
  scanProgressText: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.textTertiary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  fileRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  inspectChevronBtn: {
    padding: 4,
  },
  fileBadge: {
    width: 44,
    paddingVertical: 5,
    borderRadius: radii.sm,
    backgroundColor: '#f3ede2',
    alignItems: 'center',
  },
  fileBadgeText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 10.5,
    color: colors.accent,
  },
  fileName: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  fileSub: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
  selectionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  selectionFooterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  selectionFooterCount: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  selectionFooterClear: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.textTertiary,
  },
  selectionFooterImportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.md,
  },
  selectionFooterImportText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 14,
    color: colors.surface,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statPill: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  statLabel: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
    color: colors.textTertiary,
  },
  previewChunk: {
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    padding: spacing.md,
    gap: 4,
  },
  previewDivision: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11.5,
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  previewText: {
    fontFamily: fontFamilies.serif,
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.textPrimary,
  },
  multilineInput: {
    minHeight: 150,
    fontFamily: fontFamilies.serif,
    fontSize: 15,
    lineHeight: 22,
  },
  notesInput: {
    minHeight: 72,
  },
  inlineChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.surface,
  },
  tagPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#f3ede2',
  },
  tagPillText: {
    fontFamily: fontFamilies.sans,
    fontSize: 11.5,
    color: colors.accent,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  toggleLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  toggleHint: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textTertiary,
    marginTop: 2,
  },
  warningBox: {
    backgroundColor: '#fdf6ea',
    borderColor: '#e5cfa5',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  warningText: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: '#7c5a20',
  },
  infoBox: {
    backgroundColor: '#f4f1ea',
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  infoText: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  actionStack: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  disabledBtn: {
    opacity: 0.45,
  },
  primaryBtnText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 15,
    color: colors.surface,
  },
  secondaryBtn: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textSecondary,
  },
  destructiveBtn: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#dfb8b8',
    paddingVertical: 12,
    alignItems: 'center',
  },
  destructiveBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: '#a85c5c',
  },
});
