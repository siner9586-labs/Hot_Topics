# Handoff

A fresh worker should read, in order: `README.md`, `docs/ARCHITECTURE.md`, `docs/EXECUTION_STATE.md`, `docs/FINAL_REPORT.md`, `artifacts/final_status.json`, this file, then only files implicated by the next bounded task.

## Verified checkpoint — 2026-08-22

- Repository: `siner9586-labs/Hot_Topics`
- Current status: `PRODUCTION_REFRESH_REPAIRED_VERIFIED`
- Verified deployment SHA: `aefa23afb0e09052c88ab87ff850bf97b1b98452`
- Cloudflare deployment + real-data acceptance run: `32583510911` — success
- Latest verified production collection: `manual_20260822160341`
- Collection result: `PARTIAL`, 420 real raw items, CN 60 snapshots, GLOBAL 90 snapshots
- Production source coverage: CN 4 working sources, GLOBAL 6 working sources
- Custom domain: `https://hots.ccwu.cc/` — rendered CN/GLOBAL rankings verified from GitHub-hosted runner

## Refresh incident and fix

The stale-site incident was not caused by the Cron expression or by source collection. A pre-fix production run collected 422 real items and completed CN=60 snapshots, but GLOBAL remained at 0 and the run stayed `PROCESSING`.

The repaired runtime now uses:

- Queue `max_batch_size=1` so CN and GLOBAL receive independent consumer invocations;
- Queue `max_concurrency=1` so the two D1-heavy regional jobs do not contend;
- Queue `max_retries=5` with the existing DLQ;
- precomputed lexical clustering features instead of recomputing seed token/ngram features for every candidate pair;
- no explicit `limits.cpu_ms`, because the current Workers Free production plan rejects paid-plan CPU overrides.

This was verified in production: CN reached 60, then GLOBAL advanced from 0 through intermediate snapshot counts to 90, after which the run became terminal `PARTIAL`.

## Other freshness protections already active

- Raw source-item identity is separate from run-scoped observation identity, so recurring hot items are stored again on each new run.
- Current rankings select snapshots from the newest completed production run, not each topic's independent historical latest snapshot.
- Ranking APIs expose real `data_as_of` / stale state and use `no-store`.
- Rendered HTML uses real snapshot time and is non-cacheable.
- Primary Cron: `0 1,4,7,10,13,16,19,22 * * *` UTC.
- Watchdog Cron: `30 * * * *` UTC, with stale-state gating.

## Verification that must remain in CI/deploy

Do not weaken the current acceptance gates. A production deployment is only successful when all of the following pass:

1. Cloudflare authentication and Worker deployment;
2. D1 migrations and Queue bindings;
3. protected real collection trigger;
4. terminal run with CN > 0 and GLOBAL > 0 snapshots;
5. production working-source floors CN >= 4 and GLOBAL >= 5;
6. rendered custom-domain home/CN/GLOBAL pages contain non-empty topic lists;
7. commit status `cloudflare/production` becomes success.

## Current non-blocking source degradation

At the latest run:

- 36Kr RSS: schema changed / no items;
- Bilibili: HTTP 412;
- Google News: HTTP 503;
- GitHub Trending: challenge page.

Do not bypass provider anti-bot, login, CAPTCHA, or access controls to restore those sources. Healthy source coverage already passes the production floor.

## Remaining narrow evidence item

The repaired pipeline has been exercised end-to-end by a protected real production run using the same collection/Queue/scoring/D1 functions used by Cron, and both Cron triggers are deployed. A naturally scheduled post-repair Cron invocation has not yet been separately observed. If future work is only verification, inspect the next scheduled cycle rather than changing the working production architecture.
