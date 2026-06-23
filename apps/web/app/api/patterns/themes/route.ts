import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getJournalEntries } from '../../../../lib/db';

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

export async function GET() {
  try {
    const entries = getJournalEntries().slice(0, 50);

    if (entries.length === 0) {
      return NextResponse.json({ themes: [] });
    }

    const documents: string[][] = entries.map(e =>
      e.text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))
    );

    const docFreq = new Map<string, number>();
    for (const doc of documents) {
      const unique = new Set(doc);
      for (const word of unique) {
        docFreq.set(word, (docFreq.get(word) || 0) + 1);
      }
    }

    const tf = new Map<string, number>();
    for (const doc of documents) {
      for (const word of doc) {
        tf.set(word, (tf.get(word) || 0) + 1);
      }
    }

    const N = documents.length;
    const themes: { word: string; score: number }[] = [];
    for (const [word, freq] of tf) {
      const df = docFreq.get(word) || 1;
      const idf = Math.log(N / df) + 1;
      themes.push({ word, score: freq * idf });
    }

    themes.sort((a, b) => b.score - a.score);

    return NextResponse.json({ themes: themes.slice(0, 8) });
  } catch {
    return NextResponse.json({ themes: [] });
  }
}
