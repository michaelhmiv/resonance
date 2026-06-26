#!/usr/bin/env bash
# Resonance cron — processes pending adaptive resonance jobs every 5 minutes.
# Usage: Add as scheduled job in Railway or run via external cron.
# Requires: BASE_URL, RESONANCE_JOB_SECRET env vars set

set -euo pipefail

BASE_URL="${RESONANCE_BASE_URL:-https://resonanceweb-production-276b.up.railway.app}"
SECRET="${RESONANCE_JOB_SECRET:?RESONANCE_JOB_SECRET must be set}"

echo "[$0] Triggering resonance job processor at $BASE_URL..."

# Process up to 10 pending jobs
curl -sS -X POST "$BASE_URL/api/resonance/jobs" \
  -H "Content-Type: application/json" \
  -H "x-resonance-job-secret: $SECRET" \
  -d '{"limit": 10}'
