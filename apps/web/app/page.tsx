/**
 * Main page — three tabs (Journal, Word, Patterns) + Settings link.
 * Uses client-side routing for tab switching.
 */

'use client';

import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native-web';
import { BottomTabBar, type TabId } from '@resonance/ui';
import JournalPage from './journal/page';
import WordPage from './word/page';
import PatternsPage from './patterns/page';

export default function HomePage(): ReactNode {
  const [activeTab, setActiveTab] = useState<TabId>('journal');

  return (
    <View style={styles.container} className="resonance-container">
      {/* ── Header ──────────────────────────────────────────── */}
      <View style={styles.header} className="resonance-header">
        <Text style={styles.headerTitle}>Resonance</Text>
        <View style={styles.tabBar} className="resonance-tab-bar">
          {([
            { id: 'journal' as TabId, label: 'Journal' },
            { id: 'word' as TabId, label: 'Word' },
            { id: 'patterns' as TabId, label: 'Patterns' },
          ]).map((tab) => {
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
      {/* ── Bottom tab bar (mobile only) ───────────────────── */}
      <BottomTabBar activeTab={activeTab} onSelect={onSelect} />
    </View>
  );

  function onSelect(t: TabId) {
    setActiveTab(t);
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#faf9f6',
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
    flexWrap: 'wrap',
    gap: 8,
  },
  headerTitle: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontSize: 28,
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
    cursor: 'pointer',
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
    cursor: 'pointer',
  },
  settingsText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 14,
    color: '#7a7368',
  },
});
