/**
 * Resonance card group — renders surfaced Scripture, voices, and past
 * entries as elegant inline cards within the journal flow.
 *
 * These appear after the user pauses writing, showing what the heart's
 * words resonate with. Quiet, not pushy — cards sit in the flow and
 * can be dismissed by continuing to type.
 *
 * (design spec §5.7 — resonance cards from the user's writing;
 *  §7.2 — appearance and interaction)
 */

import { type ReactNode } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { WindIcon } from './icons';

import {
  cardSurface,
  colors,
  fontFamilies,
  radii,
  serifText,
  spacing,
} from '@resonance/theme';
import type { ResonanceCard } from '@resonance/core';

interface ResonanceCardGroupProps {
  cards: ResonanceCard[];
  onOpenPassage?: (passageId: number) => void;
}

export function ResonanceCardGroup({
  cards,
  onOpenPassage,
}: ResonanceCardGroupProps): ReactNode {
  if (cards.length === 0) return null;

  // Group cards by kind.
  const scripture = cards.filter((c) => c.kind === 'scripture');
  const voices = cards.filter((c) => c.kind === 'voice');
  const past = cards.filter((c) => c.kind === 'past_entry');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <WindIcon size={14} color={colors.resonance} />
        <Text style={styles.headerText}>Resonance</Text>
      </View>

      {scripture.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Scripture</Text>
          {scripture.map((card) => (
            <ResonanceCardItem
              key={`s-${card.passageId}`}
              card={card}
              onOpen={onOpenPassage}
            />
          ))}
        </View>
      )}

      {voices.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Voices</Text>
          {voices.map((card) => (
            <ResonanceCardItem
              key={`v-${card.passageId}`}
              card={card}
              onOpen={onOpenPassage}
            />
          ))}
        </View>
      )}

      {past.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Where you were</Text>
          {past.map((card, i) => (
            <ResonanceCardItem
              key={`p-${card.passageId}-${i}`}
              card={card}
              onOpen={onOpenPassage}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ── Individual card ──────────────────────────────────────────────────────────

function ResonanceCardItem({
  card,
  onOpen,
}: {
  card: ResonanceCard;
  onOpen?: (passageId: number) => void;
}): ReactNode {
  const canOpen = card.kind !== 'past_entry' && card.passageId > 0;

  return (
    <Pressable
      onPress={() => canOpen && onOpen?.(card.passageId)}
      disabled={!canOpen}
      style={({ pressed }) => [
        cardSurface,
        styles.card,
        pressed && styles.cardPressed,
      ]}
      accessibilityRole={canOpen ? 'button' : 'text'}
      accessibilityLabel={`Resonance: ${card.source}`}
    >
      <Text style={styles.quote} numberOfLines={3}>
        "{card.text}"
      </Text>
      <Text style={styles.source}>{card.source}</Text>
    </Pressable>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.xs,
  },
  headerText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.resonance,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
    letterSpacing: 0.4,
    color: colors.textTertiary,
    textTransform: 'uppercase',
  },
  card: {
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  cardPressed: {
    backgroundColor: colors.background,
  },
  quote: {
    ...serifText,
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  source: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
    letterSpacing: 0.3,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
});
