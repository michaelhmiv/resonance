/**
 * Settings screen — 7 sections for model, reading, privacy, storage,
 * accessibility, and licenses.
 *
 * Quiet, reverent, text-forward. No "AI assistant" vibes.
 *
 * (design spec §8: Settings / Profile — not a fourth tab, in the header)
 */

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import {
  cardSurface,
  colors,
  fontFamilies,
  layout,
  radii,
  serifText,
  spacing,
} from '../theme';
import { EMBEDDING_MODELS } from '../embedding/embeddingService';
import { LLM_MODELS } from '../embedding/reflectionService';
import {
  getActiveModel,
  setActiveModel,
  isLlmEnabled,
  setLlmEnabled,
} from '../packages/modelManager';
import { getStorageInfo, getInstalledPackages } from '../packages/packageManager';
import { getDatabase } from '../db/database';
import type { EmbeddingModelId } from '../embedding/embeddingService';

// ── Component ───────────────────────────────────────────────────────────────

export function SettingsScreen(): ReactNode {
  const [activeModel, setActiveModelState] = useState<EmbeddingModelId>('gte-small');
  const [llmEnabled, setLlmEnabledState] = useState(false);
  const [defaultTranslation, setDefaultTranslation] = useState<'WEB' | 'KJV'>('WEB');
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [reduceMotion, setReduceMotion] = useState(false);
  const [textScale, setTextScale] = useState<'small' | 'medium' | 'large' | 'xlarge'>('medium');
  const [storageTotal, setStorageTotal] = useState(0);
  const [installedPkgs, setInstalledPkgs] = useState<{ package_id: string; passage_count: number }[]>([]);

  // ── Load settings on mount ───────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const model = await getActiveModel();
      setActiveModelState(model);
      const llm = await isLlmEnabled();
      setLlmEnabledState(llm);

      const storage = await getStorageInfo();
      setStorageTotal(storage.totalBytes);
      const pkgs = await getInstalledPackages();
      setInstalledPkgs(
        pkgs.map((p) => ({ package_id: p.package_id, passage_count: 0 }))
      );

      // Load reading prefs from app_settings
      const db = getDatabase();
      if (db) {
        try {
          const transRow = await db.getFirstAsync<{ value: string }>(
            `SELECT value FROM app_settings WHERE key = 'default_translation';`
          );
          if (transRow?.value) setDefaultTranslation(transRow.value as 'WEB' | 'KJV');

          const sizeRow = await db.getFirstAsync<{ value: string }>(
            `SELECT value FROM app_settings WHERE key = 'font_size';`
          );
          if (sizeRow?.value) setFontSize(sizeRow.value as typeof fontSize);
        } catch {
          // ignore
        }
      }
    };
    void load();
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleModelChange = useCallback(async (modelId: EmbeddingModelId) => {
    setActiveModelState(modelId);
    await setActiveModel(modelId);
  }, []);

  const handleLlmToggle = useCallback(async (enabled: boolean) => {
    setLlmEnabledState(enabled);
    await setLlmEnabled(enabled);
  }, []);

  const handleTranslationChange = useCallback(async (trans: 'WEB' | 'KJV') => {
    setDefaultTranslation(trans);
    const db = getDatabase();
    if (db) {
      await db.runAsync(
        `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);`,
        'default_translation',
        trans
      );
    }
  }, []);

  const handleExportJournal = useCallback(async () => {
    const db = getDatabase();
    if (!db) return;
    try {
      const rows = await db.getAllAsync<{ text: string; parent_date: string; created_at: number }>(
        `SELECT text, parent_date, created_at FROM journal_segments
         WHERE segment_type = 'text' AND text IS NOT NULL
         ORDER BY position_index;`
      );
      const text = rows
        .map((r) => {
          const date = new Date(r.created_at).toLocaleDateString();
          return `${date}\n${r.text}\n`;
        })
        .join('\n---\n\n');
      // In production: save to file and share
      Alert.alert('Export', `${rows.length} entries ready for export.`);
    } catch {
      Alert.alert('Export', 'Could not export journal data.');
    }
  }, []);

  const handleClearJournal = useCallback(() => {
    Alert.alert(
      'Clear Journal',
      'This will permanently delete all journal entries. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const db = getDatabase();
            if (!db) return;
            await db.runAsync('DELETE FROM journal_segments;');
            await db.runAsync('DELETE FROM journal_segment_vectors;');
          },
        },
      ]
    );
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* 1. Embedding Model */}
      <Section title="Embedding Model">
        <Text style={styles.sectionDescription}>
          Runs on-device to match your writing with Scripture and voices.
        </Text>
        {EMBEDDING_MODELS.map((model) => (
          <SettingRow
            key={model.id}
            label={model.label}
            subtext={`${model.sizeMb} MB · ${model.license}`}
            selected={activeModel === model.id}
            onPress={() => handleModelChange(model.id)}
          />
        ))}
      </Section>

      {/* 2. Reflection Model (LLM) */}
      <Section title="Reflection Model">
        <View style={styles.toggleRow}>
          <View style={styles.toggleLabel}>
            <Text style={styles.labelText}>Enable reflection prompts</Text>
            <Text style={styles.labelSubtext}>
              Generates gentle questions and weekly summaries. Runs entirely
              on-device. Never writes prayers or interprets Scripture.
            </Text>
          </View>
          <Switch
            value={llmEnabled}
            onValueChange={handleLlmToggle}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.surface}
          />
        </View>
        {llmEnabled && LLM_MODELS.map((model) => (
          <SettingRow
            key={model.id}
            label={model.label}
            subtext={`${model.sizeMb} MB · ${model.license}`}
            selected
          />
        ))}
      </Section>

      {/* 3. Reading Preferences */}
      <Section title="Reading Preferences">
        <Text style={styles.subsectionLabel}>Default Translation</Text>
        <View style={styles.segmentedRow}>
          {(['WEB', 'KJV'] as const).map((t) => (
            <SegmentedButton
              key={t}
              label={t}
              selected={defaultTranslation === t}
              onPress={() => handleTranslationChange(t)}
            />
          ))}
        </View>
        <Text style={styles.subsectionLabel}>Font Size</Text>
        <View style={styles.segmentedRow}>
          {(['small', 'medium', 'large'] as const).map((s) => (
            <SegmentedButton
              key={s}
              label={s.charAt(0).toUpperCase() + s.slice(1)}
              selected={fontSize === s}
              onPress={() => setFontSize(s)}
            />
          ))}
        </View>
      </Section>

      {/* 4. Privacy & Data */}
      <Section title="Privacy & Data">
        <SettingRow label="Export Journal" onPress={handleExportJournal} icon="download" />
        <SettingRow
          label="Clear All Journal Data"
          onPress={handleClearJournal}
          icon="trash-2"
          destructive
        />
        <SettingRow label="Clear Resonance Vectors" onPress={() => {}} icon="zap" />
        <SettingRow label="App Lock" onPress={() => {}} icon="lock" />
        <Text style={styles.privacyNote}>
          All data is stored locally. Nothing leaves this device.
        </Text>
      </Section>

      {/* 5. Storage */}
      <Section title="Storage">
        <View style={styles.storageCard}>
          <Text style={styles.storageTotal}>
            {(storageTotal / (1024 * 1024)).toFixed(1)} MB
          </Text>
          <Text style={styles.storageLabel}>Total storage used</Text>
        </View>
        {installedPkgs.map((pkg) => (
          <View key={pkg.package_id} style={styles.storageItem}>
            <Text style={styles.storageItemLabel}>{pkg.package_id}</Text>
          </View>
        ))}
        <Text style={styles.privacyNote}>
          All data is stored locally on this device.
        </Text>
      </Section>

      {/* 6. Accessibility */}
      <Section title="Accessibility">
        <Text style={styles.subsectionLabel}>Text Scale</Text>
        <View style={styles.segmentedRow}>
          {(['small', 'medium', 'large', 'xlarge'] as const).map((s) => (
            <SegmentedButton
              key={s}
              label={s === 'xlarge' ? 'XL' : s.charAt(0).toUpperCase() + s.slice(1)}
              selected={textScale === s}
              onPress={() => setTextScale(s)}
            />
          ))}
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.labelText}>Reduce Motion</Text>
          <Switch
            value={reduceMotion}
            onValueChange={setReduceMotion}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.surface}
          />
        </View>
      </Section>

      {/* 7. Licenses & Acknowledgments */}
      <Section title="Licenses & Acknowledgments">
        <LicenseGroup
          title="Bible Translations"
          items={[
            { name: 'King James Version (KJV)', license: 'Public Domain' },
            { name: 'World English Bible (WEB)', license: 'Public Domain' },
            { name: 'American Standard Version (ASV)', license: 'Public Domain' },
          ]}
        />
        <LicenseGroup
          title="Voice Texts"
          items={[
            { name: 'Augustine — Confessions', license: 'Public Domain' },
            { name: "Thomas à Kempis — Imitation of Christ", license: 'Public Domain' },
            { name: 'John of the Cross — Dark Night of the Soul', license: 'Public Domain' },
            { name: 'Julian of Norwich — Revelations of Divine Love', license: 'Public Domain' },
            { name: 'Brother Lawrence — Practice of the Presence of God', license: 'Public Domain' },
            { name: 'Catherine of Siena — Dialogue', license: 'Public Domain' },
            { name: 'Bernard of Clairvaux — On Loving God', license: 'Public Domain' },
            { name: 'Francis de Sales — Introduction to the Devout Life', license: 'Public Domain' },
            { name: 'Teresa of Avila — Interior Castle', license: 'Public Domain' },
            { name: 'The Philokalia', license: 'Public Domain' },
            { name: 'Rule of St. Benedict', license: 'Public Domain' },
            { name: 'Desert Fathers — Sayings', license: 'Public Domain' },
            { name: 'Ephrem the Syrian — Hymns', license: 'Public Domain' },
            { name: 'Gregory the Great — Pastoral Rule', license: 'Public Domain' },
            { name: 'Anselm of Canterbury — Proslogion', license: 'Public Domain' },
            { name: 'Bede — Ecclesiastical History', license: 'Public Domain' },
            { name: 'Meister Eckhart — Sermons', license: 'Public Domain' },
            { name: 'William of St. Thierry — On Contemplating God', license: 'Public Domain' },
          ]}
        />
        <LicenseGroup
          title="Embedding Models"
          items={EMBEDDING_MODELS.map((m) => ({
            name: m.label,
            license: m.license,
          }))}
        />
        <LicenseGroup
          title="LLM Models"
          items={LLM_MODELS.map((m) => ({
            name: m.label,
            license: m.license,
          }))}
        />
        <LicenseGroup
          title="Open-Source Software"
          items={[
            { name: 'ONNX Runtime', license: 'MIT' },
            { name: 'llama.cpp', license: 'MIT' },
            { name: 'React Native', license: 'MIT' },
            { name: 'Expo', license: 'MIT' },
            { name: 'FlashList', license: 'MIT' },
          ]}
        />
        <LicenseGroup
          title="Fonts"
          items={[
            { name: 'Cormorant Garamond', license: 'OFL' },
            { name: 'Inter', license: 'OFL' },
          ]}
        />
        <LicenseGroup
          title="Cross-References"
          items={[
            { name: 'Treasury of Scripture Knowledge', license: 'Public Domain' },
          ]}
        />
      </Section>

      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function SettingRow({
  label,
  subtext,
  selected,
  onPress,
  icon,
  destructive,
}: {
  label: string;
  subtext?: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: string;
  destructive?: boolean;
}): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.settingRow,
        pressed && styles.settingRowPressed,
      ]}
    >
      {icon ? (
        <Feather
          name={icon as never}
          size={18}
          color={destructive ? '#b04040' : colors.textSecondary}
        />
      ) : null}
      <View style={styles.settingRowText}>
        <Text
          style={[styles.labelText, destructive && { color: '#b04040' }]}
        >
          {label}
        </Text>
        {subtext ? <Text style={styles.labelSubtext}>{subtext}</Text> : null}
      </View>
      {selected !== undefined && (
        <Feather
          name="check"
          size={18}
          color={selected ? colors.accent : 'transparent'}
        />
      )}
    </Pressable>
  );
}

function SegmentedButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.segmentedBtn,
        selected && styles.segmentedBtnActive,
      ]}
    >
      <Text
        style={[
          styles.segmentedBtnText,
          selected && styles.segmentedBtnTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function LicenseGroup({
  title,
  items,
}: {
  title: string;
  items: { name: string; license: string }[];
}): ReactNode {
  return (
    <View style={styles.licenseGroup}>
      <Text style={styles.licenseGroupTitle}>{title}</Text>
      {items.map((item, i) => (
        <View key={i} style={styles.licenseItem}>
          <Text style={styles.licenseName}>{item.name}</Text>
          <Text style={styles.licenseText}>{item.license}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: layout.screenPaddingX,
    paddingVertical: spacing.lg,
    gap: spacing.xl,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    ...serifText,
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 20,
    color: colors.textPrimary,
  },
  sectionBody: {
    gap: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sectionDescription: {
    ...serifText,
    fontSize: 14,
    color: colors.textSecondary,
    paddingBottom: spacing.xs,
  },
  subsectionLabel: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12,
    letterSpacing: 0.4,
    color: colors.textTertiary,
    marginTop: spacing.sm,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: layout.cardPadding,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  settingRowPressed: {
    backgroundColor: colors.background,
  },
  settingRowText: {
    flex: 1,
  },
  labelText: {
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    color: colors.textPrimary,
  },
  labelSubtext: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: layout.cardPadding,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  toggleLabel: {
    flex: 1,
    paddingRight: spacing.md,
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: 1,
    paddingVertical: spacing.xs,
    paddingHorizontal: layout.cardPadding,
  },
  segmentedBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  segmentedBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segmentedBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },
  segmentedBtnTextActive: {
    color: colors.surface,
  },
  storageCard: {
    padding: layout.cardPadding,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    gap: spacing.xs,
  },
  storageTotal: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 28,
    color: colors.textPrimary,
  },
  storageLabel: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.textTertiary,
  },
  storageItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: layout.cardPadding,
  },
  storageItemLabel: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.textSecondary,
  },
  privacyNote: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
    fontStyle: 'italic',
    paddingTop: spacing.sm,
    paddingHorizontal: layout.cardPadding,
    paddingBottom: spacing.sm,
  },
  licenseGroup: {
    paddingVertical: spacing.sm,
    paddingHorizontal: layout.cardPadding,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  licenseGroupTitle: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13,
    letterSpacing: 0.4,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  licenseItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: 2,
  },
  licenseName: {
    ...serifText,
    fontSize: 14,
    color: colors.textPrimary,
    flex: 1,
  },
  licenseText: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
  },
});
