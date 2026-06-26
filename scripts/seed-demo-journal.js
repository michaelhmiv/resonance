#!/usr/bin/env node
/**
 * scripts/seed-demo-journal.js
 *
 * Wipes the dev user's journal entries and replaces them with 5
 * realistic entries that span the concept taxonomy. The goal is a
 * visually grounded QA pass: real-looking content, varied concepts,
 * dated over the past week so the date divider on the journal screen
 * has things to say.
 *
 * Run from apps/web: `node ../../scripts/seed-demo-journal.js`
 * Or via npm: `npm run seed:demo` (added in package.json)
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in
 * the env (.env.local). Idempotent: deletes first, then inserts.
 */

const path = require('path');
const fs = require('fs');

// Load env from apps/web/.env.local
const envPath = path.resolve(__dirname, '..', 'apps', 'web', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const { createClient } = require(path.resolve(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DEMO_USER_EMAIL = 'dev@resonance.local';

const ENTRIES = [
  {
    days_ago: 1,
    text: "Hard day at work. Everything felt off. But I keep thinking about the line from the psalm about God being near to the brokenhearted. I want to believe that. I want to stop bracing.",
  },
  {
    days_ago: 2,
    text: "Quiet morning. Coffee on the porch. Read the Sermon on the Mount slowly — the kind of slowly where one verse keeps you sitting for an hour. 'Blessed are the meek.' I have been loud and proud all week. Lord, have mercy.",
  },
  {
    days_ago: 3,
    text: "Father's anniversary coming. Missing him. The grief doesn't get smaller, it just gets more familiar. I sat with the promise that God will wipe every tear from their eyes. Not yet. But one day.",
  },
  {
    days_ago: 4,
    text: "Worried about the move. The mortgage paperwork, the school district, the in-laws. None of it I can control. Proverbs 3:5-6 came up in evening prayer. 'Trust in the Lord with all your heart.' Easier read than done.",
  },
  {
    days_ago: 6,
    text: "Went for a long walk at the reservoir. Watched a heron take off across the water. Thought about how the Spirit moves where it will. No announcement, no permission asked. I want to live more like that — patient, unhurried, present.",
  },
];

async function main() {
  // 1. Find the dev user id
  const { data: profile, error: profileErr } = await sb
    .from('profiles')
    .select('id')
    .eq('email', DEMO_USER_EMAIL)
    .single();
  if (profileErr || !profile) {
    console.error(`Could not find dev user profile (${DEMO_USER_EMAIL}):`, profileErr);
    process.exit(1);
  }
  const userId = profile.id;
  console.log(`Found dev user: ${userId}`);

  // 2. Wipe existing entries for that user
  const { error: delErr, count: delCount } = await sb
    .from('journal_entries')
    .delete({ count: 'exact' })
    .eq('user_id', userId);
  if (delErr) {
    console.error('Failed to wipe existing entries:', delErr);
    process.exit(1);
  }
  console.log(`Wiped ${delCount ?? '?'} existing entries.`);

  // 3. Insert demo entries with staggered created_at
  const now = Date.now();
  const rows = ENTRIES.map((e) => {
    const ts = new Date(now - e.days_ago * 24 * 60 * 60 * 1000).toISOString();
    return {
      user_id: userId,
      text: e.text,
      created_at: ts,
      updated_at: ts,
      entry_date: ts.slice(0, 10),
    };
  });

  const { data: inserted, error: insErr } = await sb
    .from('journal_entries')
    .insert(rows)
    .select('id, text');
  if (insErr) {
    console.error('Failed to insert demo entries:', insErr);
    process.exit(1);
  }
  console.log(`Inserted ${inserted.length} demo entries.`);
  for (const e of inserted) {
    console.log(`  ${e.id.slice(0, 8)}  ${e.text.slice(0, 64)}…`);
  }
  console.log('\nDone. Refresh /journal to see them.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
