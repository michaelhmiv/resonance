import { NextResponse } from 'next/server';
import { getMetricsSnapshot } from '../../../../lib/resonance-metrics';
import { getCacheStats } from '../../../../lib/user-vector-store';
import { getLastLoadError } from '../../../../lib/corpus-index';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = getMetricsSnapshot();
  // Enrich with user vector cache stats (not a metric counter, but useful)
  const userCache = getCacheStats();
  const lastLoadErr = getLastLoadError();
  return NextResponse.json({
    ...snapshot,
    user_vector_cache: userCache,
    ...(lastLoadErr ? { hnsw_load_error: lastLoadErr } : {}),
  });
}
