/**
 * Journal screen — the primary writing surface (shared, DataLayer-driven).
 *
 * ✦ Resonance footnotes: each saved entry gets a ✦ icon. Tap to expand
 * matching Scripture and Library passages inline beneath that entry.
 * Resonance is curation, not generation — no AI-written content.
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useDataLayer } from '@resonance/core/data-layer-context';
import type { JournalSegment, ResonanceResult, ResonanceCard } from '@resonance/core';

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

  // Per-entry resonance — keyed by segment ID
  const [resonanceMap, setResonanceMap] = useState<Record<string, ResonanceResult>>({});
  // Which entries are currently loading resonance
  const [loadingResonance, setLoadingResonance] = useState<Set<string>>(new Set());
  // Which entries have expanded ✦ footnotes
  const [expandedFootnotes, setExpandedFootnotes] = useState<Set<string>>(new Set());

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

  const loadResonance = useCallback(async (segId: string, text: string) => {
    if (resonanceMap[segId] || loadingResonance.has(segId)) return;
    setLoadingResonance(prev => new Set(prev).add(segId));
    try {
      const data = await dataLayer.findResonance(text);
      if (data) {
        setResonanceMap(prev => ({ ...prev, [segId]: data }));
      }
    } catch { /* best-effort */ } finally {
      setLoadingResonance(prev => {
        const next = new Set(prev);
        next.delete(segId);
        return next;
      });
    }
  }, [dataLayer, resonanceMap, loadingResonance]);

  const toggleFootnote = useCallback((segId: string, text: string) => {
    setExpandedFootnotes(prev => {
      const next = new Set(prev);
      if (next.has(segId)) {
        next.delete(segId);
      } else {
        next.add(segId);
        // Lazy-load resonance on first expand
        loadResonance(segId, text);
      }
      return next;
    });
  }, [loadResonance]);

  const handleSave = useCallback(async () => {
    if (currentText.trim().length === 0) return;
    setSaving(true);
    try {
      const now = Date.now();
      const segId = `${now}-${Math.random().toString(36).slice(2, 10)}`;
      const segment: JournalSegment = {
        id: segId,
        created_at: now,
        updated_at: now,
        segment_type: 'text',
        text: currentText.trim(),
        position_index: 0,
        parent_date: new Date(now).toISOString().slice(0, 10),
      };

      // Save to backend — Supabase generates the real UUID.
      // Cast the response: saveSegment returns void in the interface but
      // WebDataLayer actually resolves with the saved entry object.
      const saved = await (dataLayer.saveSegment(segment) as Promise<{ id: string } | undefined>);
      const serverId = saved?.id ?? segId;

      // Use server ID for state keying
      const savedSegment: JournalSegment = { ...segment, id: serverId };
      setSegments([savedSegment, ...segments]);
      setCurrentText('');

      // Auto-load resonance for the new entry and expand the footnote
      loadResonance(serverId, savedSegment.text!);
      setExpandedFootnotes(prev => new Set(prev).add(serverId));
    } finally {
      setSaving(false);
    }
  }, [currentText, segments, dataLayer, loadResonance]);

  const handleDelete = useCallback(async (id: string) => {
    await dataLayer.deleteSegment(id);
    setSegments(segments.filter(s => s.id !== id));
    // Clean up resonance state
    setResonanceMap(prev => { const next = { ...prev }; delete next[id]; return next; });
    setExpandedFootnotes(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, [segments, dataLayer]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#8b7355" size="small" />
      </View>
    );
  }

  const textSegs = segments.filter(s => s.segment_type === 'text' && s.text);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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

      {/* Past entries with ✦ resonance footnotes */}
      {textSegs.map((seg) => {
        const hasResonance = resonanceMap[seg.id];
        const isLoading = loadingResonance.has(seg.id);
        const isExpanded = expandedFootnotes.has(seg.id);

        return (
          <View key={seg.id}>
            {/* Entry row */}
            <View style={styles.entryRow}>
              <View style={styles.entryBody}>
                <Text style={styles.entryText}>{seg.text}</Text>
              </View>
              <View style={styles.entryActions}>
                {/* ✦ footnote toggle */}
                <Pressable
                  onPress={() => toggleFootnote(seg.id, seg.text!)}
                  style={styles.footnoteBtn}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Show matching passages"
                >
                  <Text style={[styles.footnoteMark, isExpanded && styles.footnoteMarkActive]}>
                    ✦
                  </Text>
                </Pressable>
                {/* Delete */}
                <Pressable onPress={() => handleDelete(seg.id)} style={styles.deleteBtn} hitSlop={8}>
                  <Text style={styles.deleteText}>×</Text>
                </Pressable>
              </View>
            </View>

            {/* Expanded ✦ resonance cards */}
            {isExpanded && (
              <View style={styles.footnoteCards}>
                {isLoading ? (
                  <View style={styles.resonanceHint}>
                    <ActivityIndicator size="small" color="#8b7355" />
                    <Text style={styles.resonanceText}>Finding resonance…</Text>
                  </View>
                ) : hasResonance ? (
                  <ResonanceCardGroup result={hasResonance} />
                ) : (
                  <Text style={styles.resonanceText}>No matching passages found.</Text>
                )}
              </View>
            )}
          </View>
        );
      })}

      {/* Empty state */}
      {textSegs.length === 0 && (
        <Text style={styles.emptyText}>
          Your journal is empty. Write what's on your heart — resonance will find matching Scripture and voices.
        </Text>
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
    </ScrollView>
  );
}

// ── Resonance card group (rendered beneath each expanded ✦) ──────────────

function ResonanceCardGroup({ result }: { result: ResonanceResult }): ReactNode {
  const scripture = result.scripture ?? [];
  const voices = result.voices ?? [];
  const pastEntries = result.pastEntries ?? [];

  if (scripture.length === 0 && voices.length === 0 && pastEntries.length === 0) {
    return <Text style={styles.resonanceText}>No matching passages found.</Text>;
  }

  return (
    <View style={styles.cardGroup}>
      <CardSection label="Scripture" cards={scripture.slice(0, 1)} />
      <CardSection label="Voices" cards={voices.slice(0, 1)} />
      <CardSection label="Where you were" cards={pastEntries.slice(0, 1)} />
    </View>
  );
}

function CardSection({ label, cards }: { label: string; cards: ResonanceCard[] }): ReactNode | null {
  if (cards.length === 0) return null;
  return (
    <View style={styles.cardSection}>
      <Text style={styles.cardSectionLabel}>{label}</Text>
      {cards.map((card, i) => (
        <View key={i} style={styles.resonanceCard}>
          <Text style={styles.resonanceQuote}>"{card.text}"</Text>
          <Text style={styles.resonanceSource}>{card.source}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: 16, paddingBottom: 40 },
  center: { justifyContent: 'center', alignItems: 'center' },
  dateDivider: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  dateLine: { flex: 1, height: 1, backgroundColor: '#e8e5e0' },
  dateText: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '500', color: '#9a9388', letterSpacing: 0.4 },
  verseCard: { borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 10, padding: 16, gap: 4 },
  verseCardText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 17, lineHeight: 26, color: '#3a3530' },
  verseRef: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9a9388', textAlign: 'right' },

  // Entry
  entryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  entryBody: { flex: 1 },
  entryText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 18, lineHeight: 28, color: '#3a3530' },
  entryActions: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingTop: 2 },
  footnoteBtn: { padding: 4 },
  footnoteMark: { fontSize: 16, color: '#c9a25a', opacity: 0.6 },
  footnoteMarkActive: { opacity: 1, fontWeight: '600' },
  deleteBtn: { padding: 4 },
  deleteText: { fontFamily: 'Inter, sans-serif', fontSize: 18, color: '#c9a0a0', fontWeight: '300' },

  // Footnote cards
  footnoteCards: { paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: '#e8e5e0', marginLeft: 4, gap: 6 },
  cardGroup: { gap: 6 },
  cardSection: { gap: 4 },
  cardSectionLabel: { fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', color: '#b8b0a4' },
  resonanceCard: { borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 8, padding: 12, gap: 4 },
  resonanceQuote: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 14, lineHeight: 20, color: '#3a3530' },
  resonanceSource: { fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#9a9388' },
  resonanceHint: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resonanceText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 13, color: '#9a9388' },

  // Editor
  editor: {
    fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 18, lineHeight: 28, color: '#3a3530',
    borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 10,
    padding: 16, minHeight: 120,
  },
  saveButton: { alignSelf: 'flex-end', backgroundColor: '#8b7355', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  saveText: { fontFamily: 'Inter, sans-serif', fontWeight: '600', fontSize: 15, color: '#ffffff' },
  emptyText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 15, color: '#b8b0a4', textAlign: 'center', paddingVertical: 24 },
});
