/**
 * Journal screen — the primary writing & Multimodal Life Diary surface.
 *
 * A continuous, auto-saving document rendered as a FlashList of typed
 * segments. Only one text segment is editable at a time; all others are
 * static rendered cells.
 *
 * When a user opts into BYOK OpenRouter in Settings, the Journal quietly
 * unlocks Voice notes, Photo memories, Video memories, People tagging,
 * filter pills, a Memories & People gallery sheet, and semantic diary search.
 * Without an OpenRouter key, those controls remain completely hidden.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import {
  colors,
  fontFamilies,
  layout,
  radii,
  serifText,
  spacing,
} from '@resonance/theme';
import { useDbStore } from '../db/dbStore';
import {
  type DiaryMediaItem,
  type DiaryPerson,
  type JournalSegment,
  type ResonanceResult,
  createSegment,
  toParentDate,
  formatDateLong,
  isTextSegment,
  isMediaSegment,
} from '@resonance/core';
import { useJournalStore } from '../journal/journalStore';
import { useFocusStore } from '../journal/focusManager';
import { useReadingTextStyle } from '../settings/settingsStore';
import { useOfflineEngineStore } from '../packages/offlineEngineManager';
import { useOpenRouterStore } from '../openrouter/openrouterStore';
import {
  buildDiarySearchableText,
  useDiaryMediaStore,
} from '../diary/diaryMediaService';
import {
  findResonance,
  searchDiarySemantic,
} from '../embedding/resonanceService';
import { DiaryCaptureBar } from '../components/DiaryCaptureBar';
import { DiaryMediaCard } from '../components/DiaryMediaCard';
import { MemoriesAndPeopleSheet } from '../components/MemoriesAndPeopleSheet';
import type { TabParamList } from '../navigation/RootNavigator';

// ── Item types for the FlashList ─────────────────────────────────────────────

type ListItem =
  | { kind: 'segment'; segment: JournalSegment }
  | { kind: 'verse_day'; ref: string; text: string; parentDate: string }
  | { kind: 'date_divider'; label: string; parentDate: string };

type DiaryFilter = 'all' | 'text' | 'voice' | 'photo' | 'video';

// ── Component ───────────────────────────────────────────────────────────────

export function JournalScreen(): ReactNode {
  const { connection: db, status } = useDbStore();
  const {
    segments,
    loading,
    load,
    insertSegment,
  } = useJournalStore();
  const {
    activeSegmentId,
    keyboardHeight,
    focusSegment,
    handleChangeText,
    handleBackspace,
    handleReturn,
    initKeyboardListeners,
  } = useFocusStore();

  const enginePhase = useOfflineEngineStore((s) => s.phase);
  const downloadedBytes = useOfflineEngineStore((s) => s.downloadedBytes);
  const totalBytes = useOfflineEngineStore((s) => s.totalBytes);
  const setEngineSheetVisible = useOfflineEngineStore((s) => s.setSheetVisible);

  const hasOpenRouterKey = useOpenRouterStore((s) => s.hasKey);
  const routingMode = useOpenRouterStore((s) => s.routingMode);
  const orFeatures = useOpenRouterStore((s) => s.features);
  const diaryMediaUnlocked =
    hasOpenRouterKey &&
    routingMode === 'cloud_with_fallback' &&
    (orFeatures.voice || orFeatures.photosAndVideos);

  const mediaBySegmentId = useDiaryMediaStore((s) => s.mediaBySegmentId);
  const allPeople = useDiaryMediaStore((s) => s.people);

  const navigation = useNavigation();
  const route = useRoute<RouteProp<TabParamList, 'Journal'>>();
  const listRef = useRef<FlashListRef<ListItem>>(null);

  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [semanticMatchIds, setSemanticMatchIds] = useState<Set<string> | null>(null);
  const [semanticSearching, setSemanticSearching] = useState(false);
  const [activeFilter, setActiveFilter] = useState<DiaryFilter>('all');
  const [filterPerson, setFilterPerson] = useState<DiaryPerson | null>(null);

  const [memoriesSheetOpen, setMemoriesSheetOpen] = useState(false);
  const [memoriesInitialTab, setMemoriesInitialTab] = useState<'people' | 'gallery'>('gallery');

  // Inline Echoes sheet for multimodal memories
  const [echoModalOpen, setEchoModalOpen] = useState(false);
  const [echoLoading, setEchoLoading] = useState(false);
  const [echoResult, setEchoResult] = useState<ResonanceResult | null>(null);

  // ── Load journal on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (db && status === 'ready') {
      void load(db);
    }
  }, [db, status, load]);

  // ── Handle deep-link filter params from Patterns tab ───────────────────
  useEffect(() => {
    const personId = route.params?.filterPersonId;
    if (personId) {
      const found = allPeople.find((p) => p.id === personId) ?? null;
      if (found) {
        setFilterPerson(found);
        setSearchVisible(true);
      }
    }
  }, [route.params?.filterPersonId, allPeople]);

  // ── Keyboard listeners ─────────────────────────────────────────────────
  useEffect(() => {
    const unsub = initKeyboardListeners();
    return unsub;
  }, [initKeyboardListeners]);

  // ── Debounced semantic diary search ────────────────────────────────────
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 3) {
      setSemanticMatchIds(null);
      setSemanticSearching(false);
      return;
    }
    let cancelled = false;
    setSemanticSearching(true);
    const timer = setTimeout(() => {
      void searchDiarySemantic(q, 30)
        .then((hits) => {
          if (cancelled) return;
          setSemanticMatchIds(new Set(hits.map((h) => h.segmentId)));
        })
        .catch(() => {
          if (!cancelled) setSemanticMatchIds(null);
        })
        .finally(() => {
          if (!cancelled) setSemanticSearching(false);
        });
    }, 320);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  // ── Wire settings gear, Memories & People icon (gated), and search ─────
  useEffect(() => {
    const showPill = enginePhase === 'downloading' || enginePhase === 'paused';
    const pct =
      totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;

    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerRight}>
          {showPill ? (
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
          {diaryMediaUnlocked ? (
            <Pressable
              onPress={() => {
                setMemoriesInitialTab('gallery');
                setMemoriesSheetOpen(true);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Memories and People"
            >
              <Feather name="grid" size={19} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setSearchVisible((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Search journal"
          >
            <Feather
              name="search"
              size={20}
              color={searchVisible ? colors.accent : colors.textSecondary}
            />
          </Pressable>
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
  }, [
    navigation,
    enginePhase,
    downloadedBytes,
    totalBytes,
    setEngineSheetVisible,
    diaryMediaUnlocked,
    searchVisible,
  ]);

  // ── Initialize: create first text segment if document is empty ─────────
  useEffect(() => {
    if (!loading && segments.length === 0) {
      const parentDate = toParentDate();
      const seg = createSegment('text', '', 0, parentDate);
      insertSegment(seg);
      setTimeout(() => focusSegment(seg.id, 0), 100);
    }
  }, [loading, segments.length, insertSegment, focusSegment]);

  // ── Filter & Search segments ───────────────────────────────────────────
  const visibleSegments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return segments.filter((seg) => {
      // Type filter
      if (activeFilter !== 'all' && seg.segment_type !== activeFilter) {
        return false;
      }

      const media = mediaBySegmentId[seg.id];

      // Person filter
      if (filterPerson) {
        if (media) {
          const hasPerson = media.people.some((p) => p.id === filterPerson.id);
          if (!hasPerson) return false;
        } else {
          // Also match written entries that mention the person's name
          const txt = (seg.text ?? '').toLowerCase();
          if (!txt.includes(filterPerson.name.toLowerCase())) return false;
        }
      }

      // Keyword + Semantic search
      if (q.length > 0) {
        const hay = media
          ? buildDiarySearchableText(media).toLowerCase()
          : (seg.text ?? '').toLowerCase();
        const keywordHit = hay.includes(q);
        const semanticHit = semanticMatchIds?.has(seg.id) ?? false;
        if (!keywordHit && !semanticHit) return false;
      }

      return true;
    });
  }, [segments, activeFilter, filterPerson, searchQuery, mediaBySegmentId, semanticMatchIds]);

  const items: ListItem[] = useBuildItems(visibleSegments);

  const handleTriggerEchoes = useCallback(async (queryText: string) => {
    setEchoModalOpen(true);
    setEchoLoading(true);
    setEchoResult(null);
    try {
      const res = await findResonance(queryText);
      setEchoResult(res);
    } finally {
      setEchoLoading(false);
    }
  }, []);

  const handleSelectMemory = useCallback(
    (item: DiaryMediaItem) => {
      setActiveFilter('all');
      setFilterPerson(null);
      setSearchQuery('');
      const idx = items.findIndex(
        (it) => it.kind === 'segment' && it.segment.id === item.segmentId
      );
      if (idx >= 0) {
        setTimeout(() => {
          listRef.current?.scrollToIndex({ index: idx, animated: true });
        }, 150);
      }
    },
    [items]
  );

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accentMuted} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: keyboardHeight > 0 ? keyboardHeight : 0 },
      ]}
    >
      {/* ── Pull-down Search & Life Diary Filter Bar ──────────────── */}
      {searchVisible || filterPerson ? (
        <View style={styles.searchBarWrap}>
          {searchVisible ? (
            <View style={styles.searchInputRow}>
              <Feather name="search" size={15} color={colors.textTertiary} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={
                  diaryMediaUnlocked
                    ? 'Search writings, voice notes, photos, OCR…'
                    : 'Search your journal…'
                }
                placeholderTextColor={colors.textTertiary}
                style={styles.searchInput}
                autoCapitalize="none"
              />
              {semanticSearching ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : searchQuery.length > 0 ? (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                  <Feather name="x" size={16} color={colors.textTertiary} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {diaryMediaUnlocked && searchVisible ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterPillsRow}
            >
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'text', label: 'Writing' },
                  { id: 'voice', label: 'Voice' },
                  { id: 'photo', label: 'Photos' },
                  { id: 'video', label: 'Videos' },
                ] as Array<{ id: DiaryFilter; label: string }>
              ).map((f) => (
                <Pressable
                  key={f.id}
                  onPress={() => setActiveFilter(f.id)}
                  style={[
                    styles.filterPill,
                    activeFilter === f.id && styles.filterPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      activeFilter === f.id && styles.filterPillTextActive,
                    ]}
                  >
                    {f.label}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => {
                  setMemoriesInitialTab('people');
                  setMemoriesSheetOpen(true);
                }}
                style={styles.filterPill}
              >
                <Text style={styles.filterPillText}>People ▾</Text>
              </Pressable>
            </ScrollView>
          ) : null}

          {filterPerson ? (
            <View style={styles.activePersonBanner}>
              <Feather name="user" size={13} color={colors.accent} />
              <Text style={styles.activePersonText}>
                Showing memories with {filterPerson.name}
              </Text>
              <Pressable onPress={() => setFilterPerson(null)} hitSlop={8}>
                <Feather name="x" size={15} color={colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      <FlashList
        ref={listRef}
        data={items}
        keyExtractor={(item, index) => {
          if (item.kind === 'segment') return `seg-${item.segment.id}`;
          if (item.kind === 'verse_day') return `vod-${item.parentDate}`;
          return `dd-${item.parentDate}-${index}`;
        }}
        contentContainerStyle={[
          styles.listContent,
          diaryMediaUnlocked && { paddingBottom: 88 },
        ]}
        renderItem={({ item }) => {
          if (item.kind === 'date_divider') {
            return <DateDivider label={item.label} />;
          }
          if (item.kind === 'verse_day') {
            return <VerseOfDayCard reference={item.ref} text={item.text} />;
          }

          const seg = item.segment;

          // Multimodal Life Diary cards (Voice, Photo, Video)
          if (isMediaSegment(seg)) {
            const mediaItem = mediaBySegmentId[seg.id];
            if (!mediaItem) return null;
            return (
              <DiaryMediaCard
                item={mediaItem}
                onSelectPerson={(p) => {
                  setFilterPerson(p);
                  setSearchVisible(true);
                }}
                onTriggerEchoes={(txt) => void handleTriggerEchoes(txt)}
              />
            );
          }

          if (!isTextSegment(seg)) return null;

          const isActive = seg.id === activeSegmentId;
          if (isActive) {
            return (
              <ActiveSegmentInput
                segment={seg}
                onChangeText={(text) => handleChangeText(seg.id, text)}
                onKeyPress={(e) => {
                  if (
                    e.nativeEvent.key === 'Backspace' &&
                    useFocusStore.getState().getCursorPosition() === 0
                  ) {
                    handleBackspace(
                      seg.id,
                      useFocusStore.getState().getCursorPosition()
                    );
                  }
                  if (e.nativeEvent.key === 'Enter') {
                    handleReturn(
                      seg.id,
                      useFocusStore.getState().getCursorPosition()
                    );
                  }
                }}
                onFocus={() => focusSegment(seg.id, undefined)}
              />
            );
          }

          return (
            <Pressable
              onPress={() => focusSegment(seg.id, (seg.text ?? '').length)}
              onLongPress={() => focusSegment(seg.id, 0)}
              delayLongPress={200}
            >
              <StaticSegmentText text={seg.text ?? ''} />
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />

      {/* ── Empty state placeholder ────────────────────────────────── */}
      {segments.length === 0 && (
        <View style={styles.emptyOverlay} pointerEvents="none">
          <Text style={styles.emptyText}>Whatever is real.</Text>
        </View>
      )}

      {/* ── OpenRouter-gated Quiet Capture Dock (Voice · Photo · Video) */}
      <DiaryCaptureBar
        keyboardHeight={keyboardHeight}
        onMediaAdded={() => {
          setTimeout(() => {
            listRef.current?.scrollToEnd({ animated: true });
          }, 180);
        }}
      />

      {/* ── Memories & People Hub Sheet ───────────────────────────── */}
      <MemoriesAndPeopleSheet
        visible={memoriesSheetOpen}
        initialTab={memoriesInitialTab}
        onClose={() => setMemoriesSheetOpen(false)}
        onSelectPerson={(person) => {
          setFilterPerson(person);
          setSearchVisible(true);
        }}
        onSelectMemory={handleSelectMemory}
      />

      {/* ── Quiet Echoes Modal (for Voice, Photo, Video cards) ────── */}
      <Modal
        visible={echoModalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEchoModalOpen(false)}
      >
        <View style={styles.echoSheet}>
          <View style={styles.echoHeader}>
            <Text style={styles.echoTitle}>✦ Echoes</Text>
            <Pressable onPress={() => setEchoModalOpen(false)} hitSlop={10}>
              <Feather name="x" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          {echoLoading ? (
            <View style={[styles.center, { flex: 1 }]}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.echoEmpty}>Listening for echoes…</Text>
            </View>
          ) : !echoResult ||
            (echoResult.scripture.length === 0 &&
              echoResult.voices.length === 0 &&
              echoResult.pastEntries.length === 0 &&
              (echoResult.highlights?.length ?? 0) === 0) ? (
            <View style={[styles.center, { flex: 1, padding: spacing.xl }]}>
              <Text style={styles.echoEmpty}>
                Quiet — no strong echoes surfaced for this memory yet.
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.echoList}>
              {[
                { title: 'Scripture', list: echoResult.scripture },
                { title: 'Voices & Library', list: echoResult.voices },
                { title: 'Past Memories', list: echoResult.pastEntries },
                { title: 'Your Highlights', list: echoResult.highlights ?? [] },
              ]
                .filter((g) => g.list.length > 0)
                .map((group) => (
                  <View key={group.title} style={{ gap: spacing.xs }}>
                    <Text style={styles.echoGroupTitle}>{group.title}</Text>
                    {group.list.map((card, i) => (
                      <View key={`${card.bookId}-${i}`} style={styles.echoCard}>
                        <Text style={styles.echoCardText}>{card.text}</Text>
                        <Text style={styles.echoCardSource}>{card.source}</Text>
                      </View>
                    ))}
                  </View>
                ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

// ── Build items with date dividers and verse-of-day ────────────────────────

function useBuildItems(segments: JournalSegment[]): ListItem[] {
  return useMemo(() => {
    const items: ListItem[] = [];
    let lastParentDate: string | null = null;

    for (const seg of segments) {
      const segDate = seg.parent_date;

      if (segDate && segDate !== lastParentDate) {
        items.push({
          kind: 'date_divider',
          label: formatDateLabel(segDate),
          parentDate: segDate,
        });
        lastParentDate = segDate;
      }
      items.push({ kind: 'segment', segment: seg });
    }

    return items;
  }, [segments]);
}

function formatDateLabel(parentDate: string): string {
  const [y, m, d] = parentDate.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return formatDateLong(date);
}

// ── Active segment input ───────────────────────────────────────────────────

interface ActiveSegmentInputProps {
  segment: JournalSegment;
  onChangeText: (text: string) => void;
  onKeyPress: (e: { nativeEvent: { key: string } }) => void;
  onFocus: () => void;
}

function ActiveSegmentInput({
  segment,
  onChangeText,
  onKeyPress,
  onFocus,
}: ActiveSegmentInputProps): ReactNode {
  const inputRef = useRef<TextInput>(null);
  const readingStyle = useReadingTextStyle();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <TextInput
      ref={inputRef}
      style={[
        styles.activeInput,
        { fontSize: readingStyle.fontSize, lineHeight: readingStyle.lineHeight },
      ]}
      value={segment.text ?? ''}
      onChangeText={onChangeText}
      onKeyPress={onKeyPress as never}
      onFocus={onFocus}
      multiline
      placeholder="…"
      placeholderTextColor={colors.placeholder}
      autoCapitalize="sentences"
      autoCorrect
      scrollEnabled={false}
    />
  );
}

// ── Static segment text ─────────────────────────────────────────────────────

function StaticSegmentText({ text }: { text: string }): ReactNode {
  const readingStyle = useReadingTextStyle();
  if (text.length === 0) return <View style={{ height: 1 }} />;
  return (
    <Text
      style={[
        styles.staticText,
        { fontSize: readingStyle.fontSize, lineHeight: readingStyle.lineHeight },
      ]}
    >
      {text}
    </Text>
  );
}

// ── Date divider ────────────────────────────────────────────────────────────

function DateDivider({ label }: { label: string }): ReactNode {
  return (
    <View style={styles.dateDivider}>
      <View style={styles.dateDividerLine} />
      <Text style={styles.dateDividerText}>{label}</Text>
      <View style={styles.dateDividerLine} />
    </View>
  );
}

// ── Verse of day card ───────────────────────────────────────────────────────

function VerseOfDayCard({
  reference,
  text,
}: {
  reference: string;
  text: string;
}): ReactNode {
  return (
    <View style={styles.verseDayCard}>
      {text ? (
        <>
          <Text style={styles.verseDayText}>"{text}"</Text>
          <Text style={styles.verseDayRef}>{reference}</Text>
        </>
      ) : (
        <Text style={styles.verseDayRef}>{reference}</Text>
      )}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: layout.screenPaddingX,
    paddingVertical: spacing.lg,
  },
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
  searchBarWrap: {
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    gap: spacing.xs,
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 0,
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 2,
  },
  filterPill: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterPillActive: {
    backgroundColor: '#f1ece2',
    borderColor: colors.accent,
  },
  filterPillText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textSecondary,
  },
  filterPillTextActive: {
    color: colors.accent,
  },
  activePersonBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    backgroundColor: '#f3ede2',
  },
  activePersonText: {
    flex: 1,
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textPrimary,
  },
  activeInput: {
    ...serifText,
    fontSize: 18,
    lineHeight: 28,
    color: colors.textPrimary,
    padding: 0,
    minHeight: 28,
    includeFontPadding: false,
  },
  staticText: {
    ...serifText,
    fontSize: 18,
    lineHeight: 28,
    color: colors.textPrimary,
  },
  dateDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  dateDividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dateDividerText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    letterSpacing: 0.4,
    color: colors.textTertiary,
  },
  verseDayCard: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginVertical: spacing.md,
    gap: spacing.xs,
  },
  verseDayText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  verseDayRef: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.textTertiary,
    textAlign: 'right',
  },
  emptyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 20,
    color: colors.placeholder,
    textAlign: 'center',
  },
  echoSheet: {
    flex: 1,
    backgroundColor: colors.background,
  },
  echoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  echoTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  echoEmpty: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  echoList: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  echoGroupTitle: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  echoCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 6,
  },
  echoCardText: {
    fontFamily: fontFamilies.serif,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  echoCardSource: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.accent,
  },
});
