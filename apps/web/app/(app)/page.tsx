/**
 * Main (journal) landing page — the default authenticated route.
 *
 * Navigation is handled by the persistent BottomTabBar from the (app)
 * layout's MobileChrome. This page just renders the journal content.
 */

'use client';

import { type ReactNode } from 'react';
import { View } from 'react-native-web';
import JournalPage from './journal/page';

export default function HomePage(): ReactNode {
  return (
    <View style={{ flex: 1 }}>
      <JournalPage />
    </View>
  );
}
