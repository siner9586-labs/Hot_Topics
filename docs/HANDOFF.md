# Handoff

A fresh worker should read, in order: `README.md`, `docs/ARCHITECTURE.md`, `docs/EXECUTION_STATE.md`, `docs/FINAL_REPORT.md`, this file, then only files implicated by the next deployment/source task.

## Verified checkpoint — 2026-08-21

- Current readiness: `DEPLOYMENT_READY`
- Verified deployment-config SHA: `3c2bff50d2068721882bf332ea99d58af07d5dd0`
- Full CI run `32458536320` / #29: success
- lint/typecheck/18 tests/build/security/dependency-audit/real-data-smoke/visual: pass
- Wrangler aligned to `4.125.0` for the current Cloudflare Vite peer requirement
- Cloudflare production workflow is enabled on relevant `main` pushes and manual dispatch
- Deployment status is mirrored to the commit context `cloudflare/production`

## Last real production attempt

GitHub Actions run `32458919022` reached the explicit Cloudflare credential gate and failed because both required inputs are absent:

- `CLOUDFLARE_API_TOKEN` — missing from GitHub Actions secrets
- `CLOUDFLARE_ACCOUNT_ID` — missing from GitHub Actions secret/repository variable

No Cloudflare write step ran after that failure. Do not claim D1, Queues, Workers, Cron triggers, workers.dev hostname, custom domain, or a production URL as deployed yet.

## Next bounded task

After the owner configures the two GitHub Actions values above, trigger `Deploy Cloudflare` again (or make a relevant `main` push). The workflow is already prepared to:

1. verify Cloudflare authentication;
2. ensure `hot-topics-pipeline` and `hot-topics-pipeline-dlq` Queues;
3. provision/bind the `hot-topics` D1 database;
4. deploy the pipeline Worker and its UTC 3-hour Cron schedule;
5. apply D1 migrations and re-deploy;
6. build/deploy the Astro web Worker with the `API -> hot-topics-pipeline` service binding;
7. list Cloudflare deployment records for auditability.

Only change the machine-readable status to `PRODUCTION_DEPLOYED` after the workflow succeeds and HTTP checks confirm the homepage, `/api/v1`, topic routes and health/status endpoints. Configure a custom domain only after a real Worker deployment exists and the desired hostname is explicitly known.

Independently, restore compliant source breadth to at least CN 3 / GLOBAL 4 without bypassing login, CAPTCHA, anti-bot or ToS restrictions.
