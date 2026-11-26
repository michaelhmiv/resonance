/**
 * Library Catalog Browser Modal — lets users browse all optional Church
 * Library collections and individual works (Church Fathers, Medieval Mystics,
 * Reformation & Devotional Classics, Modern Witnesses) and download either a
 * single book (50 KB–2 MB, ~1s) or an entire collection, or remove installed
 * works anytime to reclaim storage.
 *
 * Reads live `packs-manifest.json` from the editable `corpus-packs-latest`
 * GitHub Release.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fontFamilies, layout, radii, spacing } from '@resonance/theme';
import type {
  CatalogCollectionEntry,
  CatalogCollectionId,
  CatalogWorkEntry,
} from '@resonance/core';
import { useOfflineEngineStore } from '../packages/offlineEngineManager';
import { formatBytes } from '../db/queries/settingsQueries';

interface LibraryCatalogModalProps {
  visible: boolean;
  onClose: () => void;
  /** Optional callback to open an already-downloaded book directly in ReadingView. */
  onOpenBook?: (bookId: string) => void;
}

type FilterKey = 'all' | 'downloaded' | CatalogCollectionId;

export function LibraryCatalogModal({
  visible,
  onClose,
  onOpenBook,
}: LibraryCatalogModalProps): ReactNode {
  const {
    corpusManifest,
    manifestSyncing,
    installedWorkIds,
    activeCatalogDownload,
    catalogQueueIds,
    catalogError,
    syncCorpusManifest,
    downloadCatalogWork,
    downloadCatalogCollection,
    cancelCatalogDownload,
    removeCatalogWork,
    removeCatalogCollection,
  } = useOfflineEngineStore();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expandedCollections, setExpandedCollections] = useState<Record<string, boolean>>({
    'church-fathers': true,
    'medieval-mystics': true,
  });

  useEffect(() => {
    if (!visible) return;
    // Uses 5-minute TTL unless user explicitly taps Refresh — instant reopen!
    void syncCorpusManifest(false);
  }, [visible, syncCorpusManifest]);

  const installedSet = useMemo(() => new Set(installedWorkIds), [installedWorkIds]);
  const queuedSet = useMemo(() => new Set(catalogQueueIds), [catalogQueueIds]);
  const collections = corpusManifest.collections ?? [];
  const allWorks = corpusManifest.works ?? [];

  const filteredWorks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allWorks.filter((w) => {
      if (filter === 'downloaded' && !installedSet.has(w.id)) return false;
      if (filter !== 'all' && filter !== 'downloaded' && w.collectionId !== filter) {
        return false;
      }
      if (!q) return true;
      return (
        w.title.toLowerCase().includes(q) ||
        w.author.toLowerCase().includes(q) ||
        w.era.toLowerCase().includes(q)
      );
    });
  }, [allWorks, filter, installedSet, search]);

  const worksByCollection = useMemo(() => {
    const map = new Map<string, CatalogWorkEntry[]>();
    for (const w of filteredWorks) {
      const list = map.get(w.collectionId) ?? [];
      list.push(w);
      map.set(w.collectionId, list);
    }
    return map;
  }, [filteredWorks]);

  const toggleCollection = (id: string) => {
    setExpandedCollections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const confirmRemoveCollection = (col: CatalogCollectionEntry) => {
    Alert.alert(
      `Remove ${col.label}?`,
      'Removes all downloaded books in this collection from your device to free storage. You can re-download any book anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => void removeCatalogCollection(col.id),
        },
      ]
    );
  };

  const activePct =
    activeCatalogDownload && activeCatalogDownload.totalBytes > 0
      ? Math.min(
          100,
          Math.round(
            (activeCatalogDownload.bytesWritten / activeCatalogDownload.totalBytes) * 100
          )
        )
      : 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.flexOne}>
              <Text style={styles.title}>Library Catalog</Text>
              <Text style={styles.subtitle}>
                Pick individual books or whole collections · {installedWorkIds.length} of{' '}
                {allWorks.length || 72} downloaded
              </Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => void syncCorpusManifest(true)}
                hitSlop={8}
                disabled={manifestSyncing}
                style={styles.iconBtn}
                accessibilityLabel="Refresh catalog from GitHub Releases"
              >
                {manifestSyncing ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Feather name="refresh-cw" size={17} color={colors.accent} />
                )}
              </Pressable>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                style={styles.iconBtn}
                accessibilityLabel="Close catalog"
              >
                <Feather name="x" size={20} color={colors.textTertiary} />
              </Pressable>
            </View>
          </View>

          {/* Search input */}
          <View style={styles.searchWrap}>
            <Feather name="search" size={15} color={colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search title, author, or era (e.g. Augustine, Kempis)…"
              placeholderTextColor={colors.placeholder}
            />
            {search.length > 0 ? (
              <Pressable
                onPress={() => setSearch('')}
                hitSlop={8}
                accessibilityLabel="Clear search"
              >
                <Feather name="x-circle" size={15} color={colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>

          {/* Filter pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterScroll}
            contentContainerStyle={styles.filterRow}
          >
            {(
              [
                { key: 'all', label: `All (${allWorks.length || 72})` },
                { key: 'downloaded', label: `Downloaded (${installedWorkIds.length})` },
                ...collections.map((c) => ({ key: c.id as FilterKey, label: c.label })),
              ] as Array<{ key: FilterKey; label: string }>
            ).map((pill) => {
              const active = filter === pill.key;
              return (
                <Pressable
                  key={pill.key}
                  onPress={() => setFilter(pill.key)}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.filterPillText,
                      active && styles.filterPillTextActive,
                    ]}
                  >
                    {pill.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Active download banner */}
          {activeCatalogDownload ? (
            <View style={styles.activeBanner}>
              <View style={styles.activeBannerTop}>
                <View style={styles.flexOne}>
                  <Text style={styles.activeBannerTitle} numberOfLines={1}>
                    {activeCatalogDownload.stage === 'indexing'
                      ? `Indexing ${activeCatalogDownload.label}`
                      : `Downloading ${activeCatalogDownload.label}`}
                  </Text>
                  <Text style={styles.activeBannerMeta}>
                    {activeCatalogDownload.totalWorks > 1
                      ? `Book ${activeCatalogDownload.currentIndex} of ${activeCatalogDownload.totalWorks} · `
                      : ''}
                    {activeCatalogDownload.stage === 'indexing'
                      ? 'Saving passages to Library…'
                      : `${formatBytes(activeCatalogDownload.bytesWritten)} / ${formatBytes(activeCatalogDownload.totalBytes)} (${activePct}%)`}
                  </Text>
                  <Text style={styles.activeBannerMeta}>
                    Continues in the background if you close this sheet.
                  </Text>
                </View>
                <Pressable
                  onPress={() => void cancelCatalogDownload()}
                  style={styles.cancelBtn}
                >
                  <Text style={styles.cancelBtnText}>Stop</Text>
                </Pressable>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${activePct}%` }]} />
              </View>
            </View>
          ) : null}

          {/* Error / Publishing Notice */}
          {catalogError ? (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>{catalogError}</Text>
            </View>
          ) : null}

          {/* Catalog body */}
          <ScrollView
            style={styles.listScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listBody}
          >
            {allWorks.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {manifestSyncing
                    ? 'Loading catalog from GitHub Releases…'
                    : 'Catalog packs are being prepared'}
                </Text>
                <Text style={styles.emptyBody}>
                  Once the `corpus-packs-latest` release finishes publishing, all 72
                  individual books and 4 collections will appear here ready to
                  cherry-pick. Tap the refresh icon above anytime to sync.
                </Text>
                {collections.map((c) => (
                  <View key={c.id} style={styles.previewColRow}>
                    <Text style={styles.previewColTitle}>
                      {c.label} · {c.era}
                    </Text>
                    <Text style={styles.previewColDesc}>{c.description}</Text>
                  </View>
                ))}
              </View>
            ) : filteredWorks.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No matching works</Text>
                <Text style={styles.emptyBody}>
                  Try clearing your search or switching the filter pill above.
                </Text>
              </View>
            ) : (
              collections.map((col) => {
                const works = worksByCollection.get(col.id) ?? [];
                if (works.length === 0) return null;

                const colAllWorks = allWorks.filter((w) => w.collectionId === col.id);
                const installedCount = colAllWorks.filter((w) =>
                  installedSet.has(w.id)
                ).length;
                const remainingBytes = colAllWorks
                  .filter((w) => !installedSet.has(w.id))
                  .reduce((acc, w) => acc + w.passagesBytes + w.vectorsBytes, 0);
                const allInstalled =
                  colAllWorks.length > 0 && installedCount === colAllWorks.length;
                const expanded =
                  search.trim().length > 0 ||
                  filter !== 'all' ||
                  expandedCollections[col.id] === true;

                return (
                  <View key={col.id} style={styles.colCard}>
                    <Pressable
                      onPress={() => toggleCollection(col.id)}
                      style={styles.colHeader}
                    >
                      <View style={styles.flexOne}>
                        <View style={styles.colTitleRow}>
                          <Text style={styles.colTitle}>{col.label}</Text>
                          <Text style={styles.colEra}>{col.era}</Text>
                        </View>
                        <Text style={styles.colDesc}>{col.description}</Text>
                        <Text style={styles.colStats}>
                          {installedCount}/{colAllWorks.length} installed ·{' '}
                          {formatBytes(col.totalBytes)} total
                        </Text>
                      </View>
                      <Feather
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={colors.textTertiary}
                      />
                    </Pressable>

                    {/* Collection-level quick action bar */}
                    <View style={styles.colActions}>
                      {!allInstalled ? (
                        <Pressable
                          onPress={() => void downloadCatalogCollection(col.id)}
                          style={styles.colPrimaryBtn}
                        >
                          <Feather name="download" size={13} color={colors.surface} />
                          <Text style={styles.colPrimaryBtnText}>
                            {installedCount > 0
                              ? `Download remaining (${formatBytes(remainingBytes)})`
                              : `Download collection (${formatBytes(remainingBytes)})`}
                          </Text>
                        </Pressable>
                      ) : (
                        <View style={styles.installedBadge}>
                          <Feather name="check" size={13} color={colors.accent} />
                          <Text style={styles.installedBadgeText}>
                            All {colAllWorks.length} books installed
                          </Text>
                        </View>
                      )}

                      {installedCount > 0 ? (
                        <Pressable
                          onPress={() => confirmRemoveCollection(col)}
                          disabled={activeCatalogDownload !== null}
                          style={styles.colSecondaryBtn}
                        >
                          <Text style={styles.colSecondaryBtnText}>Remove</Text>
                        </Pressable>
                      ) : null}
                    </View>

                    {/* Individual Books */}
                    {expanded ? (
                      <View style={styles.worksWrap}>
                        {works.map((work) => {
                          const isInstalled = installedSet.has(work.id);
                          const isDownloadingThis =
                            activeCatalogDownload?.workId === work.id;
                          const isQueued = !isDownloadingThis && queuedSet.has(work.id);
                          const sizeBytes = work.passagesBytes + work.vectorsBytes;
                          return (
                            <View key={work.id} style={styles.workRow}>
                              <View style={styles.flexOne}>
                                <Text style={styles.workTitle} numberOfLines={2}>
                                  {work.title}
                                </Text>
                                <Text style={styles.workMeta} numberOfLines={1}>
                                  {work.author ? `${work.author} · ` : ''}
                                  {work.passageCount.toLocaleString()} passages ·{' '}
                                  {formatBytes(sizeBytes)}
                                </Text>
                              </View>
                              <View style={styles.workBtnGroup}>
                                {isDownloadingThis ? (
                                  <ActivityIndicator
                                    size="small"
                                    color={colors.accent}
                                  />
                                ) : isQueued ? (
                                  <View style={styles.installedBadge}>
                                    <Text style={styles.installedBadgeText}>Queued</Text>
                                  </View>
                                ) : isInstalled ? (
                                  <>
                                    {onOpenBook ? (
                                      <Pressable
                                        onPress={() => {
                                          onClose();
                                          onOpenBook(work.id);
                                        }}
                                        style={styles.openWorkBtn}
                                      >
                                        <Text style={styles.openWorkBtnText}>Read</Text>
                                      </Pressable>
                                    ) : null}
                                    <Pressable
                                      onPress={() => void removeCatalogWork(work.id)}
                                      disabled={activeCatalogDownload !== null}
                                      hitSlop={6}
                                      style={styles.removeWorkBtn}
                                      accessibilityLabel={`Remove ${work.title}`}
                                    >
                                      <Feather
                                        name="trash-2"
                                        size={14}
                                        color={colors.textTertiary}
                                      />
                                    </Pressable>
                                  </>
                                ) : (
                                  <Pressable
                                    onPress={() => void downloadCatalogWork(work.id)}
                                    style={styles.dlWorkBtn}
                                  >
                                    <Feather
                                      name="download"
                                      size={13}
                                      color={colors.accent}
                                    />
                                    <Text style={styles.dlWorkBtnText}>Get</Text>
                                  </Pressable>
                                )}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

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
    height: '92%',
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
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  flexOne: {
    flex: 1,
  },
  title: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 23,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.textTertiary,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconBtn: {
    padding: 6,
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
    paddingVertical: 8,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 0,
  },
  filterScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: spacing.sm,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingVertical: 4,
    paddingRight: spacing.md,
  },
  filterPill: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 13,
    paddingVertical: 7,
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
    lineHeight: 17,
    includeFontPadding: false,
    color: colors.textSecondary,
  },
  filterPillTextActive: {
    color: colors.surface,
  },
  listScroll: {
    flex: 1,
  },
  activeBanner: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  activeBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  activeBannerTitle: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  activeBannerMeta: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 1,
  },
  cancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cancelBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textSecondary,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  noticeBox: {
    backgroundColor: '#fdf6ea',
    borderColor: '#e5cfa5',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  noticeText: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: '#7c5a20',
  },
  listBody: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: layout.cardPadding,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  emptyBody: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  previewColRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: 2,
  },
  previewColTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  previewColDesc: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  colCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: layout.cardPadding,
    gap: spacing.sm,
  },
  colHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  colTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  colTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  colEra: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
  },
  colDesc: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 2,
  },
  colStats: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.accent,
    marginTop: 4,
  },
  colActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: 2,
  },
  colPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.sm,
  },
  colPrimaryBtnText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12.5,
    color: colors.surface,
  },
  colSecondaryBtn: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  colSecondaryBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  installedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#f3ede2',
  },
  installedBadgeText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.accent,
  },
  disabledBtn: {
    opacity: 0.45,
  },
  worksWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: 4,
  },
  workRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  workTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 15.5,
    color: colors.textPrimary,
  },
  workMeta: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
  workBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dlWorkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.background,
  },
  dlWorkBtnText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12,
    color: colors.accent,
  },
  openWorkBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    backgroundColor: '#f3ede2',
  },
  openWorkBtnText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12,
    color: colors.accent,
  },
  removeWorkBtn: {
    padding: 6,
  },
});
