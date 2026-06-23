/**
 * Resonance typography.
 *
 * Serif-forward reading experience: serif (Cormorant Garamond) for body text,
 * Scripture, and voice quotes; sans-serif (Inter) only for UI chrome — tabs,
 * buttons, metadata labels. Scripture and saint quotes render in serif italic.
 *
 * See design spec §2.2.
 *
 * Font families are loaded centrally in `App.tsx` via `@expo-google-fonts`
 * (mobile) or via Google Fonts `<link>` in layout.tsx (web).
 * These tokens reference the family names so styles stay declarative.
 */

/** TextStyle — plain object type, works on both react-native and react-native-web. */
type TextStyle = Record<string, any>;

export const fontFamilies = {
  serif: 'CormorantGaramond_400Regular',
  serifMedium: 'CormorantGaramond_500Medium',
  serifSemibold: 'CormorantGaramond_600SemiBold',
  serifItalic: 'CormorantGaramond_400Regular_Italic',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemibold: 'Inter_600SemiBold',
} as const;

export type FontFamily = keyof typeof fontFamilies;

/** Serif body/quote text. */
export const serifText: TextStyle = {
  fontFamily: fontFamilies.serif,
  fontSize: 18,
  lineHeight: 28,
  color: undefined, // set by caller via theme text color
};

/** Scripture and saint quotes — serif italic to mark quoted, living text. */
export const serifQuote: TextStyle = {
  fontFamily: fontFamilies.serifItalic,
  fontSize: 19,
  lineHeight: 30,
  color: undefined,
};

/** Sans-serif UI chrome (tabs, buttons, metadata labels). */
export const sansText: TextStyle = {
  fontFamily: fontFamilies.sans,
  fontSize: 15,
  lineHeight: 22,
  color: undefined,
};

/** Small metadata / source line. */
export const metadataText: TextStyle = {
  fontFamily: fontFamilies.sans,
  fontSize: 12,
  lineHeight: 18,
  letterSpacing: 0.3,
  color: undefined,
};

/** Screen title in the header. */
export const headerTitle: TextStyle = {
  fontFamily: fontFamilies.serifSemibold,
  fontSize: 22,
  letterSpacing: 0.4,
  color: undefined,
};
