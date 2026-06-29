import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://oeumvgwecqtqqgbyiune.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEV_USER_ID = '00000000-0000-0000-0000-000000000000';

type PatternFeedbackAction = 'opened' | 'saved' | 'dismissed' | 'not_useful' | 'show_less';
type PatternFeedbackSurface = 'echo' | 'theme' | 'trail' | 'returned_to' | 'quiet_question';

interface PatternFeedbackRequest {
  action?: PatternFeedbackAction;
  surface?: PatternFeedbackSurface;
  itemId?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  edgeId?: string;
  metadata?: Record<string, unknown>;
}

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabase;
}

async function getUserId(): Promise<string> {
  const sb = getSupabase();
  try {
    const { data } = await sb.from('profiles').select('id').eq('email', 'dev@resonance.local').single();
    return data?.id || DEV_USER_ID;
  } catch {
    return DEV_USER_ID;
  }
}

function isAction(value: unknown): value is PatternFeedbackAction {
  return value === 'opened' || value === 'saved' || value === 'dismissed' || value === 'not_useful' || value === 'show_less';
}

function isSurface(value: unknown): value is PatternFeedbackSurface {
  return value === 'echo' || value === 'theme' || value === 'trail' || value === 'returned_to' || value === 'quiet_question';
}

function eventTypeFor(surface: PatternFeedbackSurface, action: PatternFeedbackAction): string {
  return `patterns.${surface}.${action}`;
}

function edgeStateFor(action: PatternFeedbackAction): 'active' | 'reinforced' | 'dismissed' | null {
  if (action === 'opened') return 'active';
  if (action === 'saved') return 'reinforced';
  if (action === 'dismissed' || action === 'not_useful' || action === 'show_less') return 'dismissed';
  return null;
}

async function appendFeedbackEvent(input: {
  userId: string;
  body: Required<Pick<PatternFeedbackRequest, 'action' | 'surface' | 'itemId'>> & PatternFeedbackRequest;
}) {
  const sb = getSupabase();
  const payload = {
    surface: input.body.surface,
    item_id: input.body.itemId,
    edge_id: input.body.edgeId ?? null,
    source_node_id: input.body.sourceNodeId ?? null,
    target_node_id: input.body.targetNodeId ?? null,
    metadata: input.body.metadata ?? {},
  };

  try {
    const { data, error } = await sb.from('resonance_events')
      .insert({
        user_id: input.userId,
        event_type: eventTypeFor(input.body.surface, input.body.action),
        source_node_id: input.body.sourceNodeId ?? null,
        source_type: input.body.surface,
        source_id: input.body.itemId,
        payload,
      })
      .select()
      .single();
    if (error) return { ok: false, skipped: true, reason: error.message };
    return { ok: true, event: data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, skipped: true, reason: message };
  }
}

async function updateEdgeState(input: {
  body: Required<Pick<PatternFeedbackRequest, 'action' | 'surface' | 'itemId'>> & PatternFeedbackRequest;
}) {
  const nextState = edgeStateFor(input.body.action);
  if (!nextState) return { ok: true, skipped: true, reason: 'no_edge_state_change' };
  if (!input.body.edgeId && !input.body.sourceNodeId) return { ok: true, skipped: true, reason: 'no_edge_identifier' };

  const sb = getSupabase();
  const patch: Record<string, unknown> = {
    state: nextState,
    last_seen_at: new Date().toISOString(),
  };

  if (nextState === 'reinforced') {
    patch.confidence = 1;
  }

  try {
    let query = sb.from('resonance_edges').update(patch);
    if (input.body.edgeId) {
      query = query.eq('id', input.body.edgeId);
    } else {
      query = query.eq('source_node_id', input.body.sourceNodeId!);
      if (input.body.targetNodeId) query = query.eq('target_node_id', input.body.targetNodeId);
    }
    const { data, error } = await query.select();
    if (error) return { ok: false, skipped: true, reason: error.message };
    return { ok: true, edges: data ?? [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, skipped: true, reason: message };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as PatternFeedbackRequest;
    if (!isAction(body.action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    if (!isSurface(body.surface)) {
      return NextResponse.json({ error: 'Invalid surface' }, { status: 400 });
    }
    if (!body.itemId || typeof body.itemId !== 'string') {
      return NextResponse.json({ error: 'itemId required' }, { status: 400 });
    }

    const normalized = body as Required<Pick<PatternFeedbackRequest, 'action' | 'surface' | 'itemId'>> & PatternFeedbackRequest;
    const userId = await getUserId();
    const [eventResult, edgeResult] = await Promise.all([
      appendFeedbackEvent({ userId, body: normalized }),
      updateEdgeState({ body: normalized }),
    ]);

    return NextResponse.json({
      ok: true,
      event: eventResult,
      edge: edgeResult,
      degraded: eventResult.ok === false || edgeResult.ok === false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to record feedback';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
