'use client';

import { StyleSheet, Text, View, Pressable } from 'react-native-web';
import { type ReactNode } from 'react';

export default function Error({ reset }: { error: Error; reset: () => void }): ReactNode {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.text}>An unexpected error occurred. Your data is safe.</Text>
        <Pressable onPress={reset} style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: '100vh', backgroundColor: '#faf9f6', justifyContent: 'center', alignItems: 'center' },
  content: { padding: 32, gap: 12, alignItems: 'center' },
  title: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 24, fontWeight: '600', color: '#3a3530' },
  text: { fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#9a9388', textAlign: 'center', lineHeight: 20 },
  button: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 20, backgroundColor: '#8b7355', borderRadius: 8, cursor: 'pointer' },
  buttonText: { fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: '600', color: '#ffffff' },
});
