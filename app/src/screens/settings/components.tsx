/**
 * Reusable Settings primitives — a card section, toggles, segmented option
 * rows, tappable action rows, and miscellany. Built on the theme so every
 * section shares the same cream / white / hairline vocabulary.
 *
 * Serif for section titles, sans for labels — quiet and reverent chrome.
 *
 * (design spec §8.2 — Settings layout)
 */

import { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';

import { colors, fontFamilies, radii, spacing } from '../../theme';

// ── Section ───────────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/** A white card with a serif heading and an optional quiet description. */
export function Section({ title, description, children }: SectionProps): ReactNode {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {description ? <Text style={styles.sectionDescription}>{description}</Text> : null}
      <View style={styles.card}>{children}</View>
    </View>
  );
}

// ── Toggle row ────────────────────────────────────────────────────────────

interface ToggleRowProps {
  label: string;
  value: boolean;
  onToggle: (next: boolean) => void;
  /** Optional quiet line beneath the label. */
  hint?: string;
}

export function ToggleRow({
  label,
  value,
  onToggle,
  hint,
}: ToggleRowProps): ReactNode {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabel}>
        <Text style={styles.rowLabelText}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Switch knob={styles.switchKnob} value={value} onValueChange={onToggle} />
    </View>
  );
}

// ── Segmented option row ──────────────────────────────────────────────────

interface SegmentedProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  selected: T;
  onChoose: (value: T) => void;
}

export function SegmentedRow<T extends string>({
  label,
  options,
  selected,
  onChoose,
}: SegmentedProps<T>): ReactNode {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabelText}>{label}</Text>
      <View style={styles.segmented}>
        {options.map((opt) => {
          const active = opt.value === selected;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChoose(opt.value)}
              hitSlop={4}
              style={[styles.segmentPill, active && styles.segmentPillActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.segmentText,
                  active && styles.segmentTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ── Selectable list row (single-choice) ────────────────────────────────────

interface ChoiceProps {
  label: string;
  meta?: string;
  selected: boolean;
  onSelect: () => void;
}

export function ChoiceRow({
  label,
  meta,
  selected,
  onSelect,
}: ChoiceProps): ReactNode {
  return (
    <Pressable
      onPress={onSelect}
      hitSlop={6}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <View style={styles.rowLabel}>
        <Text style={styles.rowLabelText}>{label}</Text>
        {meta ? <Text style={styles.rowHint}>{meta}</Text> : null}
      </View>
      <View style={[styles.dot, selected && styles.dotActive]} />
    </Pressable>
  );
}

// ── Tappable action row ───────────────────────────────────────────────────

interface ActionRowProps {
  label: string;
  onPress: () => void;
  /** When true the label renders in a muted red — for destructive actions. */
  destructive?: boolean;
  /** A trailing caption, e.g. a result line ("Exported to …"). */
  trailing?: string;
}

export function ActionRow({
  label,
  onPress,
  destructive,
  trailing,
}: ActionRowProps): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="button"
    >
      <View style={styles.rowLabel}>
        <Text
          style={[
            styles.rowLabelText,
            destructive && styles.rowTextDestructive,
          ]}
        >
          {label}
        </Text>
        {trailing ? <Text style={styles.rowHint}>{trailing}</Text> : null}
      </View>
    </Pressable>
  );
}

// ── Static info row (label + value) ───────────────────────────────────────

interface InfoRowProps {
  label: string;
  value: string;
}

export function InfoRow({ label, value }: InfoRowProps): ReactNode {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabelText}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// ── Card section divider ──────────────────────────────────────────────────

export function RowDivider(): ReactNode {
  return <View style={styles.rowDivider} />;
}

// ── Quiet footer note ──────────────────────────────────────────────────────

export function QuietNote({ children }: { children: ReactNode }): ReactNode {
  return <Text style={styles.quietNote}>{children}</Text>;
}

// ── Inline switch ─────────────────────────────────────────────────────────
// A restrained pill toggle: cream track when off, accent when on, with a
// soft white knob. Mirrors the design spec's "simple switch, accent color".

interface SwitchProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  knob?: TextStyle;
}

function Switch({ value, onValueChange, knob }: SwitchProps): ReactNode {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      hitSlop={8}
      style={[styles.switchTrack, value && styles.switchTrackActive]}
    >
      <View style={[styles.switchKnob, value && styles.switchKnobActive, knob]} />
    </Pressable>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.xxl,
  },
  sectionTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 20,
    letterSpacing: 0.3,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  sectionDescription: {
    fontFamily: fontFamilies.serif,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    minHeight: 44,
    gap: spacing.md,
  },
  rowLabel: {
    flex: 1,
    gap: 2,
  },
  rowLabelText: {
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  rowTextDestructive: {
    color: '#a85c5c',
  },
  rowHint: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  rowPressed: {
    opacity: 0.5,
  },
  infoValue: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textSecondary,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },

  // Segmented control
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    padding: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  segmentPill: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radii.sm,
  },
  segmentPillActive: {
    backgroundColor: colors.surface,
  },
  segmentText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12.5,
    color: colors.textTertiary,
    letterSpacing: 0.3,
  },
  segmentTextActive: {
    color: colors.accent,
  },

  // Radio dot
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dotActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },

  // Switch
  switchTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.border,
    padding: 2,
    justifyContent: 'center',
  },
  switchTrackActive: {
    backgroundColor: colors.accent,
  },
  switchKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surface,
    alignSelf: 'flex-start',
  },
  switchKnobActive: {
    alignSelf: 'flex-end',
  },
  quietNote: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 13,
    lineHeight: 19,
    color: colors.textTertiary,
    marginTop: spacing.sm,
    marginLeft: spacing.xs,
  },
});
