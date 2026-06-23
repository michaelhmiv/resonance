import { StyleSheet, ViewStyle, TextStyle } from 'react-native';

import { colors } from './colors';
import { fontFamilies } from './typography';

/**
 * Shared spacing / radii tokens.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const layout = {
  /** Side margin for screen content on phone. */
  screenPaddingX: spacing.xl,
  /** Vertical gap between cards / sections. */
  sectionGap: spacing.xl,
  cardPadding: spacing.lg,
} as const;

/**
 * Card surface — soft white tile with a hairline border, no drop shadow.
 * (design spec §2.1: "Card border: Hairline, no drop shadows".)
 */
export const cardSurface: ViewStyle = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderWidth: StyleSheet.hairlineWidth,
  borderRadius: radii.md,
};

/**
 * A flatlist / flash-list inner cell padding.
 */
export const listContentContainer: ViewStyle = {
  paddingHorizontal: layout.screenPaddingX,
  paddingVertical: spacing.xl,
};

export const screenContainer: ViewStyle = {
  flex: 1,
  backgroundColor: colors.background,
};

/** Sans-serif label used for tab bar / metadata chrome. */
export const sansLabel: TextStyle = {
  fontFamily: fontFamilies.sansMedium,
  fontSize: 13,
  letterSpacing: 0.4,
};
