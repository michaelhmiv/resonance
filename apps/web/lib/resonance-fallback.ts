/**
 * Lexical resonance fallback used only when the deployed vector index is
 * unavailable. This is deliberately transparent: it is not a replacement for
 * GTE-small semantic search, but it prevents the product from silently showing
 * empty placeholders while vector shards are missing/loading.
 */

export interface FallbackPassage {
  id: number;
  text: string;
  translation: string | null;
  book_id?: string;
  book?: string;
  chapter?: number | null;
  verse_start?: number | null;
  verse_end?: number | null;
  author?: string | null;
  work?: string | null;
}

export interface ResonanceFallbackCard {
  passageId: number;
  text: string;
  source: string;
  bookId: string;
  translation: string | null;
  similarity: number;
  kind: 'scripture' | 'voice';
}

const STOP_WORDS = new Set([
  'the', 'and', 'that', 'with', 'from', 'this', 'have', 'will', 'your', 'you',
  'are', 'was', 'were', 'for', 'but', 'not', 'all', 'any', 'can', 'just',
  'into', 'about', 'what', 'when', 'where', 'why', 'how', 'been', 'being',
  'feel', 'feeling', 'felt', 'really', 'very', 'like', 'need', 'want', 'know',
  'think', 'thought', 'thing', 'things', 'one', 'our', 'their', 'there', 'here',
]);

const CONCEPTS: Record<string, string[]> = {
  rest: ['rest', 'weary', 'labor', 'labour', 'burden', 'heavy', 'tired', 'exhausted', 'sleep'],
  anxious: ['anxious', 'anxiety', 'worry', 'worried', 'careful', 'fear', 'afraid', 'tomorrow'],
  alone: ['alone', 'lonely', 'forsaken', 'near', 'presence', 'comfort', 'friend'],
  grief: ['grief', 'sorrow', 'weep', 'tears', 'mourning', 'brokenhearted', 'comfort'],
  wisdom: ['wisdom', 'understanding', 'discernment', 'guide', 'path', 'way'],
  forgiveness: ['forgive', 'forgiven', 'mercy', 'grace', 'sin', 'cleanse'],
  hope: ['hope', 'wait', 'endure', 'light', 'darkness', 'renew', 'strength'],
  peace: ['peace', 'still', 'quiet', 'calm', 'trouble', 'heart'],
};

function tokens(text: string): string[] {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  const expanded = [...base];
  for (const word of base) {
    for (const terms of Object.values(CONCEPTS)) {
      if (terms.includes(word)) expanded.push(...terms);
    }
  }
  return expanded;
}

function tf(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const token of tokens(text)) map.set(token, (map.get(token) ?? 0) + 1);
  return map;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const av of a.values()) normA += av * av;
  for (const bv of b.values()) normB += bv * bv;
  for (const [key, av] of a) dot += av * (b.get(key) ?? 0);
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function sourceFor(p: FallbackPassage, kind: 'scripture' | 'voice'): string {
  if (kind === 'scripture') {
    const book = p.book ?? p.book_id?.replace(/^[A-Z]+_/i, '').replace(/_/g, ' ') ?? 'Scripture';
    const verse = p.verse_start != null ? `${book} ${p.chapter ?? ''}:${p.verse_start}` : `${book} ${p.chapter ?? ''}`;
    const end = p.verse_end != null && p.verse_end !== p.verse_start ? `-${p.verse_end}` : '';
    return `${verse}${end} (${(p.translation ?? 'WEB').toUpperCase()})`;
  }
  return [p.author, p.work ?? p.book_id].filter(Boolean).join(' — ') || 'Library';
}

function boostedScore(queryText: string, passageText: string, base: number): number {
  const q = queryText.toLowerCase();
  const p = passageText.toLowerCase();
  let boost = 0;
  if (/(exhausted|tired|weary|burden|rest)/.test(q)) {
    if (p.includes('i will give you rest')) boost += 1.2;
    if (p.includes('come to me') && (p.includes('labor') || p.includes('labour') || p.includes('heavy laden'))) boost += 1.0;
    if (p.includes('my burden is light')) boost += 0.8;
  }
  if (/(anxious|anxiety|worry|worried|tomorrow|afraid)/.test(q)) {
    if (p.includes('don\'t be anxious') || p.includes('be not anxious')) boost += 1.2;
    if (p.includes('do not be afraid') || p.includes("don't be afraid")) boost += 0.5;
    if (p.includes('tomorrow')) boost += 0.7;
  }
  if (/(alone|lonely|forsaken)/.test(q)) {
    if (p.includes('i will never leave you') || p.includes('nor forsake you')) boost += 1.2;
    if (p.includes('i am with you')) boost += 0.8;
  }
  return base + boost;
}

export function lexicalResonance(
  queryText: string,
  scripture: FallbackPassage[],
  voices: FallbackPassage[],
  perCategory = 3,
): { scripture: ResonanceFallbackCard[]; voices: ResonanceFallbackCard[] } {
  const q = tf(queryText);
  const score = (kind: 'scripture' | 'voice') => (p: FallbackPassage) => ({
    passageId: p.id,
    text: p.text,
    source: sourceFor(p, kind),
    bookId: p.book_id ?? '',
    translation: p.translation,
    similarity: boostedScore(queryText, p.text, cosine(q, tf(p.text))),
    kind,
  });
  const pick = (cards: ResonanceFallbackCard[]) => cards
    .filter((c) => c.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, perCategory);

  return {
    scripture: pick(scripture.map(score('scripture'))),
    voices: pick(voices.map(score('voice'))),
  };
}
