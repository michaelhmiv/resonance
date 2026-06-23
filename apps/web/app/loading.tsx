import { StyleSheet, Text, View, Pressable } from 'react-native-web';
import { type ReactNode } from 'react';

export default function Loading(): ReactNode {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Loading…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: '60vh', justifyContent: 'center', alignItems: 'center', backgroundColor: '#faf9f6' },
  text: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 16, fontStyle: 'italic', color: '#9a9388' },
});
