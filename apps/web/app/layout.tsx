/**
 * Root layout — loads fonts, sets up react-native-web providers,
 * and establishes the app-wide styling.
 */

import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native-web';
import './globals.css';

export const metadata = {
  title: 'Resonance',
  description: 'A private, offline-first Christian spiritual journal.',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body>
        <View style={styles.root}>{children}</View>
      </body>
    </html>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: '100vh',
    backgroundColor: '#faf9f6',
  },
});
