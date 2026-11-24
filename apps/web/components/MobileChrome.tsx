/**
 * MobileChrome — wraps authenticated page content with a persistent
 * mobile bottom tab bar.
 *
 * On desktop, this component renders children only (the tab bar is hidden
 * by the bottom-tab-bar media query). On mobile, it adds bottom padding
 * to the content so it clears the fixed tab bar, and mounts the bar.
 *
 * The reading-view's bottom chrome has z-index 300, this bar is z 250,
 * so the reading chrome sits above the tab bar on /word routes.
 */

'use client';

import { type ReactNode } from 'react';
import { View } from 'react-native-web';
import { BottomTabBar } from './BottomTabBar';

const MOBILE_BAR_RESERVE = 60; // matches .bottom-tab-bar height in globals.css

export function MobileChrome({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        // Reserve space for the fixed tab bar on mobile.
        // The bar uses position:fixed; the viewport already excludes it,
        // so this padding is a no-op on desktop and a content spacer on
        // mobile (so the bottom of long pages isn't covered).
        paddingBottom: MOBILE_BAR_RESERVE,
      }}
    >
      {children}
      <BottomTabBar />
    </View>
  );
}
