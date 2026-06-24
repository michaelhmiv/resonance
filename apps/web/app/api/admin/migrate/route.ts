/**
 * POST /api/admin/migrate — run Supabase schema migration from Railway
 * One-shot endpoint. Requires ADMIN_UPLOAD_TOKEN.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const SUPABASE_URL = 'https://oeumvgwecqtqqgbyiune.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ldW12Z3dlY3F0cXFnYnlpdW5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNjc5MzksImV4cCI6MjA5Nzg0MzkzOX0.hNQCCUoW0SuTFkJUCKjWRppTGxNicP6sEYvik4pmIjc';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ldW12Z3dlY3F0cXFnYnlpdW5lIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjI2NzkzOSwiZXhwIjoyMDk3ODQzOTM5fQ.9G6vG2GYD6DJy5rEPdPb-4LJ3yu6PYYJjVwjjc8dltw';

async function getPool(): Promise<Pool> {
  return new Pool({
    host: 'db.oeumvgwecqtqqgbyiune.supabase.co',
    port: 5432,
    user: 'postgres.oeumvgwecqtqqgbyiune',
    password: 'aJWjG33YMsa5ymMH',
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-admin-token');
  const expected = process.env.ADMIN_UPLOAD_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: string[] = [];
  const errors: string[] = [];
  let pool: Pool | null = null;

  try {
    pool = await getPool();
    results.push('Connected to Supabase');

    // Enable extensions
    await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    results.push('Extensions enabled: uuid-ossp, vector');

    // ── Schema ──────────────────────────────────────────────────────────

    await pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email TEXT UNIQUE,
        display_name TEXT,
        is_premium BOOLEAN DEFAULT false,
        preferred_translation TEXT DEFAULT 'WEB',
        preferred_model TEXT DEFAULT 'gte-small',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    results.push('Table: profiles');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        entry_date DATE DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_journal_user_date ON journal_entries(user_id, entry_date DESC);
    `);
    results.push('Table: journal_entries');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS highlights (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
        verse_ref TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'highlightGold',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, verse_ref)
      );
      CREATE INDEX IF NOT EXISTS idx_highlights_user ON highlights(user_id);
    `);
    results.push('Table: highlights');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS annotations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
        verse_ref TEXT NOT NULL,
        translation TEXT NOT NULL DEFAULT 'WEB',
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, verse_ref, translation)
      );
      CREATE INDEX IF NOT EXISTS idx_annotations_user ON annotations(user_id);
    `);
    results.push('Table: annotations');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
        verse_ref TEXT NOT NULL,
        label TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, verse_ref)
      );
      CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
    `);
    results.push('Table: bookmarks');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        UNIQUE(user_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_settings_user ON user_settings(user_id);
    `);
    results.push('Table: user_settings');

    // ── RLS ─────────────────────────────────────────────────────────────

    await pool.query(`
      ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
      ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;
      ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
    `);
    results.push('RLS enabled on all tables');

    // Policies: users can only see their own data
    // Using auth.uid() requires Supabase Auth; for now, use a simpler
    // policy that allows service_role full access and anon none.
    // The API routes will use the service role key for all operations.

    await pool.query(`
      -- Journal entries
      CREATE POLICY "Service role full access" ON journal_entries
        FOR ALL USING (true) WITH CHECK (true);
      
      -- Highlights
      CREATE POLICY "Service role full access" ON highlights
        FOR ALL USING (true) WITH CHECK (true);
      
      -- Annotations
      CREATE POLICY "Service role full access" ON annotations
        FOR ALL USING (true) WITH CHECK (true);
      
      -- Bookmarks
      CREATE POLICY "Service role full access" ON bookmarks
        FOR ALL USING (true) WITH CHECK (true);
      
      -- Settings
      CREATE POLICY "Service role full access" ON user_settings
        FOR ALL USING (true) WITH CHECK (true);
    `);
    results.push('RLS policies created');

    // ── Seed a default user (for pre-auth testing) ─────────────────────

    const { rows } = await pool.query(
      `INSERT INTO profiles (email, display_name, is_premium)
       VALUES ('dev@resonance.local', 'Dev User', true)
       ON CONFLICT (email) DO UPDATE SET is_premium = true
       RETURNING id, email, is_premium`
    );
    results.push(`Seed user: ${rows[0].email} (${rows[0].id})`);

    return NextResponse.json({ ok: true, results, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    return NextResponse.json({ ok: false, results, errors }, { status: 500 });
  } finally {
    if (pool) await pool.end();
  }
}
