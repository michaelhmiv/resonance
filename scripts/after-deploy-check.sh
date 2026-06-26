#!/usr/bin/env bash
# after-deploy-check.sh — verify Railway deployment after pushing to main
# Usage: ./scripts/after-deploy-check.sh [BASE_URL]

set -euo pipefail

BASE_URL="${1:-https://resonanceweb-production-276b.up.railway.app}"
LOCAL_SHA=$(cd "$(dirname "$0")/.." && git rev-parse HEAD)

echo "=== Resonance Deployment Check ==="
echo "Expected commit: $LOCAL_SHA"
echo "Testing: $BASE_URL/api/health"
 echo "Fetching /api/health..."
RESPONSE=$(curl -sS "$BASE_URL/api/health" || true)

if [ -z "$RESPONSE" ]; then
  echo "❌ FAILED: Could not reach $BASE_URL/api/health"
  exit 1
fi

GIT_SHA=$(echo "$RESPONSE" | grep -o '"gitSha":"[^"]*"' | cut -d'"' -f4 || true)

echo "Live gitSha:     $GIT_SHA"

if [ "$GIT_SHA" = "0a3ec15" ]; then
  echo "❌ FAILED: Still running old hardcoded build (0a3ec15). Deployment may be pending or stuck."
  exit 1
fi

if [ "$GIT_SHA" = "unknown" ]; then
  echo "⚠️  WARNING: gitSha is 'unknown' — check RAILWAY_GIT_COMMIT_SHA is set in Railway env."
  exit 0
fi

if [ "$GIT_SHA" = "$LOCAL_SHA" ]; then
  echo "✅ SUCCESS: Deployment matches local commit."
else
  echo "⚠️  WARNING: Live SHA ($GIT_SHA) does not match local ($LOCAL_SHA). Deployment may still be in progress."
fi
