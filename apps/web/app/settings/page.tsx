/**
 * Settings page — fully interactive settings (web version).
 *
 * All settings persist via /api/settings. Every row is clickable.
 * Includes: model selection, reading prefs, privacy/data, storage,
 * accessibility, account/auth status, and licenses.
 */

'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { StyleSheet, Text, View, Pressable, ScrollView, ActivityIndicator } from 'react-native-web';
import { EMBEDDING_MODELS, LLM_MODELS } from '@resonance/core';

interface Settings {
  translation: string;
  fontSize: string;
  theme: string;
  textScale: string;
  reduceMotion: string;
  embeddingModel: string;
  llmModel: string;
}

const FONT_SIZES = ['small', 'medium', 'large'];
const TEXT_SCALES = ['small', 'medium', 'large', 'extra_large'];
const THEMES = ['auto', 'light'];

export default function SettingsPage(): ReactNode {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [storageSize, setStorageSize] = useState(0);
  const [showConfirm, setShowConfirm] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(setSettings).catch(() => {});
    // Fetch storage size from journal entries
    fetch('/api/journal/entries').then(r => r.json()).then(d => {
      const bytes = (d.entries || []).reduce((sum: number, e: any) => sum + (e.text?.length || 0), 0);
      setStorageSize(bytes);
    }).catch(() => {});
  }, []);

  const updateSetting = useCallback(async (key: string, value: string) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
  }, [settings]);

  const cycleValue = (current: string, options: string[]): string => {
    const idx = options.indexOf(current);
    return options[(idx + 1) % options.length];
  };

  const handleExport = () => {
    fetch('/api/journal/entries')
      .then(r => r.json())
      .then(data => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'resonance-journal-export.json';
        a.click();
        URL.revokeObjectURL(url);
      });
  };

  const handleClearJournal = async () => {
    const entries = await fetch('/api/journal/entries').then(r => r.json());
    for (const entry of (entries.entries || [])) {
      await fetch(`/api/journal/entries/${entry.id}`, { method: 'DELETE' });
    }
    setStorageSize(0);
    setShowConfirm(null);
  };

  const handleSignOut = () => {
    document.cookie = 'resonance-auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    window.location.href = '/login';
  };

  if (!settings) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color="#8b7355" />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onPress={() => window.history.back()} style={styles.backLink}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      {/* 1. Account */}
      <Section title="Account">
        <Row label="Status" subtext="Premium (dev)" />
        <Pressable onPress={handleSignOut} style={styles.actionRow}>
          <Text style={styles.actionText}>Sign out</Text>
        </Pressable>
      </Section>

      {/* 2. Embedding Model */}
      <Section title="Embedding Model">
        <Text style={styles.description}>
          Matches your writing with Scripture and voices.
        </Text>
        {EMBEDDING_MODELS.map((model) => (
          <Pressable
            key={model.id}
            onPress={() => updateSetting('embeddingModel', model.id)}
            style={[styles.row, styles.selectableRow, settings.embeddingModel === model.id && styles.rowSelected]}
          >
            <View>
              <Text style={styles.rowLabel}>{model.label}</Text>
              <Text style={styles.rowSubtext}>{model.sizeMb} MB · {model.license}</Text>
            </View>
            {settings.embeddingModel === model.id && <Text style={styles.checkMark}>✓</Text>}
          </Pressable>
        ))}
      </Section>

      {/* 3. Reflection Model */}
      <Section title="Reflection Model">
        <Text style={styles.description}>
          Generates gentle questions and weekly summaries. Never writes prayers or interprets Scripture.
        </Text>
        {LLM_MODELS.map((model) => (
          <Pressable
            key={model.id}
            onPress={() => updateSetting('llmModel', model.id)}
            style={[styles.row, styles.selectableRow, settings.llmModel === model.id && styles.rowSelected]}
          >
            <View>
              <Text style={styles.rowLabel}>{model.label}</Text>
              <Text style={styles.rowSubtext}>{model.sizeMb} MB · {model.license}</Text>
            </View>
            {settings.llmModel === model.id && <Text style={styles.checkMark}>✓</Text>}
          </Pressable>
        ))}
      </Section>

      {/* 4. Reading Preferences */}
      <Section title="Reading Preferences">
        <Pressable onPress={() => updateSetting('translation', cycleValue(settings.translation, ['web', 'kjv']))} style={styles.row}>
          <Text style={styles.rowLabel}>Default Translation</Text>
          <Text style={styles.rowValue}>{settings.translation.toUpperCase()}</Text>
        </Pressable>
        <Pressable onPress={() => updateSetting('fontSize', cycleValue(settings.fontSize, FONT_SIZES))} style={styles.row}>
          <Text style={styles.rowLabel}>Font Size</Text>
          <Text style={styles.rowValue}>{settings.fontSize.charAt(0).toUpperCase() + settings.fontSize.slice(1)}</Text>
        </Pressable>
        <Pressable onPress={() => updateSetting('theme', cycleValue(settings.theme, THEMES))} style={styles.row}>
          <Text style={styles.rowLabel}>Theme</Text>
          <Text style={styles.rowValue}>{settings.theme.charAt(0).toUpperCase() + settings.theme.slice(1)}</Text>
        </Pressable>
      </Section>

      {/* 5. Privacy & Data */}
      <Section title="Privacy & Data">
        <Pressable onPress={handleExport} style={styles.row}>
          <Text style={styles.rowLabel}>Export Journal</Text>
          <Text style={styles.chevron}>↓</Text>
        </Pressable>
        <Pressable onPress={() => setShowConfirm('journal')} style={styles.row}>
          <Text style={styles.dangerText}>Clear All Journal Data</Text>
        </Pressable>
        <Row label="App Lock" subtext="Not configured" />
        <Text style={styles.note}>
          Your data is stored on the server. Sign out to lock access.
        </Text>
      </Section>

      {/* 6. Storage */}
      <Section title="Storage">
        <Row label="Total storage used" subtext={`${(storageSize / 1024).toFixed(1)} KB`} />
      </Section>

      {/* 7. Accessibility */}
      <Section title="Accessibility">
        <Pressable onPress={() => updateSetting('textScale', cycleValue(settings.textScale, TEXT_SCALES))} style={styles.row}>
          <Text style={styles.rowLabel}>Text Scale</Text>
          <Text style={styles.rowValue}>{settings.textScale.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</Text>
        </Pressable>
        <Pressable onPress={() => updateSetting('reduceMotion', settings.reduceMotion === 'off' ? 'on' : 'off')} style={styles.row}>
          <Text style={styles.rowLabel}>Reduce Motion</Text>
          <Text style={styles.rowValue}>{settings.reduceMotion === 'on' ? 'On' : 'Off'}</Text>
        </Pressable>
      </Section>

      {/* 8. Licenses */}
      <Section title="Licenses & Acknowledgments">
        <LicenseGroup title="Bible Translations" items={[
          { name: 'KJV', license: 'Public Domain' },
          { name: 'WEB', license: 'Public Domain' },
          { name: 'ASV', license: 'Public Domain' },
        ]} />
        <LicenseGroup title="Embedding Models" items={EMBEDDING_MODELS.map(m => ({ name: m.label, license: m.license }))} />
        <LicenseGroup title="LLM Models" items={LLM_MODELS.map(m => ({ name: m.label, license: m.license }))} />
        <LicenseGroup title="Open-Source" items={[
          { name: 'ONNX Runtime', license: 'MIT' },
          { name: 'llama.cpp', license: 'MIT' },
          { name: 'React Native', license: 'MIT' },
          { name: 'Next.js', license: 'MIT' },
          { name: 'FlashList', license: 'MIT' },
        ]} />
        <LicenseGroup title="Fonts" items={[
          { name: 'Cormorant Garamond', license: 'OFL' },
          { name: 'Inter', license: 'OFL' },
        ]} />
        <LicenseGroup title="Cross-References" items={[
          { name: 'Treasury of Scripture Knowledge', license: 'Public Domain' },
        ]} />
      </Section>

      {/* Confirm dialog */}
      {showConfirm === 'journal' && (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmDialog}>
            <Text style={styles.confirmTitle}>Clear all journal data?</Text>
            <Text style={styles.confirmText}>This will permanently delete all your journal entries. This cannot be undone.</Text>
            <View style={styles.confirmActions}>
              <Pressable onPress={() => setShowConfirm(null)} style={styles.confirmCancel}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleClearJournal} style={styles.confirmDelete}>
                <Text style={styles.confirmDeleteText}>Delete All</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ label, subtext }: { label: string; subtext?: string }): ReactNode {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {subtext ? <Text style={styles.rowSubtext}>{subtext}</Text> : null}
    </View>
  );
}

function LicenseGroup({ title, items }: { title: string; items: { name: string; license: string }[] }): ReactNode {
  return (
    <View style={styles.licenseGroup}>
      <Text style={styles.licenseTitle}>{title}</Text>
      {items.map((item, i) => (
        <View key={i} style={styles.licenseItem}>
          <Text style={styles.licenseName}>{item.name}</Text>
          <Text style={styles.licenseText}>{item.license}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#faf9f6' },
  content: { paddingHorizontal: 24, paddingVertical: 20, gap: 32, maxWidth: 720, width: '100%', marginLeft: 'auto', marginRight: 'auto' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },
  backLink: { marginBottom: 16, cursor: 'pointer' },
  backText: { fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: '500', color: '#8b7355' },
  section: { gap: 8 },
  sectionTitle: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 20, fontWeight: '600', color: '#3a3530' },
  sectionBody: { gap: 1, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff' },
  description: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 14, color: '#7a7368', paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f0ede8', cursor: 'pointer' },
  selectableRow: { cursor: 'pointer' },
  rowSelected: { backgroundColor: '#faf9f6' },
  rowLabel: { fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#3a3530' },
  rowSubtext: { fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9a9388' },
  rowValue: { fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: '500', color: '#8b7355' },
  checkMark: { fontFamily: 'Inter, sans-serif', fontSize: 16, color: '#8b7355' },
  chevron: { fontFamily: 'Inter, sans-serif', fontSize: 18, color: '#9a9388' },
  dangerText: { fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#c9a0a0' },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f0ede8', cursor: 'pointer' },
  actionText: { fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#8b7355' },
  note: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontStyle: 'italic', color: '#9a9388', paddingHorizontal: 16, paddingVertical: 8 },
  licenseGroup: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f0ede8', gap: 4 },
  licenseTitle: { fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, color: '#9a9388', marginBottom: 8 },
  licenseItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, paddingVertical: 2 },
  licenseName: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 14, color: '#3a3530', flex: 1 },
  licenseText: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9a9388' },
  confirmOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  confirmDialog: { backgroundColor: '#ffffff', borderRadius: 12, padding: 24, maxWidth: 400, width: '90%', gap: 12 },
  confirmTitle: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 20, fontWeight: '600', color: '#3a3530' },
  confirmText: { fontFamily: 'Inter, sans-serif', fontSize: 14, lineHeight: 20, color: '#7a7368' },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  confirmCancel: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: '#e8e5e0', cursor: 'pointer' },
  confirmCancelText: { fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: '500', color: '#7a7368' },
  confirmDelete: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#c9a0a0', cursor: 'pointer' },
  confirmDeleteText: { fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: '600', color: '#ffffff' },
});
