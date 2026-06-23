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
    const refs = map.get(ref) || [];

    return NextResponse.json({ refs });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
