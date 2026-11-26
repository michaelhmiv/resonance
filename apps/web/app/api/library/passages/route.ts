import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, statSync } from 'fs';

const VOLUME_PASSAGES = '/data/seeded_library/voice_passages.json';
const BUNDLED_PASSAGES = './data/seeded_library/voice_passages.json';

interface VoicePassage {
  id: number;
  book_id: string;
  chapter?: number | null;
  verse_start?: number | null;
  verse_end?: number | null;
  text: string;
  chunk_id?: number | null;
  division?: string | null;
}

let cachedByBookId: Map<string, VoicePassage[]> | null = null;
let cachedPassagesMtime = 0;
let cachedPassagesPath = '';

function loadPassagesByBook(): Map<string, VoicePassage[]> {
  const path = existsSync(VOLUME_PASSAGES) ? VOLUME_PASSAGES : BUNDLED_PASSAGES;
  const mtimeMs = statSync(path).mtimeMs;
  if (cachedByBookId && path === cachedPassagesPath && mtimeMs === cachedPassagesMtime) {
    return cachedByBookId;
  }
  const all = JSON.parse(readFileSync(path, 'utf-8')) as VoicePassage[];
  const byBook = new Map<string, VoicePassage[]>();
  for (const p of all) {
    let list = byBook.get(p.book_id);
    if (!list) {
      list = [];
      byBook.set(p.book_id, list);
    }
    list.push(p);
  }
  for (const list of byBook.values()) {
    list.sort((a, b) => a.id - b.id);
  }
  cachedByBookId = byBook;
  cachedPassagesMtime = mtimeMs;
  cachedPassagesPath = path;
  return cachedByBookId;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('bookId');
    if (!bookId) {
      return NextResponse.json({ error: 'bookId required' }, { status: 400 });
    }
    const passages = (loadPassagesByBook().get(bookId) ?? []).map((p) => ({
      id: p.id,
      book_id: p.book_id,
      chapter: p.chapter ?? null,
      verse_start: p.verse_start ?? null,
      verse_end: p.verse_end ?? null,
      text: p.text,
      translation: null,
      chunk_id: p.chunk_id ?? null,
      division: p.division ?? null,
    }));
    return NextResponse.json({ passages });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
