import { NextResponse, type NextRequest } from 'next/server';
import { getJournalEntries } from '../../../../lib/db';
import { rateLimit } from '../../../../lib/ratelimit';

export async function GET(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const rl = rateLimit(ip, 10, 60);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Rate limit' }, { status: 429 });
    }

    const entries = getJournalEntries();
    const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
    const weekEntries = entries.filter(e => e.created_at >= weekAgo);

    const excerpts = weekEntries.slice(0, 5).map(e => e.text.slice(0, 150));
    const entryCount = weekEntries.length;
    const startDate = new Date(weekAgo * 1000).toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];

    let themeLabel: string | undefined;
    if (entryCount > 0 && process.env.OPENROUTER_API_KEY) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'X-Title': 'Resonance',
          },
          body: JSON.stringify({
            model: process.env.RESONANCE_LLM_MODEL || 'deepseek/deepseek-v4-pro',
            messages: [
              { role: 'system', content: 'You are a concise assistant.' },
              { role: 'user', content: `Summarize these journal entries in 2-3 words. Output only the label:\n${excerpts.join('\n')}\n\nLabel:` },
            ],
            max_tokens: 15,
          }),
        });
        if (response.ok) {
          const data = await response.json();
          themeLabel = data.choices?.[0]?.message?.content?.trim();
        }
      } catch { /* best-effort */ }
    }

    return NextResponse.json({ entryCount, dateRange: { start: startDate, end: endDate }, excerpts, themeLabel });
  } catch {
    return NextResponse.json({ entryCount: 0, dateRange: { start: '', end: '' }, excerpts: [] });
  }
}
