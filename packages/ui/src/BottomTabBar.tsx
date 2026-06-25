/**
 * BottomTabBar — persistent bottom navigation for mobile.
 *
 * URL-aware: derives `activeTab` from the current pathname and navigates
 * with `useRouter().push()`. Designed to be mounted once at the layout
 * level so every authenticated page inherits the bar.
 *
 * Only visible on mobile viewports (max-width: 768px) via the
 * `bottom-tab-bar` CSS class in globals.css.
 *
 * Tap targets are 48px (slightly above Apple HIG 44px) to give thumb
 * reach comfortable margins.
 */

'use client';

import { type ReactNode } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { usePathname, useRouter } from 'next/navigation';
import { colors, fontFamilies, spacing, radii } from '@resonance/theme';

export type TabId = 'journal' | 'word' | 'patterns';

interface BottomTabBarProps {
  /** Optional override for the active tab. If omitted, derived from URL. */
  activeTab?: TabId;
  /** Optional override for the tab-change handler. */
  onSelect?: (tab: TabId) => void;
}

const TABS: { id: TabId; label: string; icon: string; href: string }[] = [
  { id: 'journal', label: 'Journal', icon: '✍', href: '/journal' },
  { id: 'word', label: 'Word', icon: '📖', href: '/word' },
  { id: 'patterns', label: 'Patterns', icon: '◈', href: '/patterns' },
];

/** Map a pathname prefix to the active tab. /word (incl. /word?...) → word. */
function tabFromPath(pathname: string | null): TabId {
  if (!pathname) return 'journal';
  if (pathname.startsWith('/patterns')) return 'patterns';
  if (pathname.startsWith('/word')) return 'word';
  return 'journal';
}

export function BottomTabBar({ activeTab: activeOverride, onSelect }: BottomTabBarProps = {}): ReactNode {
  const router = useRouter();
  const pathname = usePathname();
  const active = activeOverride ?? tabFromPath(pathname);

  const handle = (tab: TabId, href: string) => {
    if (onSelect) onSelect(tab);
    // Same route: still push to force a fresh state (matches the
    // old in-app behavior where tapping the active tab reset scroll).
    router.push(href);
  };

  return (
    <View style={styles.container} className="bottom-tab-bar">
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <Pressable
            key={tab.id}
            onPress={() => handle(tab.id, tab.href)}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: isActive }}
            style={({ pressed }) => [styles.tab, isActive && styles.tabActive, pressed && styles.pressed]}
          >
            <Text style={[styles.icon, isActive && styles.iconActive]}>
              {tab.icon}
            </Text>
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    display: 'none', // hidden by default — shown via media query CSS
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
  pressed: {
    opacity: 0.6,
  },
  icon: {
    fontSize: 18,
    marginBottom: 2,
    opacity: 0.5,
  },
  iconActive: {
    opacity: 1,
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
