/**
 * Resonance color system.
 *
 * The palette is restrained and warm: a cream paper background, soft white
 * cards with hairline borders (no drop shadows), a single restrained-brown
 * accent for active states, and a small curated highlight palette used only
 * for text highlights in the Word tab.
 *
 * See design spec §2.1.
 */

export const colors = {
  /** Background — warm cream paper. Every app surface sits on this. */
  background: '#faf9f6',

  /** Card surface — softer white tile. */
  surface: '#ffffff',

  /** Hairline card border. No drop shadows anywhere. */
  border: '#e8e5e0',

  /** Primary accent — restrained brown. Active states, links, tab indicator. */
  accent: '#8b7355',

  /** Muted accent for secondary chrome. */
  accentMuted: '#a89880',

  /** Text on cream. */
  textPrimary: '#3a3530',
  textSecondary: '#7a7368',
  textTertiary: '#9a9388',

  /** Placeholder text. */
  placeholder: '#b8b0a4',

  // ── Highlight palette (Word tab only) ──────────────────────────────
  /** Warm gold. */
  highlightGold: '#d4a574',
  /** Soft sage. */
  highlightSage: '#a8b89e',
  /** Muted rose. */
  highlightRose: '#c9a0a0',
  /** Cool slate blue — pairs with the warm triad for category color. */
  highlightSlate: '#7a8db0',

  /** Footnote / resonance mark — quiet gold. */
  resonance: '#c9a25a',
} as const;

export type ColorToken = keyof typeof colors;

/** The curated text-highlight set, in display order. */
export const highlightPalette = [
  colors.highlightGold,
  colors.highlightSage,
  colors.highlightRose,
  colors.highlightSlate,
] as const;

export type HighlightColor = (typeof highlightPalette)[number];

/**
 * Convert a hex color (#rrggbb) to an rgba() string with the given alpha.
 * Used for highlight backgrounds — the base color is too saturated as a
 * full fill, so we render it at ~28% opacity against the cream paper.
 */
export function withAlpha(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
