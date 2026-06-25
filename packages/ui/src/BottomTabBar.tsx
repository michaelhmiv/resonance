/**
 * BottomTabBar — persistent bottom navigation for mobile.
 *
 * Shows Journal · Word · Patterns tabs at thumb level.
 * Only visible on mobile viewports (max-width: 768px).
 * On desktop, tabs remain in the header.
 */

'use client';

import { type ReactNode } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { colors, fontFamilies, spacing, radii } from '@resonance/theme';

export type TabId = 'journal' | 'word' | 'patterns';

interface BottomTabBarProps {
  activeTab: TabId;
  onSelect: (tab: TabId) => void;
}

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'journal', label: 'Journal', icon: '✍' },
  { id: 'word', label: 'Word', icon: '📖' },
  { id: 'patterns', label: 'Patterns', icon: '◈' },
];

export function BottomTabBar({ activeTab, onSelect }: BottomTabBarProps): ReactNode {
  return (
    <View style={styles.container} className="bottom-tab-bar">
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onSelect(tab.id)}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Text style={[styles.icon, active && styles.iconActive]}>
              {tab.icon}
            </Text>
            <Text style={[styles.label, active && styles.labelActive]}>
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
    zIndex: 200,
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
