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

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import type { PersonalWorkMetadata } from '@resonance/core';
import {
  PERSONAL_INBOX_DIR,
  usePersonalLibraryStore,
  type DiscoveredFolderFile,
  type InspectedDocument,
  type PersonalImportMetadataForm,
} from '../personal/personalLibraryService';
import { useOfflineEngineStore } from '../packages/offlineEngineManager';
import { formatBytes } from '../db/queries/settingsQueries';

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

export function PersonalLibraryImportModal({
  visible,
  editingWork = null,
  onClose,
  onImportedBook,
}: PersonalLibraryImportModalProps): ReactNode {
  const {
    connectedFolderLabel,
    discoveredFiles,
    scanning,
    scanError,
    embeddingActiveBookId,
    initialize,
    pickFiles,
    connectDeviceFolder,
    disconnectDeviceFolder,
    scanFolders,
    inspectFile,
    commitImport,
    importPastedText,
    updateMetadata,
    removeWork,
    reembedWork,
    processEmbeddingQueue,
  } = usePersonalLibraryStore();

  const enginePhase = useOfflineEngineStore((s) => s.phase);
  const setEngineSheetVisible = useOfflineEngineStore((s) => s.setSheetVisible);

  const [step, setStep] = useState<ModalStep>(editingWork ? 'edit' : 'folder');
  const [pickingFiles, setPickingFiles] = useState(false);
  const [inspectingFile, setInspectingFile] = useState<string | null>(null);
  const [inspected, setInspected] = useState<InspectedDocument | null>(null);
  const [batchImporting, setBatchImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!visible) return;
    setLocalError(null);
    void initialize().then(() => {
      if (!editingWork) {
        void scanFolders();
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
  }, [visible, editingWork, initialize, scanFolders, resetForm]);

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
      }
    } finally {
      setPickingFiles(false);
    }
  };

  const handleBatchImportNew = async () => {
    const newFiles = discoveredFiles.filter((f) => !f.alreadyImportedBookId);
    if (newFiles.length === 0) return;
    setBatchImporting(true);
    setLocalError(null);
    let importedCount = 0;
    let lastBookId: string | null = null;
    try {
      for (const file of newFiles) {
        try {
          const result = await inspectFile(file);
          if (result.duplicateWork || result.processed.chunks.length === 0) continue;
          const saved = await commitImport(result, {
            title: result.processed.suggestedTitle,
            author: result.processed.suggestedAuthor,
            era: result.processed.suggestedEra || 'Personal',
            collection: 'Personal Library',
            tags: result.processed.suggestedTags,
            notes: result.processed.suggestedNotes,
            includeInResonance: !result.processed.ocrRequired,
          });
          importedCount++;
          lastBookId = saved.bookId;
        } catch {
          // Continue remaining files in batch
        }
      }
      if (importedCount === 0) {
        setLocalError('No new readable passages were found in the folder.');
      } else {
        onClose();
        if (lastBookId && importedCount === 1) {
          onImportedBook?.(lastBookId);
        }
      }
    } finally {
      setBatchImporting(false);
    }
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

  const newFilesCount = discoveredFiles.filter((f) => !f.alreadyImportedBookId).length;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* Modal Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              {step === 'review' ? (
                <Pressable
                  onPress={() => setStep('folder')}
                  hitSlop={10}
                  style={styles.backBtn}
                >
                  <Feather name="arrow-left" size={18} color={colors.accent} />
                </Pressable>
              ) : null}
              <Text style={styles.headerTitle}>
                {step === 'edit'
                  ? 'Edit Book Metadata'
                  : step === 'review'
                    ? 'Review & Edit Metadata'
                    : 'Add to Your Library'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Feather name="x" size={20} color={colors.textTertiary} />
            </Pressable>
          </View>

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

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollBody}
          >
            {localError || scanError ? (
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>{localError ?? scanError}</Text>
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
                      disabled={pickingFiles || inspectingFile !== null}
                      style={[
                        styles.accentFilledBtn,
                        (pickingFiles || inspectingFile !== null) && styles.disabledBtn,
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
                          ? connectedFolderLabel
                          : 'Optional — link a folder on your device, Google Drive, or iCloud to scan all books inside it.'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.inlineBtnRow}>
                    <Pressable
                      onPress={() => void connectDeviceFolder()}
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
                      disabled={scanning}
                    >
                      <Feather name="refresh-cw" size={14} color={colors.textSecondary} />
                      <Text style={styles.subtleBtnText}>
                        {scanning ? 'Scanning…' : 'Scan now'}
                      </Text>
                    </Pressable>

                    {connectedFolderLabel ? (
                      <Pressable
                        onPress={() => void disconnectDeviceFolder()}
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

                {/* Discovered Files */}
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionLabel}>
                    READY TO IMPORT ({discoveredFiles.length})
                  </Text>
                  {newFilesCount > 1 ? (
                    <Pressable
                      onPress={() => void handleBatchImportNew()}
                      disabled={batchImporting}
                    >
                      <Text style={styles.batchLink}>
                        {batchImporting
                          ? 'Importing…'
                          : `Import all ${newFilesCount} new`}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>

                {scanning ? (
                  <View style={styles.centerPad}>
                    <ActivityIndicator color={colors.accent} />
                  </View>
                ) : discoveredFiles.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyCardTitle}>No books selected yet</Text>
                    <Text style={styles.emptyCardBody}>
                      Tap &ldquo;Choose files&rdquo; above to pick individual EPUB, PDF,
                      DOCX, Markdown, HTML, or TXT files — or link a folder to scan all
                      books inside it.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.card}>
                    {discoveredFiles.map((file, idx) => {
                      const isInspecting = inspectingFile === file.uri;
                      const sourceLabel =
                        file.source === 'picked'
                          ? 'Selected file'
                          : file.source === 'inbox'
                            ? 'Inbox'
                            : 'Connected folder';
                      return (
                        <View key={file.uri}>
                          {idx > 0 ? <View style={styles.divider} /> : null}
                          <Pressable
                            onPress={() => void handleInspectFile(file)}
                            disabled={inspectingFile !== null}
                            style={styles.fileRow}
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
                              <Text style={styles.fileSub}>
                                {file.sizeBytes > 0 ? `${formatBytes(file.sizeBytes)} · ` : ''}
                                {sourceLabel}
                                {file.alreadyImportedBookId ? ' · In Library' : ' · New'}
                              </Text>
                            </View>
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
                      );
                    })}
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
                    {saving ? 'Adding to Library…' : 'Add to Library & Embed'}
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

                {enginePhase !== 'ready' ? (
                  <View style={styles.infoBox}>
                    <Text style={styles.infoText}>
                      The Offline Engine isn&apos;t downloaded yet. This book will be
                      readable in your Library immediately and will embed automatically
                      once the engine is ready.
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
                          : 'Add to Library & Embed'}
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
            {step === 'edit' && editingWork ? (
              <>
                <View style={styles.card}>
                  <View style={styles.cardRowBetween}>
                    <Text style={styles.cardTitle}>On-Device Embedding Status</Text>
                    <View style={styles.formatPill}>
                      <Text style={styles.formatPillText}>
                        {editingWork.sourceFormat.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.cardMeta}>
                    {editingWork.embeddingStatus === 'ready'
                      ? `Embedded (${editingWork.embeddedChunks}/${editingWork.totalChunks} passages · Voyage-4-Nano 512d int8)`
                      : editingWork.embeddingStatus === 'embedding' ||
                          embeddingActiveBookId === editingWork.bookId
                        ? `Embedding ${editingWork.embeddedChunks} / ${editingWork.totalChunks} passages…`
                        : editingWork.embeddingStatus === 'error'
                          ? editingWork.lastError ?? 'Embedding error.'
                          : enginePhase === 'ready'
                            ? `Queued (${editingWork.embeddedChunks}/${editingWork.totalChunks} passages)`
                            : `Waiting for Offline Engine (${editingWork.totalChunks} passages readable now)`}
                  </Text>

                  <View style={styles.inlineBtnRow}>
                    {enginePhase !== 'ready' ? (
                      <Pressable
                        onPress={() => {
                          onClose();
                          setEngineSheetVisible(true);
                        }}
                        style={styles.accentOutlineBtn}
                      >
                        <Feather name="download" size={14} color={colors.accent} />
                        <Text style={styles.accentOutlineText}>
                          Download Offline Engine
                        </Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => {
                          if (editingWork.embeddingStatus === 'ready') {
                            void reembedWork(editingWork.bookId);
                          } else {
                            void processEmbeddingQueue();
                          }
                        }}
                        style={styles.accentOutlineBtn}
                      >
                        <Feather name="cpu" size={14} color={colors.accent} />
                        <Text style={styles.accentOutlineText}>
                          {editingWork.embeddingStatus === 'ready'
                            ? 'Re-embed passages'
                            : 'Embed now'}
                        </Text>
                      </Pressable>
                    )}
                  </View>
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
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(58, 53, 48, 0.35)',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    height: '90%',
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backBtn: {
    paddingRight: spacing.xs,
  },
  headerTitle: {
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
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
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
