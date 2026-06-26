# Resonance Operational Runbook

This runbook is for safe diagnostics and verification. It does not authorize destructive actions.

## Hard safety rules

- Do not run `railway up`; GitHub auto-deploy is the deployment path.
- Do not call Railway `*Delete`, `*Remove`, or destructive mutations as probes.
- Do not delete vector/model directories unless Michael explicitly approves the exact target.
- Do not mutate Railway variables during an audit unless explicitly asked.
- Do not trust `/api/health.gitSha` as the deploy signal; test actual behavior.

## Live URL

Current production URL:

```text
https://resonanceweb-production-276b.up.railway.app
```

## Safe live checks

```bash
BASE=https://resonanceweb-production-276b.up.railway.app
curl -sS "$BASE/api/health"
curl -sS "$BASE/api/vectors/status"
```

For auth-gated routes, use the local env secret as a cookie only in trusted environments:

```bash
set -a; . /data/.hermes/.env; [ -f /data/resonance/apps/web/.env.local ] && . /data/resonance/apps/web/.env.local; set +a
curl -sS -H "Cookie: resonance-auth=$RESONANCE_AUTH_SECRET" "$BASE/api/journal/entries"
```

## Vector diagnostics

Safe status route:

```bash
curl -sS "$BASE/api/vectors/status"
```

Admin diagnostic routes require `X-Admin-Token` and should be read-only:

```bash
curl -sS -H "x-admin-token: $ADMIN_UPLOAD_TOKEN" "$BASE/api/admin/diag-manifest"
curl -sS -H "x-admin-token: $ADMIN_UPLOAD_TOKEN" "$BASE/api/admin/diag-vectors"
```

Known issue from 2026-06-26 audit:

- active pplx manifest exists but lacks `passage_ids` and `passage_sources`
- route falls back to `/data/seeded_library/vectors_gte-small_manifest.json`
- future ingestion should make active manifests self-contained

## Railway read-only GraphQL pattern

Use `RAILWAY_PERSONAL_TOKEN` and known project id for read-only metadata/logs.

```text
project id: aa6c2417-39f4-44b8-bb51-334c570ba1c7
web service id: 4e72b4f8-3981-4961-aded-2c22200297d5
environment id: 76795aa3-eab0-4a7b-a38a-e5ffff6bfaf6
```

Read-only queries: `me`, `project`, `deployments`, `deploymentLogs`, `buildLogs`.

Never probe destructive scope.

## Local verification commands

```bash
cd /data/resonance
npm run typecheck:web
npm run typecheck:packages
npm run build --workspace=@resonance/web
```

Current note: `npm run --workspace apps/web typecheck` may fail because that workspace pins TypeScript 6 and complains about deprecated `baseUrl`. Root `npm run typecheck:web` is the verified command.

## Performance checks

Quick endpoint timing:

```bash
for path in / /journal /word /api/health /api/vectors/status /api/journal/entries; do
  printf '%-24s ' "$path"
  curl -sS -o /dev/null -w '%{time_total}\n' -H "Cookie: resonance-auth=$RESONANCE_AUTH_SECRET" "$BASE$path"
done
```

Resonance-specific checks should verify:

- Journal load does not fire one resonance request per historical entry.
- Repeated `✦` on same entry uses cache when implemented.
- Cold concurrent resonance does not duplicate vector model load after in-flight promise fix.

## Supabase notes

Do not rely on a `run_sql` RPC from app routes. The live audit showed missing `public.run_sql(sql)` causing 404 log spam. Schema changes belong in migrations.
