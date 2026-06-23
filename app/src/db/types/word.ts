/**
 * Shared Word-tab type tokens.
 *
 * Kept central so screens, query modules, and components agree on the small
 * set of discriminating strings used across the reading surface.
 */

/** Supported Bible translations — WEB is the default (design spec §6). */
export type Translation = 'WEB' | 'KJV';
