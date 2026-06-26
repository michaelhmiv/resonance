# Resonance Cron

## Job Processor Scheduling

The adaptive resonance system uses a job queue in Supabase (`resonance_jobs`). Jobs are created when users write journal entries, highlights, or notes. These jobs must be processed asynchronously to compute embeddings, find edges, and update caches.

## Recommended: Railway Cron

Railway is the preferred platform for the cron job because:
- **Co-located**: The Next.js app and cron job share the same environment
- **Transparent**: Logs visible in Railway dashboard
- **Simple**: Single command invocation, no Supabase functions or extensions needed
- **Flexible**: Easy to adjust schedule or trigger manually

### Setup

1. Set `RESONANCE_JOB_SECRET` in your Railway environment variables (same value the app uses)
2. Create a scheduled job in Railway that runs every 5 minutes:

```bash
RESONANCE_BASE_URL=https://resonanceweb-production-276b.up.railway.app \
RESONANCE_JOB_SECRET=<your-secret> \
  bash scripts/resonance-cron.sh
```

Or use the one-liner directly:

```bash
curl -sS -X POST "$BASE_URL/api/resonance/jobs" \
  -H "Content-Type: application/json" \
  -H "x-resonance-job-secret: $SECRET" \
  -d '{"limit": 10}'
```

### Alternative: GitHub Actions Cron

If Railway cron is not available, use GitHub Actions with a workflow that hits the endpoint every 5 minutes. This works but introduces external dependency on GitHub's infrastructure.

### Alternative: Supabase pg_cron

Supabase has a `pg_cron` extension enabled on some plans. You could create a cron job inside Postgres that calls a Supabase Edge Function, which then hits the Next.js API. This keeps everything in Supabase but is more complex and couples the job processor to the database. Only use this if Railway cron is unavailable.

## What the cron does

1. POSTs to `/api/resonance/jobs` with the secret
2. The endpoint processes up犁 (up to) 10 pending jobs (journal resonance, highlight resonance, etc.)
3. If `maintenance: true` is passed, also runs `runResonanceMaintenance()`

## Monitoring

- Check Railway logs for the cron job output
- Check `/api/health` — the `gitSha` reflects the live deployment commit
- Verify jobs are being consumed: query `resonance_jobs` table for `status = 'pending'`
