/**
 * Journal page — the primary writing surface (web version).
 *
 * Currently uses a mock data layer. When Supabase is wired in,
 * this swaps to the real implementation behind the same DataLayer interface.
 */

'use client';

import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View, Pressable, KeyboardAvoidingView } from 'react-native-web';

const SAMPLE_VERSES = [
  { ref: 'Psalm 46:10', text: 'Be still, and know that I am God.' },
  { ref: 'Matthew 11:28', text: 'Come to me, all you who are weary and burdened, and I will give you rest.' },
];

export default function JournalPage(): ReactNode {
  const [entries, setEntries] = useState<{ date: string; text: string }[]>([]);
  const [currentText, setCurrentText] = useState('');

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const handleSave = () => {
    if (currentText.trim().length === 0) return;
    setEntries([...entries, { date: today, text: currentText.trim() }]);
    setCurrentText('');
  };

  return (
    <View style={styles.container}>
      {/* ── Date divider ─────────────────────────────────────── */}
      <View style={styles.dateDivider}>
        <View style={styles.dateLine} />
        <Text style={styles.dateText}>{today}</Text>
        <View style={styles.dateLine} />
      </View>

      {/* ── Verse of the day ──────────────────────────────────── */}
      <View style={styles.verseCard}>
        <Text style={styles.verseText}>"{SAMPLE_VERSES[0].text}"</Text>
        <Text style={styles.verseRef}>{SAMPLE_VERSES[0].ref}</Text>
      </View>

      {/* ── Past entries ─────────────────────────────────────── */}
      {entries.map((entry, i) => (
        <View key={i} style={styles.entryBlock}>
          <Text style={styles.entryText}>{entry.text}</Text>
        </View>
      ))}

      {/* ── Editor ───────────────────────────────────────────── */}
      <TextInput
        style={styles.editor}
        value={currentText}
        onChangeText={setCurrentText}
        placeholder="Whatever is real…"
        placeholderTextColor="#b8b0a4"
        multiline
        autoFocus
      />

      {currentText.trim().length > 0 && (
        <Pressable onPress={handleSave} style={styles.saveButton}>
          <Text style={styles.saveText}>Save entry</Text>
        </Pressable>
      )}

      {/* ── Resonance placeholder ─────────────────────────────── */}
      {entries.length > 0 && (
        <View style={styles.resonanceHint}>
          <Text style={styles.resonanceText}>
            Resonance will surface here as you write. (Connects to models when premium is active.)
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 16,
  },
  dateDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  dateLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e8e5e0',
  },
  dateText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 12,
    fontWeight: '500',
    color: '#9a9388',
    letterSpacing: 0.4,
  },
  verseCard: {
    borderWidth: 1,
    borderColor: '#e8e5e0',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 16,
    gap: 4,
  },
  verseText: {
    fontFamily: 'Georgia, serif',
    fontStyle: 'italic',
    fontSize: 16,
    lineHeight: 24,
    color: '#3a3530',
  },
  verseRef: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 12,
    color: '#9a9388',
    textAlign: 'right',
  },
  entryBlock: {
    paddingVertical: 8,
  },
  entryText: {
    fontFamily: 'Georgia, serif',
    fontSize: 18,
    lineHeight: 28,
    color: '#3a3530',
  },
  editor: {
    fontFamily: 'Georgia, serif',
    fontSize: 18,
    lineHeight: 28,
    color: '#3a3530',
    borderWidth: 1,
    borderColor: '#e8e5e0',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 16,
    minHeight: 120,
    outlineStyle: 'none',
  },
  saveButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#8b7355',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  saveText: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: '600',
    fontSize: 15,
    color: '#ffffff',
  },
  resonanceHint: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#e8e5e0',
    borderStyle: 'dashed',
    borderRadius: 10,
  },
  resonanceText: {
    fontFamily: 'Georgia, serif',
    fontStyle: 'italic',
    fontSize: 14,
    lineHeight: 22,
    color: '#9a9388',
  },
});
