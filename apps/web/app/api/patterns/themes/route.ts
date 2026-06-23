/**
 * GET /api/patterns/themes — TF-IDF keyword extraction from recent journal entries.
 */

import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';

// Simple TF-IDF implementation for web (doesn't import from packages/core to avoid path issues)
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that',
  'these', 'those', 'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'when', 'where',
  'why', 'how', 'all', 'each', 'every', 'some', 'any', 'no', 'not', 'as', 'if', 'so', 'than',
  'too', 'very', 'just', 'also', 'only', 'about', 'into', 'from', 'up', 'out', 'over', 'after',
  'am', 'feel', 'feeling', 'really', 'one', 'don', 'didn', 'wasn', 'isn', 'aren', 'won',
]);

interface KeywordScore {
  word: string;
  score: number;
}

export async function GET() {
  try {
    const db = getDb();
    const entries = db.prepare('SELECT text FROM journal_entries ORDER BY created_at DESC LIMIT 50').all() as { text: string }[];

    if (entries.length === 0) {
      return NextResponse.json({ themes: [] });
    }

    // Tokenize all entries
    const documents: string[][] = entries.map(e =>
      e.text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))
    );

    // Build document frequency
    const docFreq = new Map<string, number>();
    for (const doc of documents) {
      const unique = new Set(doc);
      for (const word of unique) {
        docFreq.set(word, (docFreq.get(word) || 0) + 1);
      }
    }

    // Build term frequency × IDF
    const tf = new Map<string, number>();
    for (const doc of documents) {
      for (const word of doc) {
        tf.set(word, (tf.get(word) || 0) + 1);
      }
    }

    const N = documents.length;
    const themes: KeywordScore[] = [];
    for (const [word, freq] of tf) {
      const df = docFreq.get(word) || 1;
      const idf = Math.log(N / df) + 1;
      const score = freq * idf;
      themes.push({ word, score });
    }

    themes.sort((a, b) => b.score - a.score);

    return NextResponse.json({ themes: themes.slice(0, 8) });
  } catch {
    return NextResponse.json({ themes: [] });
  }
}
