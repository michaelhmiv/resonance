/**
 * Settings screen — full-screen, 7 sections.
 *
 * Each section is currently a placeholder with the correct title and
 * description. Phase 7 will implement the full interactive settings.
 *
 * (design spec §8.2, implementation plan Task 7.1)
 */

import { ScrollView, Text, View, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';

import { colors, fontFamilies, spacing, cardSurface } from '../theme';

interface Section {
  title: string;
  description: string;
  items?: { label: string; value: string }[];
}

const SECTIONS: Section[] = [
  {
    title: 'Embedding Model',
    description:
      'The model that finds echoes in your Library. This is local math — it does not interpret or generate text.',
  },
  {
    title: 'Reflection Model (LLM)',
    description:
      'Generates reflection questions and pattern summaries locally. Your writing never leaves your device.',
  },
  {
    title: 'Reading Preferences',
    description:
      'Default translation, font size, line spacing, verse-per-line, theme variant.',
  },
  {
    title: 'Privacy & Data',
    description:
      'What you write never leaves this device. Export, erase, or lock your data.',
  },
  {
    title: 'Storage',
    description: 'Library footprint, per-package size, storage headroom.',
  },
  {
    title: 'Accessibility',
    description: 'Larger text, high-contrast, reduced motion, dynamic type.',
  },
  {
    title: 'Licenses & Acknowledgments',
    description:
      'All third-party content and software licenses. Not hidden — just discreet.',
    items: [
      { label: 'KJV', value: 'Public domain (1611). Source: BibleSuperSearch.' },
      { label: 'WEB', value: 'Public domain. Source: BibleSuperSearch.' },
      { label: 'ASV', value: 'Public domain (1901). Source: BibleSuperSearch.' },
      { label: 'GTE-small', value: 'MIT License — Alibaba DAMO Academy.' },
      { label: 'Qwen 2.5 1.5B', value: 'Apache 2.0 — Alibaba.' },
      { label: 'ONNX Runtime', value: 'MIT License — Microsoft.' },
      { label: 'llama.cpp / llama.rn', value: 'MIT License.' },
      { label: 'React Native / Expo', value: 'MIT License — Meta.' },
      { label: 'Zustand', value: 'MIT License.' },
      { label: 'FlashList', value: 'MIT License — Shopify.' },
      { label: 'Cormorant Garamond / Inter', value: 'SIL Open Font License.' },
      { label: 'Treasury of Scripture Knowledge', value: 'Public domain. Source: scrollmapper/bible_databases.' },
    ],
  },
];

export function SettingsScreen(): ReactNode {
  return (
    <ScrollView
      style={[styles.container]}
      contentContainerStyle={styles.content}
    >
      {SECTIONS.map((section, i) => (
        <View key={i} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <Text style={styles.sectionDescription}>{section.description}</Text>

          {section.items && (
            <View style={styles.itemList}>
              {section.items.map((item, j) => (
                <View key={j} style={styles.item}>
                  <Text style={styles.itemLabel}>{item.label}</Text>
                  <Text style={styles.itemValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}

      <Text style={styles.footer}>
        Resonance — a private, offline-first spiritual journal.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  sectionDescription: {
    fontFamily: fontFamilies.serif,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  itemList: {
    marginTop: spacing.md,
    ...cardSurface,
    padding: spacing.lg,
  },
  item: {
    flexDirection: 'column',
    paddingVertical: spacing.xs,
  },
  itemLabel: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13,
    color: colors.accent,
    marginBottom: 2,
  },
  itemValue: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  footer: {
    fontFamily: fontFamilies.serifItalic,
    fontSize: 14,
    fontStyle: 'italic',
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.xxl,
    marginBottom: spacing.xxl,
  },
});
