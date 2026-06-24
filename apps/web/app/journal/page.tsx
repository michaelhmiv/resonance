/**
 * Journal page — the primary writing surface (web version).
 *
 * All data access goes through the DataLayer contract — no direct API
 * calls. Persists via saveSegment, loads via loadSegments, reflects via
 * generateReflectionPrompt, resonance via findResonance.
 */

'use client';

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View, Pressable, ActivityIndicator } from 'react-native-web';
import { DataLayerProvider, useDataLayer } from '@resonance/core/data-layer-context';
import type { JournalSegment, ResonanceCard } from '@resonance/core';
import { WebDataLayer } from '../../lib/client-data-layer';

interface VerseOfDay {
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  text: string;
  ref: string;
}

function JournalInner(): ReactNode {
  const dataLayer = useDataLayer();
  const [segments, setSegments] = useState<JournalSegment[]>([]);
  const [verseOfDay, setVerseOfDay] = useState<VerseOfDay | null>(null);
  const [currentText, setCurrentText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resonance, setResonance] = useState<{ scripture: ResonanceCard[]; voices: ResonanceCard[] } | null>(null);
  const [findingResonance, setFindingResonance] = useState(false);
  const [reflection, setReflection] = useState<string | null>(null);
  const [reflecting, setReflecting] = useState(false);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  useEffect(() => {
    Promise.all([
      dataLayer.loadSegments(),
      fetch('/api/bible/verse-of-day').then(r => r.json()).catch(() => null),
    ]).then(([segs, vod]) => {
      setSegments(segs);
      if (vod) setVerseOfDay(vod);
      setLoading(false);
    });
  }, [dataLayer]);

  const handleSave = useCallback(async () => {
    if (currentText.trim().length === 0) return;
    setSaving(true);
    setResonance(null);
    setReflection(null);
    try {
      const now = Date.now();
      const segment: JournalSegment = {
        id: crypto.randomUUID?.() ?? `${now}-${Math.random().toString(36).slice(2, 10)}`,
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

      // Fire resonance via DataLayer (embeds text first for semantic search)
      setFindingResonance(true);
      try {
        const data = await dataLayer.findResonance(segment.text!);
        setResonance(data);
      } catch {
        // Resonance is best-effort
      } finally {
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
    } catch {
      // Best-effort
    } finally {
      setReflecting(false);
    }
  }, [segments, dataLayer]);

  if (loading) return <LoadingState />;

  const hasEntries = segments.length > 0;
  const textSegments = segments.filter(s => s.segment_type === 'text' && s.text);

  return (
    <View style={styles.container}>
      {/* ── Date divider ─────────────────────────────────────── */}
      <View style={styles.dateDivider}>
        <View style={styles.dateLine} />
        <Text style={styles.dateText}>{today}</Text>
        <View style={styles.dateLine} />
      </View>

      {/* ── Verse of the day ──────────────────────────────────── */}
      {verseOfDay && (
        <View style={styles.verseCard}>
          <Text style={styles.verseText}>"{verseOfDay.text}"</Text>
          <Text style={styles.verseRef}>{verseOfDay.ref}</Text>
        </View>
      )}

      {/* ── Past entries ─────────────────────────────────────── */}
      {textSegments.map((seg) => (
        <View key={seg.id} style={styles.entryBlock}>
          <Text style={styles.entryText}>{seg.text}</Text>
          <Pressable onPress={() => handleDelete(seg.id)} style={styles.deleteBtn}>
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        </View>
      ))}

      {/* ── Resonance cards ──────────────────────────────────── */}
      {findingResonance && (
        <View style={styles.resonanceHint}>
          <ActivityIndicator size="small" color="#8b7355" />
          <Text style={styles.resonanceText}>Finding resonance…</Text>
        </View>
      )}
      {resonance && (resonance.scripture.length > 0 || resonance.voices.length > 0) && (
        <View style={styles.resonanceSection}>
          <Text style={styles.resonanceLabel}>Resonance</Text>
          {resonance.scripture.map((card, i) => (
            <View key={`s-${i}`} style={styles.resonanceCard}>
              <Text style={styles.resonanceQuote}>"{card.text}"</Text>
              <Text style={styles.resonanceSource}>{card.source}</Text>
            </View>
          ))}
          {resonance.voices.map((card, i) => (
            <View key={`v-${i}`} style={styles.resonanceCard}>
              <Text style={styles.resonanceQuote}>"{card.text}"</Text>
              <Text style={styles.resonanceSource}>{card.source}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── Reflection prompt ─────────────────────────────────── */}
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

      {/* ── Editor ───────────────────────────────────────────── */}
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

export default function JournalPage(): ReactNode {
  const dataLayer = useMemo(() => new WebDataLayer(), []);
  return (
    <DataLayerProvider layer={dataLayer}>
      <JournalInner />
    </DataLayerProvider>
  );
}

function LoadingState(): ReactNode {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 }}>
      <Text style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 16, color: '#9a9388', fontStyle: 'italic' }}>
        Loading…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 16 },
  dateDivider: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  dateLine: { flex: 1, height: 1, backgroundColor: '#e8e5e0' },
  dateText: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '500', color: '#9a9388', letterSpacing: 0.4 },
  verseCard: { borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 10, padding: 16, gap: 4 },
  verseText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 17, lineHeight: 26, color: '#3a3530' },
  verseRef: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9a9388', textAlign: 'right' },
  entryBlock: { paddingVertical: 8, gap: 4 },
  entryText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 18, lineHeight: 28, color: '#3a3530' },
  deleteBtn: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 8, cursor: 'pointer' },
  deleteText: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9a9388' },
  editor: {
    fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 18, lineHeight: 28, color: '#3a3530',
    borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 10,
    padding: 16, minHeight: 120, outlineStyle: 'none',
  },
  saveButton: { alignSelf: 'flex-end', backgroundColor: '#8b7355', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, cursor: 'pointer' },
  saveText: { fontFamily: 'Inter, sans-serif', fontWeight: '600', fontSize: 15, color: '#ffffff' },
  resonanceHint: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16 },
  resonanceText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 14, color: '#9a9388' },
  resonanceSection: { gap: 8, paddingVertical: 8 },
  resonanceLabel: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: '#c9a25a' },
  resonanceCard: { borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 8, padding: 14, gap: 4 },
  resonanceQuote: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 15, lineHeight: 22, color: '#3a3530' },
  resonanceSource: { fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#9a9388' },
  reflectButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: '#e8e5e0', borderRadius: 8, backgroundColor: '#ffffff', cursor: 'pointer' },
  reflectText: { fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: '500', color: '#8b7355' },
  reflectionCard: { borderWidth: 1, borderColor: '#e8e5e0', borderStyle: 'dashed', borderRadius: 10, padding: 16 },
  reflectionText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 17, lineHeight: 26, color: '#3a3530' },
});
