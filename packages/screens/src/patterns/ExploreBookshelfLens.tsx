/**
 * ExploreBookshelfLens — the Living Concordance Study Bookshelf.
 *
 * Every book on the shelf — all 66 books of Scripture and every installed
 * Voice work — is a live door into deeper reading. A single gentle "Group"
 * check toggle switches between:
 *   - Grouped: canonical/era omnibus volumes standing on wooden shelves
 *     (Law, History, Wisdom, Prophets, Gospels, Epistles, Revelation;
 *      Fathers, Medieval, Reform, Devotional) that open into their individual
 *     books right beneath the shelf when tapped.
 *   - Ungrouped: the full open study bookcase (OT, NT, Installed Literature A–Z).
 *
 * All books on a shelf share uniform height and symmetric 3-zone clothbound
 * styling, with dynamic spine font scaling so longer names never clip.
 * Tapping any book lists its traces & bridges cleanly below the shelves.
 */

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SCRIPTURE_SHELF_GROUPS,
  LITERATURE_SHELF_GROUPS,
  fitSpineFontSize,
  parseVerseRefParts,
  type BookBridgeResult,
  type BookshelfClothState,
  type BookshelfSummary,
  type BookshelfVolume,
  type PatternTimeframe,
} from '@resonance/core';

interface ExploreBookshelfLensProps {
  bookshelf: BookshelfSummary | undefined;
  timeframe: PatternTimeframe;
  onLoadBookBridges: (
    kind: 'bible' | 'voice',
    id: string,
    bookId?: string,
  ) => Promise<BookBridgeResult | null>;
  onNavigateToBook?: (bookId: string, chapter?: number, verse?: number) => void;
}

interface SelectedVolume {
  kind: 'bible' | 'voice';
  id: string;
  bookId: string;
  title: string;
  subtitle: string;
}

const CLOTH_STYLES: Record<
  BookshelfClothState,
  { bg: string; border: string; text: string; line: string; star: string }
> = {
  unread: {
    bg: '#f4efe5',
    border: '#d6cbb8',
    text: '#5e554a',
    line: 'rgba(58, 44, 28, 0.14)',
    star: '#8c6419',
  },
  echo: {
    bg: '#f4e2bc',
    border: '#c49a4c',
    text: '#463315',
    line: 'rgba(70, 51, 21, 0.16)',
    star: '#8c6419',
  },
  read: {
    bg: '#a3b59b',
    border: '#718769',
    text: '#1f2b1b',
    line: 'rgba(31, 43, 27, 0.16)',
    star: '#5a4314',
  },
  walnut: {
    bg: '#7b6247',
    border: '#523f2b',
    text: '#faf6ee',
    line: 'rgba(250, 244, 232, 0.24)',
    star: '#f8e1a6',
  },
};

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function aggregateVolumes(volumes: BookshelfVolume[]): {
  readCount: number;
  highlightCount: number;
  noteCount: number;
  bookmarkCount: number;
  echoCount: number;
  clothState: BookshelfClothState;
} {
  let readCount = 0;
  let highlightCount = 0;
  let noteCount = 0;
  let bookmarkCount = 0;
  let echoCount = 0;
  for (const v of volumes) {
    readCount += v.readCount;
    highlightCount += v.highlightCount;
    noteCount += v.noteCount;
    bookmarkCount += v.bookmarkCount;
    echoCount += v.echoCount;
  }
  const visited = readCount + highlightCount + noteCount + bookmarkCount > 0;
  const clothState: BookshelfClothState =
    visited && echoCount >= 2
      ? 'walnut'
      : visited
        ? 'read'
        : echoCount > 0
          ? 'echo'
          : 'unread';
  return { readCount, highlightCount, noteCount, bookmarkCount, echoCount, clothState };
}

export function ExploreBookshelfLens({
  bookshelf,
  timeframe,
  onLoadBookBridges,
  onNavigateToBook,
}: ExploreBookshelfLensProps): ReactNode {
  const [grouped, setGrouped] = useState(true);
  const [openScriptureGroup, setOpenScriptureGroup] = useState<string | null>(null);
  const [openLitGroup, setOpenLitGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedVolume | null>(null);
  const [bridge, setBridge] = useState<BookBridgeResult | null>(null);
  const [loadingBridge, setLoadingBridge] = useState(false);

  const scriptureList = bookshelf?.scripture ?? [];
  const literatureList = bookshelf?.literature ?? [];

  const scriptureByName = useMemo(() => {
    const map = new Map<string, BookshelfVolume>();
    for (const v of scriptureList) map.set(v.id, v);
    return map;
  }, [scriptureList]);

  const otVolumes = useMemo(
    () => scriptureList.filter((v) => v.testament === 'OT'),
    [scriptureList],
  );
  const ntVolumes = useMemo(
    () => scriptureList.filter((v) => v.testament === 'NT'),
    [scriptureList],
  );

  const litByGroup = useMemo(() => {
    const map = new Map<string, BookshelfVolume[]>();
    for (const g of LITERATURE_SHELF_GROUPS) map.set(g.id, []);
    for (const v of literatureList) {
      const list = map.get(v.groupId) ?? [];
      list.push(v);
      map.set(v.groupId, list);
    }
    return map;
  }, [literatureList]);

  const activeLitGroups = useMemo(
    () => LITERATURE_SHELF_GROUPS.filter((g) => (litByGroup.get(g.id)?.length ?? 0) > 0),
    [litByGroup],
  );

  // Auto-select the strongest echoing unread (or active) book on first load so the bridge area feels alive
  useEffect(() => {
    if (selected || scriptureList.length === 0) return;
    const callingUnread = scriptureList.find((v) => v.clothState === 'echo');
    const active = scriptureList.find((v) => v.clothState === 'walnut' || v.clothState === 'read');
    const pick = callingUnread ?? active ?? scriptureList.find((v) => v.id === 'Psalms') ?? scriptureList[0];
    if (pick) {
      setSelected({
        kind: pick.kind,
        id: pick.id,
        bookId: pick.bookId,
        title: pick.title,
        subtitle: pick.subtitle,
      });
      setOpenScriptureGroup(pick.groupId);
    }
  }, [scriptureList, selected]);

  // Fetch live book bridges whenever selection or timeframe changes
  useEffect(() => {
    if (!selected) {
      setBridge(null);
      return;
    }
    let cancelled = false;
    setLoadingBridge(true);
    void onLoadBookBridges(selected.kind, selected.id, selected.bookId)
      .then((res) => {
        if (!cancelled) setBridge(res);
      })
      .catch(() => {
        if (!cancelled) setBridge(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingBridge(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, timeframe, onLoadBookBridges]);

  const handleSelectVolume = useCallback((v: BookshelfVolume) => {
    setSelected({
      kind: v.kind,
      id: v.id,
      bookId: v.bookId,
      title: v.title,
      subtitle: v.subtitle,
    });
  }, []);

  const handleJump = useCallback(
    (bookId: string, ref?: string, chapter?: number | null, verse?: number | null) => {
      if (!onNavigateToBook) return;
      if (chapter != null) {
        onNavigateToBook(bookId, chapter, verse ?? undefined);
        return;
      }
      const parsed = parseVerseRefParts(ref);
      onNavigateToBook(bookId, parsed.chapter ?? undefined, parsed.verse ?? undefined);
    },
    [onNavigateToBook],
  );

  const openSGroupMeta = SCRIPTURE_SHELF_GROUPS.find((g) => g.id === openScriptureGroup) ?? null;
  const openSGroupVolumes = useMemo(() => {
    if (!openSGroupMeta) return [];
    return openSGroupMeta.books
      .map((name) => scriptureByName.get(name))
      .filter((v): v is BookshelfVolume => Boolean(v));
  }, [openSGroupMeta, scriptureByName]);

  const openLGroupMeta = LITERATURE_SHELF_GROUPS.find((g) => g.id === openLitGroup) ?? null;
  const openLGroupVolumes = openLGroupMeta ? litByGroup.get(openLGroupMeta.id) ?? [] : [];

  return (
    <View style={styles.root}>
      {/* Top Bar: gentle prompt + single Group check button */}
      <View style={styles.topBar}>
        <Text style={styles.subtitleText}>
          {grouped
            ? 'Tap a volume to open its books'
            : 'Every volume is tappable — read or unread'}
        </Text>
        <Pressable
          onPress={() => setGrouped((prev) => !prev)}
          style={[styles.groupToggle, grouped && styles.groupToggleActive]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: grouped }}
          accessibilityLabel="Group books by category"
        >
          <View style={[styles.checkBox, grouped && styles.checkBoxChecked]}>
            {grouped ? <Text style={styles.checkMark}>✓</Text> : null}
          </View>
          <Text style={[styles.groupToggleText, grouped && styles.groupToggleTextActive]}>
            Group
          </Text>
        </Pressable>
      </View>

      {/* Bookcase */}
      {grouped ? (
        <View style={styles.bookcaseFrame}>
          {/* Shelf 1: Scripture Category Volumes */}
          <View style={styles.shelfHeader}>
            <Text style={styles.shelfLabel}>Scripture</Text>
            <Text style={styles.shelfMeta}>66 books · 7 sections</Text>
          </View>
          <View style={styles.shelfBayCentered}>
            {SCRIPTURE_SHELF_GROUPS.map((grp) => {
              const vols = grp.books
                .map((n) => scriptureByName.get(n))
                .filter((v): v is BookshelfVolume => Boolean(v));
              const agg = aggregateVolumes(vols);
              const isOpen = openScriptureGroup === grp.id;
              return (
                <BookVolume
                  key={grp.id}
                  label={grp.label}
                  clothState={agg.clothState}
                  hasEcho={agg.echoCount > 0}
                  hasHighlight={agg.highlightCount > 0}
                  hasNote={false}
                  countLabel={String(grp.books.length)}
                  heightPx={118}
                  baseFontSize={13}
                  flexWidth
                  maxWidth={46}
                  active={isOpen}
                  onPress={() => {
                    const next = isOpen ? null : grp.id;
                    setOpenScriptureGroup(next);
                    if (next) setOpenLitGroup(null);
                  }}
                />
              );
            })}
          </View>
          <View style={styles.shelfWood} />

          {/* Expanded Scripture Category Books */}
          {openSGroupMeta && openSGroupVolumes.length > 0 ? (
            <View style={styles.drawerShelf}>
              <View style={styles.drawerHeader}>
                <Text style={styles.drawerTitle}>
                  {openSGroupMeta.label}{' '}
                  <Text style={styles.drawerCount}>{openSGroupVolumes.length} books</Text>
                </Text>
                <Pressable onPress={() => setOpenScriptureGroup(null)} hitSlop={8}>
                  <Text style={styles.closeLink}>Close</Text>
                </Pressable>
              </View>
              {chunk(openSGroupVolumes, 9).map((row, rowIdx) => (
                <View key={rowIdx}>
                  <View style={styles.shelfBayLeft}>
                    {row.map((vol) => (
                      <BookVolume
                        key={vol.id}
                        label={vol.spineLabel}
                        clothState={vol.clothState}
                        hasEcho={vol.echoCount > 0}
                        hasHighlight={vol.highlightCount > 0}
                        hasNote={vol.noteCount > 0}
                        heightPx={76}
                        baseFontSize={11.5}
                        fixedWidth={34}
                        active={selected?.kind === 'bible' && selected?.id === vol.id}
                        onPress={() => handleSelectVolume(vol)}
                      />
                    ))}
                  </View>
                  <View style={[styles.shelfWood, styles.shelfWoodTight]} />
                </View>
              ))}
            </View>
          ) : null}

          {/* Shelf 2: Installed Literature Era Volumes */}
          <View style={[styles.shelfHeader, { marginTop: 4 }]}>
            <Text style={styles.shelfLabel}>Installed Literature</Text>
            <Text style={styles.shelfMeta}>
              {literatureList.length > 0
                ? `${literatureList.length} ${literatureList.length === 1 ? 'author' : 'authors'}`
                : 'No books enabled'}
            </Text>
          </View>
          {activeLitGroups.length > 0 ? (
            <>
              <View style={styles.shelfBayCentered}>
                {activeLitGroups.map((grp) => {
                  const vols = litByGroup.get(grp.id) ?? [];
                  const agg = aggregateVolumes(vols);
                  const isOpen = openLitGroup === grp.id;
                  return (
                    <BookVolume
                      key={grp.id}
                      label={grp.label}
                      clothState={agg.clothState}
                      hasEcho={agg.echoCount > 0}
                      hasHighlight={agg.highlightCount > 0}
                      hasNote={false}
                      countLabel={String(vols.length)}
                      heightPx={118}
                      baseFontSize={13.5}
                      flexWidth
                      maxWidth={68}
                      active={isOpen}
                      onPress={() => {
                        const next = isOpen ? null : grp.id;
                        setOpenLitGroup(next);
                        if (next) setOpenScriptureGroup(null);
                      }}
                    />
                  );
                })}
              </View>
              <View style={styles.shelfWood} />

              {openLGroupMeta && openLGroupVolumes.length > 0 ? (
                <View style={styles.drawerShelf}>
                  <View style={styles.drawerHeader}>
                    <Text style={styles.drawerTitle}>
                      {openLGroupMeta.fullLabel}{' '}
                      <Text style={styles.drawerCount}>A–Z</Text>
                    </Text>
                    <Pressable onPress={() => setOpenLitGroup(null)} hitSlop={8}>
                      <Text style={styles.closeLink}>Close</Text>
                    </Pressable>
                  </View>
                  {chunk(openLGroupVolumes, 9).map((row, rowIdx) => (
                    <View key={rowIdx}>
                      <View style={styles.shelfBayLeft}>
                        {row.map((vol) => (
                          <BookVolume
                            key={vol.id}
                            label={vol.spineLabel}
                            clothState={vol.clothState}
                            hasEcho={vol.echoCount > 0}
                            hasHighlight={vol.highlightCount > 0}
                            hasNote={vol.noteCount > 0}
                            heightPx={98}
                            baseFontSize={11.5}
                            fixedWidth={35}
                            active={selected?.kind === 'voice' && selected?.id === vol.id}
                            onPress={() => handleSelectVolume(vol)}
                          />
                        ))}
                      </View>
                      <View style={[styles.shelfWood, styles.shelfWoodTight]} />
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.emptyShelfNote}>
              <Text style={styles.emptyShelfText}>
                Enable books in the Word library to shelve Christian voices alongside Scripture.
              </Text>
            </View>
          )}
        </View>
      ) : (
        /* Ungrouped Open Bookcase */
        <View style={styles.ungroupedWrap}>
          <View style={styles.bookcaseFrame}>
            <View style={styles.shelfHeader}>
              <Text style={styles.shelfLabel}>Old Testament</Text>
              <Text style={styles.shelfMeta}>{otVolumes.length} books</Text>
            </View>
            {chunk(otVolumes, 10).map((row, idx) => (
              <View key={`ot-${idx}`}>
                <View style={styles.shelfBayLeftTight}>
                  {row.map((vol) => (
                    <BookVolume
                      key={vol.id}
                      label={vol.spineLabel}
                      clothState={vol.clothState}
                      hasEcho={vol.echoCount > 0}
                      hasHighlight={vol.highlightCount > 0}
                      hasNote={vol.noteCount > 0}
                      heightPx={72}
                      baseFontSize={11}
                      flexWidth
                      maxWidth={34}
                      active={selected?.kind === 'bible' && selected?.id === vol.id}
                      onPress={() => handleSelectVolume(vol)}
                    />
                  ))}
                </View>
                <View style={styles.shelfWood} />
              </View>
            ))}
          </View>

          <View style={styles.bookcaseFrame}>
            <View style={styles.shelfHeader}>
              <Text style={styles.shelfLabel}>New Testament</Text>
              <Text style={styles.shelfMeta}>{ntVolumes.length} books</Text>
            </View>
            {chunk(ntVolumes, 10).map((row, idx) => (
              <View key={`nt-${idx}`}>
                <View style={styles.shelfBayLeftTight}>
                  {row.map((vol) => (
                    <BookVolume
                      key={vol.id}
                      label={vol.spineLabel}
                      clothState={vol.clothState}
                      hasEcho={vol.echoCount > 0}
                      hasHighlight={vol.highlightCount > 0}
                      hasNote={vol.noteCount > 0}
                      heightPx={72}
                      baseFontSize={11}
                      flexWidth
                      maxWidth={34}
                      active={selected?.kind === 'bible' && selected?.id === vol.id}
                      onPress={() => handleSelectVolume(vol)}
                    />
                  ))}
                </View>
                <View style={styles.shelfWood} />
              </View>
            ))}
          </View>

          {literatureList.length > 0 ? (
            <View style={styles.bookcaseFrame}>
              <View style={styles.shelfHeader}>
                <Text style={styles.shelfLabel}>Installed Literature · A–Z</Text>
                <Text style={styles.shelfMeta}>{literatureList.length} authors</Text>
              </View>
              {chunk(literatureList, 9).map((row, idx) => (
                <View key={`lit-${idx}`}>
                  <View style={styles.shelfBayLeftTight}>
                    {row.map((vol) => (
                      <BookVolume
                        key={vol.id}
                        label={vol.spineLabel}
                        clothState={vol.clothState}
                        hasEcho={vol.echoCount > 0}
                        hasHighlight={vol.highlightCount > 0}
                        hasNote={vol.noteCount > 0}
                        heightPx={98}
                        baseFontSize={11}
                        flexWidth
                        maxWidth={38}
                        active={selected?.kind === 'voice' && selected?.id === vol.id}
                        onPress={() => handleSelectVolume(vol)}
                      />
                    ))}
                  </View>
                  <View style={styles.shelfWood} />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      )}

      {/* Selected Book Details & Bridges listed cleanly below the shelves */}
      {selected ? (
        <View style={styles.bridgeCard}>
          <View style={styles.bridgeHeader}>
            <View style={styles.bridgeTitleWrap}>
              <View style={styles.bridgeTitleRow}>
                <Text style={styles.bridgeTitle}>{selected.title}</Text>
                <BridgeStatusBadges bridge={bridge} />
              </View>
              <Text style={styles.bridgeSubtitle} numberOfLines={1}>
                {selected.subtitle}
              </Text>
            </View>
            {onNavigateToBook ? (
              <Pressable
                onPress={() => handleJump(bridge?.bookId ?? selected.bookId, selected.title)}
                hitSlop={8}
              >
                <Text style={styles.openLink}>Open →</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.bridgeSectionLabel}>
            {bridge?.visited
              ? `Your traces & echoes in ${selected.title}`
              : `Ways into ${selected.title} from your recent life`}
          </Text>

          {loadingBridge ? (
            <View style={styles.bridgeLoading}>
              <ActivityIndicator size="small" color="#8b7355" />
            </View>
          ) : bridge && bridge.items.length > 0 ? (
            <View style={styles.bridgeList}>
              {bridge.items.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() =>
                    handleJump(item.bookId ?? bridge.bookId, item.ref, item.chapter, item.verse)
                  }
                  disabled={!onNavigateToBook}
                  style={styles.bridgeRow}
                >
                  <View style={styles.bridgeRowLeft}>
                    <Text style={styles.bridgeRef}>{item.ref}</Text>
                    <Text style={styles.bridgeQuote} numberOfLines={3}>
                      “{item.quote}”
                    </Text>
                  </View>
                  <View style={styles.bridgeRowRight}>
                    <Text style={styles.bridgeVia}>{item.viaLabel}</Text>
                    <Text style={styles.bridgeLinkText} numberOfLines={3}>
                      {item.linkText}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyBridgeText}>
              Tap Open to step into {selected.title}. As you write and highlight, Resonance will
              surface passages from {selected.title} that sit near your life.
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function BridgeStatusBadges({ bridge }: { bridge: BookBridgeResult | null }): ReactNode {
  if (!bridge) return null;
  const chips: Array<{ text: string; bg: string; fg: string; border: string }> = [];
  if (bridge.counts.read > 0) {
    chips.push({
      text: `${bridge.counts.read} read`,
      bg: '#eef3ec',
      fg: '#445c41',
      border: '#d1decb',
    });
  }
  if (bridge.counts.highlights > 0) {
    chips.push({
      text: `${bridge.counts.highlights} highlighted`,
      bg: '#fbf1e4',
      fg: '#8b5a22',
      border: '#ebd4b5',
    });
  }
  if (bridge.counts.notes > 0) {
    chips.push({
      text: `${bridge.counts.notes} ${bridge.counts.notes === 1 ? 'note' : 'notes'}`,
      bg: '#f1eff8',
      fg: '#5c5085',
      border: '#dad4ec',
    });
  }
  if (chips.length === 0) {
    chips.push({
      text: 'Not read yet',
      bg: '#f8edd5',
      fg: '#7a5d29',
      border: '#e6cfa0',
    });
  }

  return (
    <>
      {chips.map((c) => (
        <View
          key={c.text}
          style={[styles.badge, { backgroundColor: c.bg, borderColor: c.border }]}
        >
          <Text style={[styles.badgeText, { color: c.fg }]}>{c.text}</Text>
        </View>
      ))}
    </>
  );
}

// ── Fine-Press Symmetric 3-Zone Upright Book Volume ──────────────────────────

function BookVolume({
  label,
  clothState,
  hasEcho,
  hasHighlight,
  hasNote,
  countLabel,
  heightPx,
  baseFontSize,
  fixedWidth,
  flexWidth,
  maxWidth,
  active,
  onPress,
}: {
  label: string;
  clothState: BookshelfClothState;
  hasEcho: boolean;
  hasHighlight: boolean;
  hasNote: boolean;
  countLabel?: string;
  heightPx: number;
  baseFontSize: number;
  fixedWidth?: number;
  flexWidth?: boolean;
  maxWidth?: number;
  active: boolean;
  onPress: () => void;
}): ReactNode {
  const palette = CLOTH_STYLES[clothState];
  const fittedSize = fitSpineFontSize(label, heightPx, baseFontSize);
  const bodySpan = Math.max(24, heightPx - 35);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.volumeWrap,
        fixedWidth != null ? { width: fixedWidth } : null,
        flexWidth ? { flex: 1, maxWidth } : null,
        active ? styles.volumeWrapActive : null,
      ]}
    >
      {/* Centered silk bookmark ribbon peeking behind spine head */}
      {hasHighlight ? <View style={styles.bookmarkRibbon} /> : null}

      <View
        style={[
          styles.volumeSpine,
          {
            height: heightPx,
            backgroundColor: palette.bg,
            borderColor: active ? '#3a3530' : palette.border,
            borderWidth: active ? 1.5 : 1,
          },
        ]}
      >
        {/* Top Crest Zone */}
        <View style={[styles.volHead, { borderBottomColor: palette.line }]}>
          {hasEcho ? (
            <Text style={[styles.crestStar, { color: palette.star }]}>✦</Text>
          ) : null}
        </View>

        {/* Center Title Plate Zone (rotated -90deg, strictly centered on both axes) */}
        <View style={styles.volBody}>
          <View style={[styles.volLabelRotator, { width: bodySpan }]}>
            <Text
              numberOfLines={1}
              style={[
                styles.volLabel,
                { fontSize: fittedSize, color: palette.text },
              ]}
            >
              {label}
            </Text>
          </View>
        </View>

        {/* Bottom Colophon Zone */}
        <View style={[styles.volFoot, { borderTopColor: palette.line }]}>
          {countLabel != null ? (
            <Text style={[styles.colophonNum, { color: palette.text }]}>{countLabel}</Text>
          ) : hasNote ? (
            <View style={styles.colophonNote} />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 12,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 2,
  },
  subtitleText: {
    flex: 1,
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontStyle: 'italic',
    fontSize: 14.5,
    color: '#7a7368',
  },
  groupToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e0d8cc',
    backgroundColor: '#ffffff',
  },
  groupToggleActive: {
    borderColor: '#8b7355',
    backgroundColor: '#f4ede2',
  },
  checkBox: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#c6bdb0',
    backgroundColor: '#faf8f4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxChecked: {
    borderColor: '#8b7355',
    backgroundColor: '#8b7355',
  },
  checkMark: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 9,
    fontWeight: '700',
    color: '#faf8f4',
    lineHeight: 11,
  },
  groupToggleText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11,
    color: '#7a7368',
  },
  groupToggleTextActive: {
    color: '#3a3530',
    fontWeight: '600',
  },
  bookcaseFrame: {
    backgroundColor: '#f3efe7',
    borderWidth: 1,
    borderColor: '#e2d9ca',
    borderRadius: 14,
    paddingTop: 12,
    paddingHorizontal: 10,
    paddingBottom: 6,
    gap: 4,
  },
  ungroupedWrap: {
    gap: 12,
  },
  shelfHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  shelfLabel: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#7a7064',
  },
  shelfMeta: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 10,
    color: '#9a9286',
  },
  shelfBayCentered: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 12,
    paddingHorizontal: 4,
  },
  shelfBayLeft: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    gap: 4,
    paddingTop: 12,
    paddingHorizontal: 4,
  },
  shelfBayLeftTight: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    gap: 3,
    paddingTop: 12,
    paddingHorizontal: 3,
  },
  shelfWood: {
    height: 8,
    borderRadius: 2,
    backgroundColor: '#cbb89d',
    borderTopWidth: 1,
    borderTopColor: '#e4d8c4',
    borderBottomWidth: 2,
    borderBottomColor: '#b59f82',
    marginBottom: 8,
  },
  shelfWoodTight: {
    marginBottom: 4,
  },
  drawerShelf: {
    backgroundColor: 'rgba(255, 252, 246, 0.82)',
    borderWidth: 1,
    borderColor: '#dfd5c5',
    borderRadius: 10,
    padding: 8,
    marginBottom: 8,
    gap: 4,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  drawerTitle: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontSize: 15.5,
    fontWeight: '600',
    color: '#3a3530',
  },
  drawerCount: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 10,
    fontWeight: '400',
    color: '#9a9286',
  },
  closeLink: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 10.5,
    fontWeight: '500',
    color: '#8b7355',
  },
  emptyShelfNote: {
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  emptyShelfText: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontStyle: 'italic',
    fontSize: 14,
    color: '#8a8277',
    textAlign: 'center',
  },
  // ── Fine-press spine ──────────────────────────────────────────
  volumeWrap: {
    alignItems: 'center',
    position: 'relative',
    paddingTop: 6,
  },
  volumeWrapActive: {
    transform: [{ translateY: -7 }],
    zIndex: 10,
  },
  bookmarkRibbon: {
    position: 'absolute',
    top: 0,
    width: 6,
    height: 8,
    backgroundColor: '#c48342',
    borderTopLeftRadius: 1.5,
    borderTopRightRadius: 1.5,
  },
  volumeSpine: {
    width: '100%',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderBottomLeftRadius: 1,
    borderBottomRightRadius: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    overflow: 'hidden',
  },
  volHead: {
    width: '100%',
    height: 17,
    borderBottomWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volBody: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  volLabelRotator: {
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-90deg' }],
  },
  volLabel: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontWeight: '600',
    textAlign: 'center',
  },
  volFoot: {
    width: '100%',
    height: 16,
    borderTopWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crestStar: {
    fontSize: 9,
    lineHeight: 11,
  },
  colophonNum: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 9,
    opacity: 0.72,
  },
  colophonNote: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#6f629e',
  },
  // ── Selected Book Bridge Card below shelf ─────────────────────
  bridgeCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dfd8cc',
    borderRadius: 12,
    padding: 15,
    gap: 10,
  },
  bridgeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  bridgeTitleWrap: {
    flex: 1,
    gap: 3,
  },
  bridgeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  bridgeTitle: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontSize: 20,
    fontWeight: '600',
    color: '#3a3530',
  },
  bridgeSubtitle: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11,
    color: '#9a9388',
  },
  openLink: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 12,
    fontWeight: '600',
    color: '#8b7355',
    paddingTop: 4,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 10,
    fontWeight: '500',
  },
  bridgeSectionLabel: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: '#8b7355',
  },
  bridgeLoading: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  bridgeList: {
    gap: 8,
  },
  bridgeRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 11,
    borderRadius: 9,
    backgroundColor: '#f8f4ec',
    borderWidth: 1,
    borderColor: '#ece6da',
  },
  bridgeRowLeft: {
    flex: 7,
    gap: 3,
  },
  bridgeRef: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11,
    fontWeight: '600',
    color: '#3a3530',
  },
  bridgeQuote: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontStyle: 'italic',
    fontSize: 14.5,
    lineHeight: 20,
    color: '#3a3530',
  },
  bridgeRowRight: {
    flex: 5,
    paddingLeft: 10,
    borderLeftWidth: 1,
    borderLeftColor: '#e4ddd0',
    justifyContent: 'center',
    gap: 3,
  },
  bridgeVia: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#8b7355',
  },
  bridgeLinkText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11,
    lineHeight: 15.5,
    color: '#5c554c',
  },
  emptyBridgeText: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 22,
    color: '#7a7368',
  },
});
