/**
 * Licenses & acknowledgments data — every third-party work the app is built
 * on, grouped by category. Rendered as a long scrollable list at the bottom
 * of Settings. Not hidden; just discreet.
 *
 * (design spec §8.2, §3.5 — content + software provenance)
 */

export interface LicenseEntry {
  name: string;
  license: string;
  /** Extra provenance: era, source, maintainer. Quiet, optional. */
  detail?: string;
}

export interface LicenseGroup {
  title: string;
  entries: LicenseEntry[];
}

export const LICENSE_GROUPS: LicenseGroup[] = [
  {
    title: 'Bible Translations',
    entries: [
      { name: 'King James Version (KJV)', license: 'Public domain', detail: '1611' },
      { name: 'World English Bible (WEB)', license: 'Public domain', detail: 'Modern English' },
      { name: 'American Standard Version (ASV)', license: 'Public domain', detail: '1901' },
    ],
  },
  {
    title: 'Voices of the Church',
    entries: [
      { name: 'Augustine — Confessions', license: 'Public domain', detail: 'c. 397–400' },
      { name: 'Thomas à Kempis — The Imitation of Christ', license: 'Public domain', detail: '15th c.' },
      { name: 'John of the Cross — Dark Night of the Soul', license: 'Public domain', detail: 'late 16th c.' },
      { name: 'Julian of Norwich — Revelations of Divine Love', license: 'Public domain', detail: 'c. 1395' },
      { name: 'Brother Lawrence — The Practice of the Presence of God', license: 'Public domain', detail: '17th c.' },
      { name: 'Catherine of Siena — The Dialogue', license: 'Public domain', detail: 'c. 1370' },
      { name: 'Bernard of Clairvaux — On Loving God', license: 'Public domain', detail: 'c. 1125' },
      { name: 'Francis de Sales — Introduction to the Devout Life', license: 'Public domain', detail: '1609' },
      { name: 'Teresa of Avila — The Interior Castle', license: 'Public domain', detail: '1577' },
      { name: 'The Philokalia', license: 'Public domain', detail: '4th–15th c. anthology' },
      { name: 'Rule of St. Benedict', license: 'Public domain', detail: 'c. 540' },
      { name: 'Desert Fathers — The Sayings', license: 'Public domain', detail: '4th–5th c.' },
      { name: 'Ephrem the Syrian — Hymns & Commentaries', license: 'Public domain', detail: '4th c.' },
      { name: 'Gregory the Great — Moralia in Job', license: 'Public domain', detail: '6th c.' },
      { name: 'Anselm of Canterbury — Proslogion', license: 'Public domain', detail: 'c. 1077' },
      { name: 'Bede — Homilies on the Gospels', license: 'Public domain', detail: '8th c.' },
      { name: 'Meister Eckhart — Sermons', license: 'Public domain', detail: '13th–14th c.' },
      { name: 'William of St. Thierry — On Contemplating God', license: 'Public domain', detail: '12th c.' },
    ],
  },
  {
    title: 'On-Device Models',
    entries: [
      {
        name: 'Voyage-4-Nano (INT8 ONNX · 512d)',
        license: 'Apache 2.0',
        detail: 'Voyage AI / onnx-community · Local embeddings',
      },
      {
        name: 'Qwen3-Reranker-0.6B (INT8 Yes/No ONNX)',
        license: 'Apache 2.0',
        detail: 'Alibaba Qwen / n24q02m · Passage relevance scoring only',
      },
    ],
  },
  {
    title: 'Open-Source Software',
    entries: [
      { name: 'ONNX Runtime', license: 'MIT', detail: 'Microsoft' },
      { name: 'React Native', license: 'MIT', detail: 'Meta' },
      { name: 'Expo', license: 'MIT' },
      { name: 'FlashList', license: 'MIT', detail: 'Shopify' },
      { name: 'Zustand', license: 'MIT' },
    ],
  },
  {
    title: 'Fonts',
    entries: [
      { name: 'Cormorant Garamond', license: 'SIL Open Font License' },
      { name: 'Inter', license: 'SIL Open Font License' },
    ],
  },
  {
    title: 'Cross-References',
    entries: [
      {
        name: 'Treasury of Scripture Knowledge',
        license: 'Public domain',
        detail: 'Source: scrollmapper/bible_databases',
      },
    ],
  },
];
