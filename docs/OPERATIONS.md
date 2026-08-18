# Operations

## Deployment

1. Configure GitHub environment `production` secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
2. Run **Deploy Cloudflare** workflow manually.
3. Workflow creates Queue/DLQ, deploys pipeline, applies D1 migrations, redeploys pipeline, then deploys Astro web.
4. Verify `/health`, `/api/v1/source-health`, homepage and one Topic URL.

Wrangler 4.118 uses current Cloudflare automatic resource provisioning for D1 when a binding has a database name but no committed resource ID. No account-specific ID is stored in Git.

## Source failure/schema change

A failing adapter is isolated with `Promise.all` semantics and source status. Challenge/login/CAPTCHA pages are rejected before parsing. A schema parser yielding too few items becomes `schema_changed` or `degraded`; do not silently substitute fixture data.

## Queue failure

Scheduled collection attempts Queue. If Queue send fails, the Worker falls back to direct processing for that run. Consumer retries three times; Cloudflare sends exhausted messages to `hot-topics-pipeline-dlq`.

## Cron

Cloudflare Cron uses UTC. The configured UTC hours `01,04,07,10,13,16,19,22` map to Beijing `09,12,15,18,21,00,03,06`, which is the requested three-hour phase without duplicate/missing runs.

## D1 migration/rollback

Migrations are additive SQL in `migrations/`. Before destructive schema work, export/backup D1. Roll application code back first; do not reverse a data migration without an explicit reviewed down-migration plan.

## Credentials

Secrets are never committed. Rotate in Cloudflare/GitHub environment, rerun deployment, then revoke the old credential. Optional source API keys are Worker secrets, not `vars`.

## Retention

Topic snapshots are long-lived core assets. Raw payloads are designed for a 30-day operational retention window; implement scheduled pruning only after production storage volume is observed so provenance is not prematurely discarded.
