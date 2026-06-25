/**
 * HighlightedVerseText — render a verse string with multiple overlapping
 * highlights stacked via segment-splitting.
 *
 * The verse text is a single string. Each highlight has (start_offset,
 * end_offset, color). We split the string at every highlight boundary, then
 * walk the segments, layering backgrounds as we go. The renderer uses
 * "later wins" overlap semantics (the highlight drawn later in the array
 * covers the earlier one on overlap).
 *
 * Legacy highlights (start_offset = null / end_offset = null) are rendered
 * separately by the caller as a flat background on the whole verse block.
 *
 * Web: this is just nested <Text> elements. RN: same. The backgroundColor
 * style on each segment does the work.
 */

import { type ReactNode } from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors, withAlpha } from '@resonance/theme';
import type { Highlight } from '@resonance/core';

export interface HighlightSegment {
  text: string;
  /** The highlight that owns this segment, or null for un-highlighted text. */
  highlight: Highlight | null;
}

/**
 * Split `verseText` at every highlight boundary, returning an array of
 * segments in document order. Overlapping highlights: later in the array
 * wins on overlap (covers earlier backgrounds).
 */
export function splitVerseByHighlights(
  verseText: string,
  highlights: Highlight[],
): HighlightSegment[] {
  // Keep only phrase-level highlights (legacy null-offset highlights are
  // rendered as a flat block background by the caller).
  const phrase = highlights
    .filter(
      (h) =>
        h.start_offset != null &&
        h.end_offset != null &&
        h.start_offset < h.end_offset,
    )
    .sort((a, b) => (a.start_offset ?? 0) - (b.start_offset ?? 0));

  if (phrase.length === 0) {
    return [{ text: verseText, highlight: null }];
  }

  // Build the set of unique cut-points. Then walk the text in slices.
  const cuts = new Set<number>([0, verseText.length]);
  for (const h of phrase) {
    const s = Math.max(0, Math.min(h.start_offset!, verseText.length));
    const e = Math.max(0, Math.min(h.end_offset!, verseText.length));
    cuts.add(s);
    cuts.add(e);
  }
  const sortedCuts = Array.from(cuts).sort((a, b) => a - b);

  const segments: HighlightSegment[] = [];
  for (let i = 0; i < sortedCuts.length - 1; i++) {
    const start = sortedCuts[i];
    const end = sortedCuts[i + 1];
    if (start >= end) continue;
    const text = verseText.slice(start, end);
    // "Later wins" — pick the highlight that covers this segment and has
    // the largest start_offset (i.e., was declared later).
    const owner = phrase
      .filter((h) => (h.start_offset ?? 0) <= start && (h.end_offset ?? 0) >= end)
      .reduce<Highlight | null>((acc, h) => {
        if (acc === null) return h;
        return (h.start_offset ?? 0) > (acc.start_offset ?? 0) ? h : acc;
      }, null);
    segments.push({ text, highlight: owner });
  }

  return segments;
}

interface HighlightedVerseTextProps {
  verseText: string;
  highlights: Highlight[];
  /** Color of the user's active "selected highlight" outline, if any. */
  activeHighlightId?: string | null;
  /** Called when the user taps a highlight segment. */
  onHighlightPress?: (highlight: Highlight) => void;
  /** Inline style applied to every text segment. */
  textStyle?: object;
}

export function HighlightedVerseText({
  verseText,
  highlights,
  activeHighlightId,
  onHighlightPress,
  textStyle,
}: HighlightedVerseTextProps): ReactNode {
  const segments = splitVerseByHighlights(verseText, highlights);

  return (
    <Text selectable style={textStyle}>
      {segments.map((seg, i) => {
        if (!seg.highlight) {
          return <Text key={i}>{seg.text}</Text>;
        }
        const h = seg.highlight;
        const isActive = activeHighlightId === h.id;
        return (
          <Text
            key={i}
            onPress={onHighlightPress ? () => onHighlightPress(h) : undefined}
            style={[
              styles.segment,
              { backgroundColor: withAlpha(h.color, 0.32) },
              isActive && {
                backgroundColor: withAlpha(h.color, 0.5),
              },
            ]}
          >
            {seg.text}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  segment: {
    // Background color is set per-highlight via withAlpha
  },
});

// Re-export the no-color background token to keep callers tidy
export { colors };
