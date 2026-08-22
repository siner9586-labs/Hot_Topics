# Execution State

- Date: 2026-08-22
- Repository: `siner9586-labs/Hot_Topics`
- Target branch: `main`
- State owner: Git repository, not chat context
- Verified production-deployment SHA: `aefa23afb0e09052c88ab87ff850bf97b1b98452`
- Verified Cloudflare deployment + real-data acceptance: run `32583510911` — success
- Current readiness: `PRODUCTION_REFRESH_REPAIRED_VERIFIED`

## Incident fixed on 2026-08-22

The site appeared stale even though collection triggers were accepted. Production evidence isolated the failure to the regional Queue scoring stage:

- failing production run `manual_20260822134622` collected 422 real raw items;
- CN scoring completed with 60 snapshots;
- GLOBAL remained at 0 snapshots and the run stayed `PROCESSING` until deployment acceptance timed out.

The root cause was the runtime shape of two heavy regional jobs. With `max_batch_size=5`, CN and GLOBAL could be delivered to the same Queue consumer invocation and were processed sequentially. CN consumed the first part of the invocation budget; GLOBAL then ran the more expensive workload. Clustering also repeatedly normalized/tokenized/ngrammed up to 1,000 recent topic seeds for every item.

## Production repair now deployed

- Queue `max_batch_size=1`: one region per consumer invocation.
- Queue `max_batch_timeout=1`.
- Queue `max_concurrency=1`: the two low-frequency D1-heavy regional jobs run serially instead of contending on D1/run state.
- Queue `max_retries=5`; DLQ retained.
- Clustering precomputes lexical features for recent topic seeds once per regional job.
- No `limits.cpu_ms` override is used because the production account runs Workers Free and Cloudflare rejects paid-plan CPU overrides on that plan.
- Run-scoped raw observation IDs remain in place, so recurring hot items are persisted on every new run.
- Current rankings remain constrained to the newest completed `PUBLISHED`/`PARTIAL` production run instead of mixing per-topic historical snapshots.
- Ranking APIs and rendered pages use real snapshot freshness and no-store delivery.
- Primary Cron remains every 3 hours; watchdog Cron remains hourly at minute 30 and only repairs stale state.

## Verified production behavior

Deployment run `32583510911` verified the complete production chain on commit `aefa23afb0e09052c88ab87ff850bf97b1b98452`.

Protected real-data run:

- run id: `manual_20260822160341`
- status: `PARTIAL`
- real raw items collected: 420
- CN snapshots: 60
- GLOBAL snapshots: 90
- CN working-source count: 4
- GLOBAL working-source count: 6

The decisive recovery signature was observed directly: after CN reached 60, GLOBAL advanced `0 -> 8 -> 18 -> 28 -> ... -> 90` and the system entered a terminal state. This is the opposite of the failed pre-fix run, where GLOBAL remained at zero.

The deployment workflow also verified over public HTTP from a GitHub-hosted runner:

- `https://hots.ccwu.cc/` returned rendered HTML;
- `?region=CN` rendered a non-empty topic list;
- `?region=GLOBAL` rendered a non-empty topic list;
- none of those pages reported `尚无生产快照`;
- CN/GLOBAL pages did not report `暂无可用热点数据`;
- production source coverage passed its floors (CN >= 4, GLOBAL >= 5);
- GitHub commit status `cloudflare/production` finished `success`.

## Production resources

- Custom domain: `https://hots.ccwu.cc/`
- Pipeline/API: `https://hot-topics-pipeline.zz9w9z.workers.dev`
- D1: `hot-topics`
- Queue: `hot-topics-pipeline`
- DLQ: `hot-topics-pipeline-dlq`
- Web service binding: `API -> hot-topics-pipeline`
- Primary Cron: `0 1,4,7,10,13,16,19,22 * * *` UTC
- Watchdog Cron: `30 * * * *` UTC

## Current source degradation, not a refresh blocker

At the last verified run, these optional/default sources were degraded independently of the refresh incident:

- 36Kr RSS: schema changed / no items;
- Bilibili: HTTP 412 from Cloudflare egress;
- Google News: HTTP 503 at that run;
- GitHub Trending: challenge page.

Healthy coverage still exceeded production acceptance floors: CN 4 and GLOBAL 6.

## Remaining evidence boundary

The repaired code path has been verified through a protected real production collection using the same collection/Queue/scoring/D1 publication functions used by Cron. Both Cron triggers are deployed and visible in Wrangler output. A post-repair naturally scheduled Cron invocation has not yet been separately observed, so do not mark that narrower evidence item as verified until a later scheduled cycle is inspected.
