/**
 * GET /api/patterns/weekly — weekly journal roundup with optional LLM theme label.
 */

import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';

export async function GET() {
  try {
    const db = getDb();
    const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
    const entries = db.prepare('SELECT text, created_at FROM journal_entries WHERE created_at >= ? ORDER BY created_at DESC').all(weekAgo) as { text: string; created_at: number }[];

    const excerpts = entries.slice(0, 5).map(e => e.text.slice(0, 150));
    const entryCount = entries.length;
    const startDate = new Date(weekAgo * 1000).toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];

    let themeLabel: string | undefined;
    if (entryCount > 0 && process.env.OPENROUTER_API_KEY) {
      try {
        const prompt = `Summarize these journal entries in 2-3 words. Output only the label:\n${excerpts.join('\n')}\n\nLabel:`;
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'X-Title': 'Resonance',
          },
          body: JSON.stringify({
            model: process.env.LLM_MODEL || 'qwen/qwen-2.5-72b-instruct',
            messages: [
              { role: 'system', content: 'You are a concise assistant. Follow instructions exactly.' },
              { role: 'user', content: prompt },
            ],
            max_tokens: 15,
            temperature: 0.7,
          }),
        });
        if (response.ok) {
          const data = await response.json();
          themeLabel = data.choices?.[0]?.message?.content?.trim();
        }
      } catch {
        // Theme label is best-effort
      }
    }

    return NextResponse.json({
      entryCount,
      dateRange: { start: startDate, end: endDate },
      excerpts,
      themeLabel,
    });
  } catch {
    return NextResponse.json({ entryCount: 0, dateRange: { start: '', end: '' }, excerpts: [] });
  }
}
