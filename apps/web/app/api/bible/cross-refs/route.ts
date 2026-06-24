/**
 * GET /api/bible/cross-refs — return cross-reference targets for a reference.
 *
 * Query params:
 *   ref = "Genesis 1:1"   (URL-encode the space, e.g. ?ref=Genesis+1:1)
 *
 * cross_references.json is an array of { from_ref, to_ref } entries. This
 * endpoint collects every to_ref whose from_ref matches the query and caches
 * the entire dataset as a Map<string, string[]> after the first request.
 *
 * Response:
 *   { refs: string[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';

const CROSS_REFS = './data/seeded_library/cross_references.json';

interface CrossReference {
  from_ref: string;
  to_ref: string;
  [key: string]: unknown;
}

// Module-level cache (lazy loaded on first request).
let cachedCrossRefs: Map<string, string[]> | null = null;

// The cross_references.json uses abbreviated book names (e.g. "Exod"),
// but the client sends full names (e.g. "Exodus"). Normalize on lookup.
const BOOK_NAME_NORMALIZE: Record<string, string> = {
  Exodus: 'Exod',
};

function normalizeRef(ref: string): string {
  for (const [full, abbr] of Object.entries(BOOK_NAME_NORMALIZE)) {
    if (ref.startsWith(full + ' ')) {
      return abbr + ref.slice(full.length);
    }
  }
  return ref;
}

function loadCrossRefs(): Map<string, string[]> {
  if (!cachedCrossRefs) {
    const data: CrossReference[] = JSON.parse(readFileSync(CROSS_REFS, 'utf-8'));
    const map = new Map<string, string[]>();
    for (const entry of data) {
      const arr = map.get(entry.from_ref);
      if (arr) {
        arr.push(entry.to_ref);
      } else {
        map.set(entry.from_ref, [entry.to_ref]);
      }
    }
    cachedCrossRefs = map;
  }
  return cachedCrossRefs as Map<string, string[]>;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ref = searchParams.get('ref') || '';

    if (!ref) {
      return NextResponse.json({ refs: [] });
    }

    const map = loadCrossRefs();
    const refs = map.get(normalizeRef(ref)) || [];

    return NextResponse.json({ refs });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// POST /api/bible/cross-refs — batched: send { refs: ["Gen 1:1", "Matt 5:3"] }
// Returns { refs: { "Gen 1:1": [...], "Matt 5:3": [...] } }
export async function POST(request: NextRequest) {
  try {
    const { refs: requestedRefs } = (await request.json()) as { refs?: string[] };

    if (!requestedRefs || requestedRefs.length === 0) {
      return NextResponse.json({ refs: {} });
    }

    const map = loadCrossRefs();
    const result: Record<string, string[]> = {};
    for (const ref of requestedRefs) {
      const targets = map.get(normalizeRef(ref));
      if (targets && targets.length > 0) {
        result[ref] = targets;
      }
    }

    return NextResponse.json({ refs: result });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
