/**
 * Main page — three tabs (Journal, Word, Patterns) + Settings link.
 * Uses client-side routing for tab switching.
 */

'use client';

import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native-web';
import JournalPage from './journal/page';
import WordPage from './word/page';
import PatternsPage from './patterns/page';

type Tab = 'journal' | 'word' | 'patterns';

export default function HomePage(): ReactNode {
  const [activeTab, setActiveTab] = useState<Tab>('journal');

  return (
    <View style={styles.container}>
      {/* ── Header ──────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Resonance</Text>
        <TabBar activeTab={activeTab} onSelect={setActiveTab} />
      </View>

      {/* ── Tab content ─────────────────────────────────────── */}
      <View style={styles.content}>
        {activeTab === 'journal' && <JournalPage />}
        {activeTab === 'word' && <WordPage />}
        {activeTab === 'patterns' && <PatternsPage />}
      </View>

      {/* ── Settings link ───────────────────────────────────── */}
      <View style={styles.footer}>
        <Pressable onPress={() => window.location.href = '/settings'} style={styles.settingsLink}>
          <Text style={styles.settingsText}>Settings</Text>
        </Pressable>
      </View>
    </View>
  );
}

function TabBar({ activeTab, onSelect }: { activeTab: Tab; onSelect: (t: Tab) => void }): ReactNode {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'journal', label: 'Journal' },
    { id: 'word', label: 'Word' },
    { id: 'patterns', label: 'Patterns' },
  ];
  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onSelect(tab.id)}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#faf9f6',
    maxWidth: 720,
    width: '100%',
    marginLeft: 'auto',
    marginRight: 'auto',
    minHeight: '100vh',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e5e0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontFamily: 'Georgia, serif',
    fontSize: 24,
    fontWeight: '600',
    color: '#3a3530',
    letterSpacing: 0.4,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 0,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#8b7355',
  },
  tabText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 14,
    fontWeight: '500',
    color: '#9a9388',
  },
  tabTextActive: {
    color: '#8b7355',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  footer: {
    padding: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e8e5e0',
  },
  settingsLink: {
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  settingsText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 14,
    color: '#7a7368',
  },
});
