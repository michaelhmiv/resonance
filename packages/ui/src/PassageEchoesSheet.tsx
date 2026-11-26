/**
 * PassageEchoesSheet — bidirectional semantic Resonance while reading.
 *
 * Shows what across your entire spiritual library and journal echoes the
 * passage you're currently reading:
 *   - Past Journal Entries
 *   - Your Highlights & Margin Notes
 *   - Scripture
 *   - Voices of the Church & Personal Library
 */

import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  fontFamilies,
  radii,
  spacing,
  withAlpha,
  type ReaderThemePalette,
} from '@resonance/theme';
import type { ResonanceCard, ResonanceResult } from '@resonance/core';
import { SparklesIcon, XIcon } from './icons';

export interface PassageEchoesSheetProps {
  visible: boolean;
  theme: ReaderThemePalette;
  sourceLabel: string;
  passageExcerpt: string;
  loading: boolean;
  result: ResonanceResult | null;
  onOpenCard?: (card: ResonanceCard) => void;
  onSendToJournal?: (quote: string, source: string) => void;
  onClose: () => void;
}

export function PassageEchoesSheet({
  visible,
  theme,
  sourceLabel,
  passageExcerpt,
  loading,
  result,
  onOpenCard,
  onSendToJournal,
  onClose,
}: PassageEchoesSheetProps): ReactNode {
  const sections: Array<{ title: string; items: ResonanceCard[] }> = [];
  if (result) {
    if (result.pastEntries.length > 0) {
      sections.push({ title: 'In Your Journal', items: result.pastEntries });
    }
    if (result.highlights && result.highlights.length > 0) {
      sections.push({ title: 'Your Highlights & Notes', items: result.highlights });
    }
    if (result.scripture.length > 0) {
      sections.push({ title: 'Scripture Echoes', items: result.scripture });
    }
    if (result.voices.length > 0) {
      sections.push({ title: 'Voices & Library', items: result.voices });
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} accessibilityLabel="Close echoes" />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={styles.titleRow}>
              <SparklesIcon size={17} color={theme.accent} />
              <Text style={[styles.title, { color: theme.textPrimary }]}>
                Resonant Echoes
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <XIcon size={18} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {/* Anchor Quote */}
            <View
              style={[
                styles.anchorCard,
                { backgroundColor: theme.background, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.anchorRef, { color: theme.textTertiary }]}>
                {sourceLabel}
              </Text>
              <Text
                style={[styles.anchorText, { color: theme.textSecondary }]}
                numberOfLines={3}
              >
                “{passageExcerpt}”
              </Text>
            </View>

            {loading ? (
              <View style={styles.centerState}>
                <ActivityIndicator color={theme.accent} />
                <Text style={[styles.stateText, { color: theme.textTertiary }]}>
                  Listening across your library and journal…
                </Text>
              </View>
            ) : sections.length === 0 ? (
              <View style={styles.centerState}>
                <Text style={[styles.stateText, { color: theme.textTertiary }]}>
                  No strong echoes found yet. Make sure the offline embedding engine is ready in Settings, or keep reading and journaling to build connections.
                </Text>
              </View>
            ) : (
              sections.map((sec) => (
                <View key={sec.title} style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: theme.textTertiary }]}>
                    {sec.title}
                  </Text>
                  {sec.items.map((card, idx) => (
                    <View
                      key={`${card.kind}-${card.passageId}-${card.highlightId ?? idx}`}
                      style={[
                        styles.echoCard,
                        { backgroundColor: theme.background, borderColor: theme.border },
                      ]}
                    >
                      <View style={styles.echoMetaRow}>
                        <Text
                          style={[styles.echoSource, { color: theme.accent }]}
                          numberOfLines={1}
                        >
                          {card.source}
                        </Text>
                      </View>
                      {card.provenance ? (
                        <Text style={[styles.provenance, { color: theme.textTertiary }]}>
                          {card.provenance}
                        </Text>
                      ) : null}
                      <Text
                        style={[styles.echoText, { color: theme.textPrimary }]}
                        numberOfLines={5}
                      >
                        {card.text}
                      </Text>
                      {card.noteText ? (
                        <View
                          style={[
                            styles.noteBubble,
                            {
                              borderLeftColor: theme.accent,
                              backgroundColor: withAlpha(theme.accent, 0.08),
                            },
                          ]}
                        >
                          <Text style={[styles.noteBubbleText, { color: theme.textSecondary }]}>
                            Note: {card.noteText}
                          </Text>
                        </View>
                      ) : null}
                      <View style={styles.cardFooter}>
                        {onOpenCard && card.kind !== 'past_entry' ? (
                          <Pressable
                            onPress={() => {
                              onOpenCard(card);
                              onClose();
                            }}
                            hitSlop={6}
                          >
                            <Text style={[styles.cardAction, { color: theme.accent }]}>
                              Read in Word →
                            </Text>
                          </Pressable>
                        ) : (
                          <View />
                        )}
                        {onSendToJournal ? (
                          <Pressable
                            onPress={() => onSendToJournal(card.text, card.source)}
                            hitSlop={6}
                          >
                            <Text style={[styles.cardActionMuted, { color: theme.textSecondary }]}>
                              + Journal
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 18, 16, 0.46)',
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: '82%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 19,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  anchorCard: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: 4,
  },
  anchorRef: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  anchorText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 22,
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  stateText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 15.5,
    textAlign: 'center',
    lineHeight: 22,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11.5,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  echoCard: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: 6,
  },
  echoMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  echoSource: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12.5,
    flex: 1,
  },
  provenance: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
  },
  echoText: {
    fontFamily: fontFamilies.serif,
    fontSize: 16,
    lineHeight: 23,
  },
  noteBubble: {
    borderLeftWidth: 2,
    paddingLeft: spacing.sm,
    paddingVertical: 4,
    borderRadius: 4,
  },
  noteBubbleText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 14,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  cardAction: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12.5,
  },
  cardActionMuted: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12.5,
  },
});
