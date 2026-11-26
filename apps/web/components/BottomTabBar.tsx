/**
 * BottomTabBar — persistent bottom navigation for web.
 *
 * Uses native Next.js <Link> navigation directly (no manual e.preventDefault()
 * + startViewTransition interception that could drop/stall tab switches),
 * plain CSSProperties on DOM <a> elements (never RNW StyleSheet.create objects),
 * and a fixed 60px height shared with MobileChrome & ReadingView so the
 * action bar docks flush above the nav bar with zero gap.
 */

'use client';

import { type CSSProperties, type ReactNode } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { colors, fontFamilies, spacing, radii } from '@resonance/theme';
import { SearchIcon, LibraryIcon, WindIcon } from '@resonance/ui';

export const BOTTOM_TAB_BAR_HEIGHT = 60;

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

const LINK_STYLE: CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textDecoration: 'none',
  height: '100%',
};

/** Map a pathname prefix to the active tab. /word (incl. /word?...) → word. */
function tabFromPath(pathname: string | null): TabId {
  if (!pathname) return 'journal';
  if (pathname.startsWith('/patterns')) return 'patterns';
  if (pathname.startsWith('/word')) return 'word';
  return 'journal';
}

export function BottomTabBar({ activeTab: activeOverride, onSelect }: BottomTabBarProps = {}): ReactNode {
  const pathname = usePathname();
  const active = activeOverride ?? tabFromPath(pathname);

  const handlePress = (tabId: TabId) => {
    if (onSelect) onSelect(tabId);
    // Tapping the already-active Word tab returns from ReadingView/Search to browse.
    if (tabId === 'word' && active === 'word' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('resonance:word-reset'));
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
            style={LINK_STYLE}
            onClick={() => handlePress(tab.id)}
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
    height: BOTTOM_TAB_BAR_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    position: 'fixed' as any,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 250,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    minHeight: 48,
    gap: 2,
    borderRadius: radii.sm,
  },
  tabActive: {},
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
