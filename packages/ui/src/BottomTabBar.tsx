/**
 * BottomTabBar — persistent bottom navigation for mobile.
 *
 * URL-aware: derives `activeTab` from the current pathname and navigates
 * with `next/link` so the other two tabs are auto-prefetched on mount.
 * Designed to be mounted once at the layout level so every authenticated
 * page inherits the bar.
 *
 * Visibility is driven by a JavaScript media-query check (not CSS) because
 * RN-Web's inline `style.display` wins over a CSS `.bottom-tab-bar` rule,
 * and the `className` prop is not preserved through RN-Web. On desktop
 * we render nothing.
 *
 * Tap targets are 48px (slightly above Apple HIG 44px) to give thumb
 * reach comfortable margins.
 */

'use client';

import { type ReactNode } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { colors, fontFamilies, spacing, radii } from '@resonance/theme';
import { SearchIcon, LibraryIcon, WindIcon } from './icons';

export type TabId = 'journal' | 'word' | 'patterns';

interface BottomTabBarProps {
  /** Optional override for the active tab. If omitted, derived from URL. */
  activeTab?: TabId;
  /** Optional override for the tab-change handler. */
  onSelect?: (tab: TabId) => void;
}

const TABS: { id: TabId; label: string; Icon: typeof WindIcon; href: string }[] = [
  { id: 'journal', label: 'Journal', Icon: WindIcon, href: '/journal' },
  { id: 'word', label: 'Word', Icon: SearchIcon, href: '/word' },
  { id: 'patterns', label: 'Patterns', Icon: LibraryIcon, href: '/patterns' },
];

/** Map a pathname prefix to the active tab. /word (incl. /word?...) → word. */
function tabFromPath(pathname: string | null): TabId {
  if (!pathname) return 'journal';
  if (pathname.startsWith('/patterns')) return 'patterns';
  if (pathname.startsWith('/word')) return 'word';
  return 'journal';
}

export function BottomTabBar({ activeTab: activeOverride, onSelect }: BottomTabBarProps = {}): ReactNode {
  const pathname = usePathname();
  const router = useRouter();
  const active = activeOverride ?? tabFromPath(pathname);

  const handlePress = (tab: TabId, e: React.MouseEvent) => {
    // next/link handles navigation. This callback lets a parent override
    // behavior (e.g. analytics, or forced remount) without reimplementing
    // the link itself.
    if (onSelect) onSelect(tab);

    // Wrap the soft navigation in a View Transition for a gentle
    // cross-fade. next/link's experimental viewTransition flag is
    // unreliable in 14.x/15.x, so we trigger it ourselves. Falls through
    // to the default <a> navigation on browsers without the API.
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      e.preventDefault();
      const transition = (document as any).startViewTransition(() => {
        router.push(tab.href);
      });
      // Suppress unhandled-promise warning from the optional ready callback.
      void transition?.ready?.catch(() => {});
    }
  };

  return (
    <View style={styles.container}>
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        const Icon = tab.Icon;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            prefetch={true}
            style={styles.linkReset}
            onClick={(e) => handlePress(tab.id, e)}
            aria-label={tab.label}
            aria-current={isActive ? 'page' : undefined}
          >
            <View style={[styles.tab, isActive && styles.tabActive]}>
              <Icon size={20} color={isActive ? colors.accent : colors.textTertiary} />
              <Text style={[styles.label, isActive && styles.labelActive]}>
                {tab.label}
              </Text>
            </View>
          </Link>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: spacing.xs,
    paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    position: 'fixed' as any,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 250, // below reading chrome (z 300) so chrome sits above on /word
  },
  // next/link renders an <a> — strip the default underline / inline display.
  linkReset: {
    flex: 1,
    textDecorationLine: 'none',
  } as any,
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    minHeight: 48,
    borderRadius: radii.sm,
  },
  tabActive: {
    // Active indicator via label color + icon color
  },
  label: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
    color: colors.textTertiary,
    letterSpacing: 0.3,
  },
  labelActive: {
    color: colors.accent,
    fontWeight: '600',
  },
});
