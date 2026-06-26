/**
 * POST /api/journal/verse-echoes
 *
 * Given today's verse text, count how many of the user's recent journal
 * entries touch the same concept(s). Returns the matching entry IDs plus
 * the shared concept(s) so the client can surface a single line under the
 * verse card: "Today's verse (Titus 2:11) has echoed in 2 of your past
 * entries — grace, salvation."
 *
 * The "echo" is a transparent concept-overlap, not a black-box similarity.
 * The same CONCEPTS table the lexical fallback uses for retrieval lives in
 * lib/resonance-fallback.ts; we re-export it here so the verse-echo logic
 * stays consistent with how the rest of the app explains "what resonated."
 *
 * Body: { verseText: string, verseRef?: string }
 * Returns: { count: number, entryIds: string[], concepts: string[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJournalEntries } from '../../../../lib/db';

// Concept taxonomy. Duplicated locally (rather than imported from
// resonance-fallback) because CONCEPTS is not exported and its internal
// `terms` values are typed as `string[]` only via Object.values. Keeping
// the same vocabulary as the lexical fallback ensures "what resonated"
// is consistent across the app.
const CONCEPTS: Record<string, string[]> = {
  rest: ['rest', 'weary', 'labor', 'labour', 'burden', 'heavy', 'tired', 'exhausted', 'sleep'],
  anxious: ['anxious', 'anxiety', 'worry', 'worried', 'careful', 'fear', 'afraid', 'tomorrow'],
  alone: ['alone', 'lonely', 'forsaken', 'near', 'presence', 'comfort', 'friend'],
  grief: ['grief', 'sorrow', 'weep', 'tears', 'mourning', 'brokenhearted', 'comfort'],
  wisdom: ['wisdom', 'understanding', 'discernment', 'guide', 'path', 'way'],
  forgiveness: ['forgive', 'forgiven', 'mercy', 'grace', 'sin', 'cleanse', 'salvation', 'save', 'savior', 'saviour', 'redeem'],
  hope: ['hope', 'wait', 'endure', 'light', 'darkness', 'renew', 'strength'],
  peace: ['peace', 'still', 'quiet', 'calm', 'trouble', 'heart', 'appear', 'appeared', 'bringing'],
};

const STOP_WORDS = new Set([
  'the', 'and', 'that', 'with', 'from', 'this', 'have', 'will', 'your', 'you',
  'are', 'was', 'were', 'for', 'but', 'not', 'all', 'any', 'can', 'just',
  'into', 'about', 'what', 'when', 'where', 'why', 'how', 'been', 'being',
  'feel', 'feeling', 'felt', 'really', 'very', 'like', 'need', 'want', 'know',
  'think', 'thought', 'thing', 'things', 'one', 'our', 'their', 'there', 'here',
  'god', 'lord', 'jesus', 'christ', 'amen',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function conceptsFor(text: string): Set<string> {
  const tokensSet = new Set(tokens(text));
  const out = new Set<string>();
  for (const [concept, terms] of Object.entries(CONCEPTS)) {
    if (terms.some((t) => tokensSet.has(t))) out.add(concept);
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      verseText?: string;
      verseRef?: string;
    };
    const verseText = (body.verseText ?? '').trim();
    if (verseText.length < 4) {
      return NextResponse.json({ count: 0, entryIds: [], concepts: [] });
    }

    const verseConcepts = conceptsFor(verseText);
    if (verseConcepts.size === 0) {
      // Verse has no concept overlap with our taxonomy — still return
      // a count, just no concepts to surface.
      return NextResponse.json({ count: 0, entryIds: [], concepts: [] });
    }

    // Limit to recent 30 entries to keep this fast; this is a glance
    // surface, not exhaustive search. If the user has more, the Patterns
    // page covers the deeper look.
    const entries = (await getJournalEntries()).slice(0, 30);
    const matched: string[] = [];
    const hitConcepts = new Set<string>();
    for (const e of entries) {
      const entryText = (e.text ?? '').toString();
      if (entryText.length < 12) continue;
      const entryConcepts = conceptsFor(entryText);
      // Match if the entry shares ANY concept with the verse.
      const overlap = [...verseConcepts].filter((c) => entryConcepts.has(c));
      if (overlap.length > 0) {
        matched.push(e.id);
        overlap.forEach((c) => hitConcepts.add(c));
      }
    }

    return NextResponse.json({
      count: matched.length,
      entryIds: matched,
      concepts: Array.from(hitConcepts).sort(),
    });
  } catch (err) {
    console.error('[verse-echoes] error:', err);
    return NextResponse.json(
      { count: 0, entryIds: [], concepts: [], error: 'Internal error' },
      { status: 500 },
    );
  }
}
