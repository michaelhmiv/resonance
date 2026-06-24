/**
 * Journal screen — the primary writing surface (shared, DataLayer-driven).
 *
 * Renders past entries, verse of the day, resonance cards, and a
 * reflection prompt. All data flows through the DataLayer contract —
 * no platform-specific imports.
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useDataLayer } from '@resonance/core/data-layer-context';
import type { JournalSegment, ResonanceResult } from '@resonance/core';

interface VerseOfDay {
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  text: string;
  ref: string;
}

interface JournalScreenProps {
  /** Callback to fetch verse of the day (platform-specific: web hits /api, mobile hits local DB) */
  fetchVerseOfDay?: () => Promise<VerseOfDay | null>;
}

export function JournalScreen({ fetchVerseOfDay }: JournalScreenProps): ReactNode {
  const dataLayer = useDataLayer();
  const [segments, setSegments] = useState<JournalSegment[]>([]);
  const [verseOfDay, setVerseOfDay] = useState<VerseOfDay | null>(null);
  const [currentText, setCurrentText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resonance, setResonance] = useState<ResonanceResult | null>(null);
  const [findingResonance, setFindingResonance] = useState(false);
  const [reflection, setReflection] = useState<string | null>(null);
  const [reflecting, setReflecting] = useState(false);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  useEffect(() => {
    const load = async () => {
      try {
        const segs = await dataLayer.loadSegments();
        setSegments(segs);
        if (fetchVerseOfDay) {
          const vod = await fetchVerseOfDay();
          if (vod) setVerseOfDay(vod);
        }
      } catch (err) {
        console.error('[Journal] load failed:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [dataLayer, fetchVerseOfDay]);

  const handleSave = useCallback(async () => {
    if (currentText.trim().length === 0) return;
    setSaving(true);
    setResonance(null);
    setReflection(null);
    try {
      const now = Date.now();
      const segment: JournalSegment = {
        id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
        created_at: now,
        updated_at: now,
        segment_type: 'text',
        text: currentText.trim(),
        position_index: 0,
        parent_date: new Date(now).toISOString().slice(0, 10),
      };
      await dataLayer.saveSegment(segment);
      setSegments([segment, ...segments]);
      setCurrentText('');

      setFindingResonance(true);
      try {
        const data = await dataLayer.findResonance(segment.text!);
        setResonance(data);
      } catch { /* best-effort */ } finally {
        setFindingResonance(false);
      }
    } finally {
      setSaving(false);
    }
  }, [currentText, segments, dataLayer]);

  const handleDelete = useCallback(async (id: string) => {
    await dataLayer.deleteSegment(id);
    setSegments(segments.filter(s => s.id !== id));
  }, [segments, dataLayer]);

  const handleReflect = useCallback(async () => {
    if (segments.length === 0) return;
    setReflecting(true);
    setReflection(null);
    try {
      const excerpts = segments.filter(s => s.text).slice(0, 3).map(s => s.text!);
      const result = await dataLayer.generateReflectionPrompt(excerpts);
      if (result?.prompt) setReflection(result.prompt);
    } catch { /* best-effort */ } finally {
      setReflecting(false);
    }
  }, [segments, dataLayer]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#8b7355" size="small" />
      </View>
    );
  }

  const hasEntries = segments.length > 0;
  const textSegs = segments.filter(s => s.segment_type === 'text' && s.text);
  const result = resonance;
  const scripture = result?.scripture ?? [];
  const voices = result?.voices ?? [];

  return (
    <View style={styles.container}>
      {/* Date divider */}
      <View style={styles.dateDivider}>
        <View style={styles.dateLine} />
        <Text style={styles.dateText}>{today}</Text>
        <View style={styles.dateLine} />
      </View>

      {/* Verse of the day */}
      {verseOfDay && (
        <View style={styles.verseCard}>
          <Text style={styles.verseCardText}>"{verseOfDay.text}"</Text>
          <Text style={styles.verseRef}>{verseOfDay.ref}</Text>
        </View>
      )}

      {/* Past entries */}
      {textSegs.map((seg) => (
        <View key={seg.id} style={styles.entryBlock}>
          <Text style={styles.entryText}>{seg.text}</Text>
          <Pressable onPress={() => handleDelete(seg.id)} style={styles.deleteBtn}>
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        </View>
      ))}

      {/* Resonance */}
      {findingResonance && (
        <View style={styles.resonanceHint}>
          <ActivityIndicator size="small" color="#8b7355" />
          <Text style={styles.resonanceText}>Finding resonance…</Text>
        </View>
      )}
      {(scripture.length > 0 || voices.length > 0) && (
        <View style={styles.resonanceSection}>
          <Text style={styles.resonanceLabel}>Resonance</Text>
          {scripture.map((card, i) => (
            <View key={`s-${i}`} style={styles.resonanceCard}>
              <Text style={styles.resonanceQuote}>"{card.text}"</Text>
              <Text style={styles.resonanceSource}>{card.source}</Text>
            </View>
          ))}
          {voices.map((card, i) => (
            <View key={`v-${i}`} style={styles.resonanceCard}>
              <Text style={styles.resonanceQuote}>"{card.text}"</Text>
              <Text style={styles.resonanceSource}>{card.source}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Reflection */}
      {hasEntries && (
        <Pressable onPress={handleReflect} style={styles.reflectButton} disabled={reflecting}>
          <Text style={styles.reflectText}>
            {reflecting ? 'Reflecting…' : reflection ? 'Reflect again' : 'Reflect'}
          </Text>
        </Pressable>
      )}
      {reflection && (
        <View style={styles.reflectionCard}>
          <Text style={styles.reflectionText}>{reflection}</Text>
        </View>
      )}

      {/* Editor */}
      <TextInput
        style={styles.editor}
        value={currentText}
        onChangeText={setCurrentText}
        placeholder="Whatever is real…"
        placeholderTextColor="#b8b0a4"
        multiline
      />

      {currentText.trim().length > 0 && (
        <Pressable onPress={handleSave} style={styles.saveButton} disabled={saving}>
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save entry'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 16 },
  center: { justifyContent: 'center', alignItems: 'center' },
  dateDivider: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  dateLine: { flex: 1, height: 1, backgroundColor: '#e8e5e0' },
  dateText: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '500', color: '#9a9388', letterSpacing: 0.4 },
  verseCard: { borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 10, padding: 16, gap: 4 },
  verseCardText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 17, lineHeight: 26, color: '#3a3530' },
  verseRef: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9a9388', textAlign: 'right' },
  entryBlock: { paddingVertical: 8, gap: 4 },
  entryText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 18, lineHeight: 28, color: '#3a3530' },
  deleteBtn: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 8 },
  deleteText: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9a9388' },
  editor: {
    fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 18, lineHeight: 28, color: '#3a3530',
    borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 10,
    padding: 16, minHeight: 120,
  },
  saveButton: { alignSelf: 'flex-end', backgroundColor: '#8b7355', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  saveText: { fontFamily: 'Inter, sans-serif', fontWeight: '600', fontSize: 15, color: '#ffffff' },
  resonanceHint: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16 },
  resonanceText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 14, color: '#9a9388' },
  resonanceSection: { gap: 8, paddingVertical: 8 },
  resonanceLabel: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: '#c9a25a' },
  resonanceCard: { borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 8, padding: 14, gap: 4 },
  resonanceQuote: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 15, lineHeight: 22, color: '#3a3530' },
  resonanceSource: { fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#9a9388' },
  reflectButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: '#e8e5e0', borderRadius: 8, backgroundColor: '#ffffff' },
  reflectText: { fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: '500', color: '#8b7355' },
  reflectionCard: { borderWidth: 1, borderColor: '#e8e5e0', borderStyle: 'dashed', borderRadius: 10, padding: 16 },
  reflectionText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 17, lineHeight: 26, color: '#3a3530' },
});
