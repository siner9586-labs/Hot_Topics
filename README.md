# Hot Topics

**全球互联网热点雷达 · Global Internet Attention Observatory**

Hot Topics measures how internet attention forms, spreads across platforms/regions, peaks and cools. It is not a collage of unrelated hot-search lists: the durable assets are a Topic graph, attention time series, explainable cross-platform Heat model and historical snapshots.

## What it answers

- What is hottest now, rising fastest, newly emerging or cooling?
- Is a Topic hot on one platform or across independent source types?
- Where do China and global attention resonate or diverge?
- How does a Topic move through emerging → rising → spreading → peak → cooling → long-tail/revived?

**Heat is an attention index, not a truth score, population poll or investment signal.** Evidence Coverage is shown separately and only measures source coverage.

## Architecture

- Astro 7 SSR + `@astrojs/cloudflare`
- TypeScript strict monorepo / pnpm
- Cloudflare Worker pipeline: Cron + Queues + D1 + versioned `/api/v1`
- SourceAdapter interface; one source failure cannot roll back a run
- Hybrid clustering with deterministic/numeric/date safeguards and optional semantic/LLM providers
- Heat v1 with platform-local robust normalization and availability-aware confidence
- HTML-first responsive UI; core rankings remain readable without client JavaScript

See `docs/ARCHITECTURE.md` and ADRs for rationale.

## Default real sources

CN: Baidu Hot Search public board, 36Kr official RSS, 人民网 RSS.

GLOBAL: Hacker News official API, Wikimedia Analytics Pageviews API, BBC News RSS, GitHub public Trending page.

YouTube, 知乎 official API, Google Trends API Alpha and GDELT Cloud are optional/credentialed. 微博 remains disabled without a stable authorized production interface. No mock/fixture is published as production data. See `docs/SOURCES.md`.

## Pipeline

`collect -> normalize -> quality gate -> deduplicate -> cluster -> score -> snapshot -> publish`

The requested Beijing snapshots at 00/03/06/09/12/15/18/21 use the UTC Cron phase `01,04,07,10,13,16,19,22`.

## Local development

```bash
corepack enable
corepack prepare pnpm@11.18.0 --activate
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:real
```

For UI development, run the pipeline Worker on `:8787`, then `pnpm dev:web`. Tests may use `scripts/fixture-api.mjs`; fixtures are never a production fallback.

## Environment

Copy `.env.example` only for local reference. Put production secrets in Cloudflare Worker secrets / GitHub production environment; never commit them. Every source has a feature flag and the application continues when optional credentials are absent.

## Database

D1 schema is in `migrations/0001_initial.sql`. `raw_items`, `topic_items`, `topic_snapshots` and platform snapshots have uniqueness constraints; same `run_id` can be replayed without duplicating durable records.

## API

Read-only endpoints:

- `/api/v1/topics`
- `/api/v1/topics/:slug`
- `/api/v1/rankings`
- `/api/v1/source-health`
- `/health`

The API contract is versioned independently of the database schema.

## Testing and security

CI runs lint, strict typecheck, scoring/clustering/resilience/idempotency tests, Worker/Astro builds, secret scan, dependency audit, real public-source smoke, and Chromium screenshots at 1440×900 / 390×844 including dark mode.

Security controls include parameterized SQL, URL/protocol validation, challenge-page rejection, CSP/security headers, no committed secrets and conservative public-source collection frequency.

## Deployment

`Deploy Cloudflare` is manual and requires GitHub production secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. It creates Queue/DLQ, deploys pipeline, applies D1 migrations, then deploys Astro web. No deployment is claimed until HTTP/API/DB are actually verified.

## Method, operations and limits

- `docs/METHODOLOGY.md`
- `docs/SOURCES.md`
- `docs/OPERATIONS.md`
- `docs/EXECUTION_STATE.md`
- `docs/HANDOFF.md`
- `docs/FINAL_REPORT.md`

V1 deliberately favors a small number of inspectable sources over fragile scraping. International Chinese translation and semantic arbitration degrade conservatively when no approved AI provider is configured.
