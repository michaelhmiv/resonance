/**
 * Root layout — loads fonts, sets up react-native-web providers,
 * and establishes the app-wide styling.
 */

import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native-web';
import { VectorStatusBanner } from '../components/VectorStatusBanner';
import './globals.css';

export const metadata = {
  title: 'Resonance — A private spiritual journal',
  description: 'A warm, reverent space for journaling, reading Scripture, and noticing patterns over time.',
  openGraph: {
    title: 'Resonance',
    description: 'A private, offline-first Christian spiritual journal.',
    type: 'website',
  },
  themeColor: '#faf9f6',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <VectorStatusBanner />
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
