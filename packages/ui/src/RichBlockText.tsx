/**
 * RichBlockText — high-performance native `<Text>` renderer for Reader v2.
 *
 * Layers four independent span channels onto a single text string with zero
 * WebView overhead (works identically on iOS, Android Fabric, and Web):
 *   1. Document inline formatting spans (italic, bold, sup, tappable scripture_ref)
 *   2. Multi-span phrase highlights (fill tint or underline, W3C re-anchored)
 *   3. Active phrase selection preview (word/sentence selection handles)
 *   4. In-book search match highlights (amber / active gold)
 */

import { memo, useMemo, type ReactNode } from 'react';
import { Text } from 'react-native';
import {
  fontFamilies,
  withAlpha,
  type ReaderThemePalette,
} from '@resonance/theme';
import {
  resolveHighlightOffsets,
  type Highlight,
  type InlineSpan,
  type TextRange,
} from '@resonance/core';

export interface RichBlockTextProps {
  text: string;
  spans?: InlineSpan[];
  highlights?: Highlight[];
  activeSelection?: TextRange | null;
  searchQuery?: string;
  isActiveSearchHit?: boolean;
  theme: ReaderThemePalette;
  baseTextStyle: object;
  onPressHighlight?: (highlight: Highlight) => void;
  onPressScriptureRef?: (ref: string) => void;
  /** Optional leading inline element (e.g. superscript verse number in Flow mode). */
  leadingInline?: ReactNode;
}

interface ResolvedHighlightSpan {
  start: number;
  end: number;
  highlight: Highlight;
}

interface FlatSegment {
  start: number;
  end: number;
  text: string;
  inlineSpan: InlineSpan | null;
  highlight: Highlight | null;
  isSelected: boolean;
  isSearchMatch: boolean;
  endsAnnotatedHighlight: Highlight | null;
}

function findSearchRanges(text: string, query?: string): TextRange[] {
  if (!query || query.trim().length < 2) return [];
  const q = query.trim().toLowerCase();
  const lower = text.toLowerCase();
  const ranges: TextRange[] = [];
  let idx = 0;
  while ((idx = lower.indexOf(q, idx)) >= 0) {
    ranges.push({ start: idx, end: idx + q.length });
    idx += q.length;
    if (ranges.length >= 24) break;
  }
  if (ranges.length === 0) {
    // Highlight individual terms if multi-word non-contiguous match
    const terms = q.split(/\s+/).filter((t) => t.length >= 2);
    if (terms.length > 1) {
      for (const term of terms) {
        let pos = 0;
        while ((pos = lower.indexOf(term, pos)) >= 0) {
          ranges.push({ start: pos, end: pos + term.length });
          pos += term.length;
          if (ranges.length >= 32) break;
        }
      }
    }
  }
  return ranges;
}

export const RichBlockText = memo(function RichBlockText({
  text,
  spans,
  highlights,
  activeSelection,
  searchQuery,
  isActiveSearchHit = false,
  theme,
  baseTextStyle,
  onPressHighlight,
  onPressScriptureRef,
  leadingInline,
}: RichBlockTextProps): ReactNode {
  const segments = useMemo<FlatSegment[]>(() => {
    const len = text.length;
    if (len === 0) return [];

    const resolvedHls: ResolvedHighlightSpan[] = [];
    if (highlights && highlights.length > 0) {
      for (const h of highlights) {
        const range = resolveHighlightOffsets(text, h);
        if (range && range.start < range.end) {
          resolvedHls.push({ start: range.start, end: range.end, highlight: h });
        }
      }
    }

    const searchRanges = findSearchRanges(text, searchQuery);
    const hasSpans = Boolean(spans && spans.length > 0);
    const hasSel = Boolean(activeSelection && activeSelection.start < activeSelection.end);

    // Fast path: plain text with no highlights, spans, selection, or search query
    if (!hasSpans && resolvedHls.length === 0 && !hasSel && searchRanges.length === 0) {
      return [
        {
          start: 0,
          end: len,
          text,
          inlineSpan: null,
          highlight: null,
          isSelected: false,
          isSearchMatch: false,
          endsAnnotatedHighlight: null,
        },
      ];
    }

    const cuts = new Set<number>([0, len]);
    if (spans) {
      for (const s of spans) {
        cuts.add(Math.max(0, Math.min(s.start, len)));
        cuts.add(Math.max(0, Math.min(s.end, len)));
      }
    }
    for (const h of resolvedHls) {
      cuts.add(Math.max(0, Math.min(h.start, len)));
      cuts.add(Math.max(0, Math.min(h.end, len)));
    }
    if (hasSel && activeSelection) {
      cuts.add(Math.max(0, Math.min(activeSelection.start, len)));
      cuts.add(Math.max(0, Math.min(activeSelection.end, len)));
    }
    for (const sr of searchRanges) {
      cuts.add(Math.max(0, Math.min(sr.start, len)));
      cuts.add(Math.max(0, Math.min(sr.end, len)));
    }

    const sorted = Array.from(cuts).sort((a, b) => a - b);
    const out: FlatSegment[] = [];

    for (let i = 0; i < sorted.length - 1; i++) {
      const start = sorted[i];
      const end = sorted[i + 1];
      if (start >= end) continue;

      const inlineSpan =
        spans?.find((s) => s.start <= start && s.end >= end) ?? null;

      // Later highlight wins on overlap
      let hlOwner: Highlight | null = null;
      let endsNoteHl: Highlight | null = null;
      for (const rh of resolvedHls) {
        if (rh.start <= start && rh.end >= end) {
          hlOwner = rh.highlight;
          if (
            rh.end === end &&
            rh.highlight.note_text &&
            rh.highlight.note_text.trim().length > 0
          ) {
            endsNoteHl = rh.highlight;
          }
        }
      }

      const isSelected = Boolean(
        hasSel &&
          activeSelection &&
          activeSelection.start <= start &&
          activeSelection.end >= end
      );

      const isSearchMatch = searchRanges.some(
        (sr) => sr.start <= start && sr.end >= end
      );

      out.push({
        start,
        end,
        text: text.slice(start, end),
        inlineSpan,
        highlight: hlOwner,
        isSelected,
        isSearchMatch,
        endsAnnotatedHighlight: endsNoteHl,
      });
    }
    return out;
  }, [text, spans, highlights, activeSelection, searchQuery]);

  return (
    <Text style={baseTextStyle}>
      {leadingInline}
      {segments.map((seg, i) => {
        const inlineStyles: object[] = [];

        if (seg.inlineSpan) {
          switch (seg.inlineSpan.kind) {
            case 'italic':
              inlineStyles.push({
                fontFamily: fontFamilies.serifItalic,
                fontStyle: 'italic',
              });
              break;
            case 'bold':
              inlineStyles.push({
                fontFamily: fontFamilies.serifSemibold,
                fontWeight: '600',
              });
              break;
            case 'boldItalic':
              inlineStyles.push({
                fontFamily: fontFamilies.serifSemibold,
                fontStyle: 'italic',
                fontWeight: '600',
              });
              break;
            case 'scripture_ref':
              inlineStyles.push({
                color: theme.accent,
                textDecorationLine: 'underline',
              });
              break;
            case 'sup':
            case 'footnote_ref':
              inlineStyles.push({
                fontSize: 11,
                color: theme.accent,
              });
              break;
            default:
              break;
          }
        }

        if (seg.highlight) {
          if (seg.highlight.style === 'underline') {
            inlineStyles.push({
              textDecorationLine: 'underline',
              textDecorationColor: seg.highlight.color,
              backgroundColor: withAlpha(seg.highlight.color, 0.10),
            });
          } else {
            inlineStyles.push({
              backgroundColor: withAlpha(seg.highlight.color, theme.highlightAlpha),
            });
          }
        }

        if (seg.isSelected) {
          inlineStyles.push({
            backgroundColor: theme.selectionBg,
          });
        }

        if (seg.isSearchMatch) {
          inlineStyles.push({
            backgroundColor: isActiveSearchHit
              ? theme.searchMatchActiveBg
              : theme.searchMatchBg,
          });
        }

        const handlePress =
          seg.inlineSpan?.kind === 'scripture_ref' && seg.inlineSpan.target && onPressScriptureRef
            ? () => onPressScriptureRef(seg.inlineSpan!.target!)
            : seg.highlight && onPressHighlight
              ? () => onPressHighlight(seg.highlight!)
              : undefined;

        return (
          <Text key={`${seg.start}-${i}`} style={inlineStyles} onPress={handlePress}>
            {seg.text}
            {seg.endsAnnotatedHighlight ? (
              <Text
                style={{
                  fontFamily: fontFamilies.sansMedium,
                  fontSize: 11,
                  color: theme.accent,
                }}
              >
                {' ✎'}
              </Text>
            ) : null}
          </Text>
        );
      })}
    </Text>
  );
});
