import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import type { LibraryBook, PersonalWorkMetadata } from '@resonance/core';
import { DataLayerProvider } from '@resonance/core/data-layer-context';
import { WordScreen as SharedWordScreen, type WordBackgroundStatus } from '@resonance/screens';
import { colors, fontFamilies, spacing } from '@resonance/theme';
import type { TabParamList } from '../navigation/RootNavigator';
import { MobileDataLayer } from '../data/mobileDataLayer';
import { getPersonalWork } from '../db/queries/libraryQueries';
import { usePersonalLibraryStore } from '../personal/personalLibraryService';
import { useOfflineEngineStore } from '../packages/offlineEngineManager';
import { PersonalLibraryImportModal } from '../components/PersonalLibraryImportModal';
import { LibraryCatalogModal } from '../components/LibraryCatalogModal';

export function WordScreen(): ReactNode {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<TabParamList, 'Word'>>();
  const dataLayer = useMemo(() => new MobileDataLayer(), []);

  // Personal library state (batch import + background embedding)
  const personalRevision = usePersonalLibraryStore((s) => s.libraryRevision);
  const batchImporting = usePersonalLibraryStore((s) => s.batchImporting);
  const batchProgress = usePersonalLibraryStore((s) => s.batchProgress);
  const embeddingActiveBookId = usePersonalLibraryStore((s) => s.embeddingActiveBookId);
  const personalWorks = usePersonalLibraryStore((s) => s.works);

  // Offline engine & Church Library catalog download state
  const catalogRevision = useOfflineEngineStore((s) => s.catalogRevision);
  const activeCatalogDownload = useOfflineEngineStore((s) => s.activeCatalogDownload);
  const enginePhase = useOfflineEngineStore((s) => s.phase);
  const downloadedBytes = useOfflineEngineStore((s) => s.downloadedBytes);
  const totalBytes = useOfflineEngineStore((s) => s.totalBytes);
  const setEngineSheetVisible = useOfflineEngineStore((s) => s.setSheetVisible);

  const [catalogVisible, setCatalogVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [editingWork, setEditingWork] = useState<PersonalWorkMetadata | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [localDeepLink, setLocalDeepLink] = useState<{
    bookId: string;
    chapter?: number;
    verse?: number;
  } | null>(null);

  // Sync incoming route params (e.g. from Patterns -> Explore Bookshelf)
  const routeBookId = route.params?.bookId;
  const routeChapter = route.params?.chapter;
  const routeVerse = route.params?.verse;

  useEffect(() => {
    if (routeBookId) {
      setLocalDeepLink({
        bookId: routeBookId,
        chapter: routeChapter,
        verse: routeVerse,
      });
    }
  }, [routeBookId, routeChapter, routeVerse]);

  // Tapping the active Word tab resets ReadingView/Search back to browse
  useEffect(() => {
    const unsub = (
      navigation as unknown as {
        addListener?: (event: string, cb: () => void) => () => void;
      }
    ).addListener?.('tabPress', () => {
      setResetSignal((n) => n + 1);
    });
    return () => unsub?.();
  }, [navigation]);

  // Wire consistent Settings gear + background engine pill in React Navigation header
  useEffect(() => {
    const showEnginePill = enginePhase === 'downloading' || enginePhase === 'paused';
    const pct =
      totalBytes > 0
        ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
        : 0;

    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerRight}>
          {showEnginePill ? (
            <Pressable
              onPress={() => setEngineSheetVisible(true)}
              hitSlop={8}
              style={styles.downloadPill}
              accessibilityRole="button"
              accessibilityLabel={`Offline engine download ${pct}%`}
            >
              <Text style={styles.downloadPillText}>
                {enginePhase === 'paused' ? `❚❚ ${pct}%` : `↓ ${pct}%`}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => navigation.navigate('Settings' as never)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Feather name="settings" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, enginePhase, downloadedBytes, totalBytes, setEngineSheetVisible]);

  // Compute live background sync status banner for the Word tab browse view
  const backgroundStatus = useMemo<WordBackgroundStatus | null>(() => {
    if (activeCatalogDownload) {
      const pct =
        activeCatalogDownload.totalBytes > 0
          ? Math.min(
              100,
              Math.round(
                (activeCatalogDownload.bytesWritten /
                  activeCatalogDownload.totalBytes) *
                  100
              )
            )
          : undefined;
      return {
        label:
          activeCatalogDownload.stage === 'indexing'
            ? `Indexing ${activeCatalogDownload.label}…`
            : `Downloading ${activeCatalogDownload.label}`,
        detail:
          activeCatalogDownload.totalWorks > 1
            ? `Book ${activeCatalogDownload.currentIndex} of ${activeCatalogDownload.totalWorks} · running in background`
            : 'Running in background · tap to view',
        progressPct: pct,
        onPress: () => setCatalogVisible(true),
      };
    }

    if (batchImporting && batchProgress) {
      const done =
        batchProgress.imported + batchProgress.skipped + batchProgress.failed;
      const pct = Math.min(
        100,
        Math.round(((done + 0.25) / Math.max(1, batchProgress.total)) * 100)
      );
      return {
        label: `Importing ${batchProgress.currentIndex} of ${batchProgress.total} books`,
        detail: `${batchProgress.currentFilename} · running in background`,
        progressPct: pct,
        onPress: () => {
          setEditingWork(null);
          setImportModalVisible(true);
        },
      };
    }

    if (embeddingActiveBookId) {
      const activeWork = personalWorks.find(
        (w) => w.bookId === embeddingActiveBookId
      );
      if (activeWork) {
        const pct =
          activeWork.totalChunks > 0
            ? Math.min(
                100,
                Math.round(
                  (activeWork.embeddedChunks / activeWork.totalChunks) * 100
                )
              )
            : undefined;
        return {
          label: `Embedding "${activeWork.title}"`,
          detail: `${activeWork.embeddedChunks}/${activeWork.totalChunks} passages · running in background`,
          progressPct: pct,
          onPress: () => {
            setEditingWork(activeWork);
            setImportModalVisible(true);
          },
        };
      }
    }

    return null;
  }, [
    activeCatalogDownload,
    batchImporting,
    batchProgress,
    embeddingActiveBookId,
    personalWorks,
  ]);

  const handleOpenCatalog = useCallback(() => {
    setCatalogVisible(true);
  }, []);

  const handleOpenImport = useCallback(() => {
    setEditingWork(null);
    setImportModalVisible(true);
  }, []);

  const handleEditBookMetadata = useCallback((book: LibraryBook) => {
    void getPersonalWork(book.id).then((meta) => {
      if (meta) {
        setEditingWork(meta);
        setImportModalVisible(true);
      }
    });
  }, []);

  const handleCloseModal = useCallback(() => {
    setImportModalVisible(false);
    setEditingWork(null);
  }, []);

  const handleOpenBookDirect = useCallback((bookId: string) => {
    setLocalDeepLink({ bookId });
  }, []);

  return (
    <DataLayerProvider layer={dataLayer}>
      <SharedWordScreen
        onOpenSettings={() => navigation.navigate('Settings' as never)}
        hideSettingsInSubHeader
        onOpenCatalog={handleOpenCatalog}
        onOpenImport={handleOpenImport}
        onEditBookMetadata={handleEditBookMetadata}
        libraryRevision={personalRevision + catalogRevision}
        resetSignal={resetSignal}
        backgroundStatus={backgroundStatus}
        initialBook={localDeepLink?.bookId}
        initialChapter={localDeepLink?.chapter}
        initialVerse={localDeepLink?.verse}
      />
      <LibraryCatalogModal
        visible={catalogVisible}
        onClose={() => setCatalogVisible(false)}
        onOpenBook={handleOpenBookDirect}
      />
      <PersonalLibraryImportModal
        visible={importModalVisible}
        editingWork={editingWork}
        onClose={handleCloseModal}
        onImportedBook={handleOpenBookDirect}
      />
    </DataLayerProvider>
  );
}

const styles = StyleSheet.create({
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginRight: spacing.md,
  },
  downloadPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#f3ede2',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  downloadPillText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11.5,
    color: colors.accent,
  },
});
