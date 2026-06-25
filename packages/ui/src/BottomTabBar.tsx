/**
 * BottomTabBar — persistent bottom navigation for mobile.
 *
 * URL-aware: derives `activeTab` from the current pathname and navigates
 * with `useRouter().push()`. Designed to be mounted once at the layout
 * level so every authenticated page inherits the bar.
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

import { useEffect, useState, type ReactNode } from 'react';
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

/** Mobile-only check via matchMedia. SSR-safe: defaults to false, updates on mount. */
function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    // Older Safari uses addListener; modern uses addEventListener.
    if (mql.addEventListener) mql.addEventListener('change', update);
    else mql.addListener(update);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', update);
      else mql.removeListener(update);
    };
  }, [breakpoint]);
  return isMobile;
}

export function BottomTabBar({ activeTab: activeOverride, onSelect }: BottomTabBarProps = {}): ReactNode {
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const active = activeOverride ?? tabFromPath(pathname);

  if (!isMobile) return null;

  const handle = (tab: TabId, href: string) => {
    if (onSelect) onSelect(tab);
    router.push(href);
  };

  return (
    <View style={styles.container}>
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
