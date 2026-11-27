/**
 * MemoriesAndPeopleSheet — browsable Life Diary hub accessible from the Journal
 * header (and linked from Patterns' People & Moments card).
 *
 * Two quiet tabs:
 *   - People: every tagged person with memory counts → tap to filter Journal
 *   - Gallery: Photos, Videos, and Voice archive → tap to jump to that memory
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { DiaryMediaItem, DiaryMediaKind, DiaryPerson } from '@resonance/core';
import { colors, fontFamilies, radii, spacing } from '@resonance/theme';
import { useDiaryMediaStore } from '../diary/diaryMediaService';

interface Props {
  visible: boolean;
  initialTab?: 'people' | 'gallery';
  onClose: () => void;
  onSelectPerson: (person: DiaryPerson) => void;
  onSelectMemory: (item: DiaryMediaItem) => void;
}

export function MemoriesAndPeopleSheet({
  visible,
  initialTab = 'gallery',
  onClose,
  onSelectPerson,
  onSelectMemory,
}: Props): ReactNode {
  const allMedia = useDiaryMediaStore((s) => s.allMedia);
  const people = useDiaryMediaStore((s) => s.people);

  const [tab, setTab] = useState<'people' | 'gallery'>(initialTab);
  const [kindFilter, setKindFilter] = useState<'all' | DiaryMediaKind>('all');

  const filteredMedia = useMemo(() => {
    if (kindFilter === 'all') return allMedia;
    return allMedia.filter((m) => m.kind === kindFilter);
  }, [allMedia, kindFilter]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>Memories & People</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Feather name="x" size={22} color={colors.textPrimary} />
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={styles.tabsRow}>
          <Pressable
            onPress={() => setTab('gallery')}
            style={[styles.tabBtn, tab === 'gallery' && styles.tabBtnActive]}
          >
            <Text style={[styles.tabText, tab === 'gallery' && styles.tabTextActive]}>
              Gallery ({allMedia.length})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTab('people')}
            style={[styles.tabBtn, tab === 'people' && styles.tabBtnActive]}
          >
            <Text style={[styles.tabText, tab === 'people' && styles.tabTextActive]}>
              People ({people.length})
            </Text>
          </Pressable>
        </View>

        {tab === 'people' ? (
          <ScrollView contentContainerStyle={styles.listBody}>
            {people.length === 0 ? (
              <Text style={styles.emptyText}>
                No people tagged yet. Tap "+ Person" on any photo, video, or voice note in your
                journal to build your People timeline.
              </Text>
            ) : (
              people.map((person) => (
                <Pressable
                  key={person.id}
                  onPress={() => {
                    onSelectPerson(person);
                    onClose();
                  }}
                  style={styles.personRow}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarLetter}>
                      {person.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.personName}>{person.name}</Text>
                    <Text style={styles.personMeta}>
                      {person.memoryCount ?? 0}{' '}
                      {(person.memoryCount ?? 0) === 1 ? 'memory' : 'memories'}
                      {person.relationship ? ` · ${person.relationship}` : ''}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.textTertiary} />
                </Pressable>
              ))
            )}
          </ScrollView>
        ) : (
          <>
            <View style={styles.filterRow}>
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'photo', label: 'Photos' },
                  { id: 'video', label: 'Videos' },
                  { id: 'voice', label: 'Voice' },
                ] as Array<{ id: 'all' | DiaryMediaKind; label: string }>
              ).map((f) => (
                <Pressable
                  key={f.id}
                  onPress={() => setKindFilter(f.id)}
                  style={[
                    styles.filterPill,
                    kindFilter === f.id && styles.filterPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      kindFilter === f.id && styles.filterPillTextActive,
                    ]}
                  >
                    {f.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <ScrollView contentContainerStyle={styles.gridBody}>
              {filteredMedia.length === 0 ? (
                <Text style={styles.emptyText}>
                  No memories captured here yet. Use the Voice, Photo, or Video bar in your
                  Journal to save moments.
                </Text>
              ) : (
                <View style={styles.grid}>
                  {filteredMedia.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => {
                        onSelectMemory(item);
                        onClose();
                      }}
                      style={styles.tile}
                    >
                      {item.kind === 'photo' || (item.kind === 'video' && item.thumbUri) ? (
                        <Image
                          source={{ uri: item.thumbUri ?? item.localUri }}
                          style={styles.tileImg}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.tileVoice}>
                          <Feather
                            name={item.kind === 'voice' ? 'mic' : 'video'}
                            size={22}
                            color={colors.accent}
                          />
                          <Text style={styles.tileVoiceSnippet} numberOfLines={3}>
                            {item.transcript || item.caption || 'Voice note'}
                          </Text>
                        </View>
                      )}
                      {item.kind === 'video' ? (
                        <View style={styles.tileVideoBadge}>
                          <Feather name="play" size={11} color="#ffffff" />
                        </View>
                      ) : null}
                      <Text style={styles.tileDate} numberOfLines={1}>
                        {new Date(item.capturedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                        {item.people.length > 0 ? ` · ${item.people[0].name}` : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  tabText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.textPrimary,
  },
  tabTextActive: {
    color: '#ffffff',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: 6,
  },
  filterPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
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
  listBody: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  gridBody: {
    padding: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  tileImg: {
    width: '100%',
    height: 130,
    backgroundColor: '#ebe6dc',
  },
  tileVoice: {
    height: 130,
    padding: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f5f1e8',
  },
  tileVoiceSnippet: {
    fontFamily: fontFamilies.serif,
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  tileVideoBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(28, 25, 21, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileDate: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
    color: colors.textSecondary,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#efe9dd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 18,
    color: colors.accent,
  },
  personName: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  personMeta: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  emptyText: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
