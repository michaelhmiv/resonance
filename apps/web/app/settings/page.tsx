/**
 * Settings page — full 7-section settings screen (web version).
 *
 * Currently static. When Supabase auth is wired in, this becomes
 * interactive with real model switching and preferences.
 */

'use client';

import { type ReactNode } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native-web';
import { EMBEDDING_MODELS, LLM_MODELS } from '@resonance/core';

export default function SettingsPage(): ReactNode {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onPress={() => window.history.back()} style={styles.backLink}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      {/* 1. Embedding Model */}
      <Section title="Embedding Model">
        <Text style={styles.description}>
          Runs on-device (mobile) or server-side (web/premium) to match your
          writing with Scripture and voices.
        </Text>
        {EMBEDDING_MODELS.map((model) => (
          <Row key={model.id} label={model.label} subtext={`${model.sizeMb} MB · ${model.license}`} />
        ))}
      </Section>

      {/* 2. Reflection Model */}
      <Section title="Reflection Model">
        <Text style={styles.description}>
          Generates gentle questions and weekly summaries. Runs entirely
          on-device. Never writes prayers or interprets Scripture.
        </Text>
        {LLM_MODELS.map((model) => (
          <Row key={model.id} label={model.label} subtext={`${model.sizeMb} MB · ${model.license}`} />
        ))}
      </Section>

      {/* 3. Reading Preferences */}
      <Section title="Reading Preferences">
        <Row label="Default Translation" subtext="WEB" />
        <Row label="Font Size" subtext="Medium" />
        <Row label="Theme" subtext="Auto" />
      </Section>

      {/* 4. Privacy & Data */}
      <Section title="Privacy & Data">
        <Row label="Export Journal" />
        <Row label="Clear All Journal Data" />
        <Row label="Clear Resonance Vectors" />
        <Row label="App Lock" subtext="Not configured" />
        <Text style={styles.note}>
          All data is stored locally. Nothing leaves this device.
        </Text>
      </Section>

      {/* 5. Storage */}
      <Section title="Storage">
        <Row label="Total storage used" subtext="0 MB" />
        <Text style={styles.note}>
          All data is stored locally on this device.
        </Text>
      </Section>

      {/* 6. Accessibility */}
      <Section title="Accessibility">
        <Row label="Text Scale" subtext="Medium" />
        <Row label="Reduce Motion" subtext="Off" />
      </Section>

      {/* 7. Licenses */}
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
  backLink: { marginBottom: 16 },
  backText: { fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: '500', color: '#8b7355' },
  section: { gap: 8 },
  sectionTitle: { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: '600', color: '#3a3530' },
  sectionBody: { gap: 1, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff' },
  description: { fontFamily: 'Georgia, serif', fontSize: 14, color: '#7a7368', paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e8e5e0' },
  rowLabel: { fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#3a3530' },
  rowSubtext: { fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9a9388' },
  note: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontStyle: 'italic', color: '#9a9388', paddingHorizontal: 16, paddingVertical: 8 },
  licenseGroup: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e8e5e0', gap: 4 },
  licenseTitle: { fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, color: '#9a9388', marginBottom: 8 },
  licenseItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, paddingVertical: 2 },
  licenseName: { fontFamily: 'Georgia, serif', fontSize: 14, color: '#3a3530', flex: 1 },
  licenseText: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9a9388' },
});
