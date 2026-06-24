/**
 * POST /api/reflect — LLM-powered reflection prompts, cluster labels,
 * and "what shifted" narratives via OpenRouter.
 *
 * Strict system prompt: never writes prayers, never interprets Scripture,
 * never offers advice. Only generates gentle reflection questions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { REFLECTION_SYSTEM_PROMPT } from '@resonance/core';
import { rateLimit } from '../../../lib/ratelimit';

const DEFAULT_MODEL = process.env.RESONANCE_LLM_MODEL || 'deepseek/deepseek-v4-pro';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const rl = rateLimit(ip, 5, 60);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
    }

    const body = await req.json();
    const { action, excerpts, period1Excerpts, period2Excerpts } = body as {
      action: 'reflection_prompt' | 'cluster_label' | 'shift_narrative';
      excerpts?: string[];
      period1Excerpts?: string[];
      period2Excerpts?: string[];
    };

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenRouter API key not configured' }, { status: 503 });
    }

    let userPrompt = '';
    let systemContent = 'You are a concise assistant. Follow instructions exactly.';
    let maxTokens = 60;

    if (action === 'reflection_prompt') {
      const texts = (excerpts ?? []).filter((e) => e.trim().length >= 12).slice(0, 5).map((e) => e.slice(0, 200));
      if (texts.length === 0) {
        return NextResponse.json({ error: 'No sufficiently long excerpts provided' }, { status: 400 });
      }
      systemContent = REFLECTION_SYSTEM_PROMPT;
      userPrompt = `Journal excerpts:\n${texts.join('\n---\n')}\n\nReflection question:`;
    } else if (action === 'cluster_label') {
      const texts = (excerpts ?? []).filter((e) => e.trim().length >= 5).slice(0, 3).map((e) => e.slice(0, 150));
      if (texts.length === 0) {
        return NextResponse.json({ error: 'No excerpts provided' }, { status: 400 });
      }
      userPrompt = `Summarize these journal entries in 2-3 words. Output only the label:\n${texts.join('\n')}\n\nLabel:`;
      maxTokens = 15;
    } else if (action === 'shift_narrative') {
      const p1 = (period1Excerpts ?? []).slice(0, 3).map((e) => e.slice(0, 150));
      const p2 = (period2Excerpts ?? []).slice(0, 3).map((e) => e.slice(0, 150));
      if (p1.length === 0 || p2.length === 0) {
        return NextResponse.json({ error: 'Both period excerpts required' }, { status: 400 });
      }
      userPrompt = `Compare these two sets of journal entries. Write 2-3 sentences describing what shifted between them. Do not give advice.\n\nEarlier:\n${p1.join('\n')}\n\nLater:\n${p2.join('\n')}\n\nWhat shifted:`;
      maxTokens = 80;
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://resonance.up.railway.app',
        'X-Title': 'Resonance',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return NextResponse.json({ error: `OpenRouter error: ${response.status}`, model: DEFAULT_MODEL, detail: detail.slice(0, 500) }, { status: 502 });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();

    if (!text) {
      return NextResponse.json({
        text: fallbackReflectionText(action, excerpts, period1Excerpts, period2Excerpts),
        model: DEFAULT_MODEL,
        fallback: true,
        note: 'Model returned empty content; used deterministic no-advice fallback.',
      });
    }

    return NextResponse.json({ text, model: DEFAULT_MODEL, fallback: false });
  } catch {
    return NextResponse.json({ error: 'Internal error', model: DEFAULT_MODEL }, { status: 500 });
  }
}

function fallbackReflectionText(
  action: string,
  excerpts?: string[],
  period1Excerpts?: string[],
  period2Excerpts?: string[],
): string {
  if (action === 'cluster_label') {
    const text = (excerpts ?? []).join(' ').toLowerCase();
    if (/tired|exhausted|weary|rest/.test(text)) return 'Weariness and rest';
    if (/worry|worried|anxious|tomorrow/.test(text)) return 'Anxiety and tomorrow';
    if (/alone|lonely|forsaken/.test(text)) return 'Loneliness and presence';
    return 'Recurring reflections';
  }
  if (action === 'shift_narrative') {
    const earlier = (period1Excerpts ?? []).filter(Boolean).length;
    const later = (period2Excerpts ?? []).filter(Boolean).length;
    return `Earlier entries and later entries are both present (${earlier} earlier, ${later} later). What do you notice changing between them?`;
  }
  const text = (excerpts ?? []).join(' ').toLowerCase();
  if (/tired|exhausted|weary|rest/.test(text)) return 'Where do you notice the need for rest most clearly?';
  if (/worry|worried|anxious|tomorrow/.test(text)) return 'What does tomorrow seem to be carrying for you today?';
  if (/alone|lonely|forsaken/.test(text)) return 'Where does loneliness feel most present right now?';
  return 'What are you noticing beneath the surface today?';
}
