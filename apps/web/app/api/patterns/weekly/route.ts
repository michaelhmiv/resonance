/**
 * GET /api/patterns/weekly
 *
 * Returns the count of journal entries from the past 7 days, the rolling
 * date range, and up to 5 excerpts (truncated to 150 chars). When there are
 * entries and OPENROUTER_API_KEY is set, also asks the LLM for a 2-3 word
 * theme label. Label generation is best-effort and never fails the request.
 */

import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';

type TextRow = { text: string };

const WEEK_SECONDS = 7 * 24 * 60 * 60;

export async function GET() {
  try {
    const db = getDb();

    const endSec = Math.floor(Date.now() / 1000);
    const startSec = endSec - WEEK_SECONDS;

    const rows = db
      .prepare<unknown[], TextRow>(
        'SELECT text FROM journal_entries WHERE created_at >= ? ORDER BY created_at DESC',
      )
      .all(startSec);

    const excerpts = rows
      .map((r) => r.text)
      .slice(0, 5)
      .map((t) => t.slice(0, 150));

    const response: {
      entryCount: number;
      dateRange: { start: string; end: string };
      excerpts: string[];
      themeLabel?: string;
    } = {
      entryCount: rows.length,
      dateRange: {
        start: new Date(startSec * 1000).toISOString(),
        end: new Date(endSec * 1000).toISOString(),
      },
      excerpts,
    };

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (response.entryCount > 0 && apiKey) {
      try {
        const model = process.env.LLM_MODEL || 'qwen/qwen-2.5-72b-instruct';
        const promptText = `Summarize these journal entries in 2-3 words. Output only the label:\n${excerpts.join('\n')}\nLabel:`;

        const llmResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://resonance.up.railway.app',
            'X-Title': 'Resonance',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: promptText }],
            max_tokens: 15,
          }),
        });

        if (llmResp.ok) {
          const data = await llmResp.json();
          const label: string | undefined = data?.choices?.[0]?.message?.content?.trim();
          if (label) response.themeLabel = label;
        }
      } catch {
        // Best-effort: a label failure must not break the weekly summary.
      }
    }

    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
