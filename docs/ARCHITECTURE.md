# Architecture

Hot Topics is a data-first attention observatory. The production topology deliberately uses **two Cloudflare Workers**, not three: a pipeline Worker and an Astro SSR Worker. Collection, processing and API remain separate modules inside the pipeline Worker, but share one deployment unit and one D1 binding. This lowers cost, configuration drift and cross-service failure while Queue still isolates collection from expensive clustering/scoring.

```text
Cron (UTC, Beijing 00/03/06/09/12/15/18/21)
  -> pipeline scheduled handler
  -> SourceAdapter[] in parallel
  -> quality gates + immutable raw_items
  -> Queue hot-topics-pipeline
  -> clustering + scoring consumer
  -> topic/platform snapshots in D1
  -> versioned /api/v1/*
  -> Astro SSR through Service Binding
```

The Cron expression is `0 1,4,7,10,13,16,19,22 * * *`: Cloudflare Cron is UTC, so this phase corresponds to Beijing 00:00, 03:00, ..., 21:00.

## Boundaries

- `packages/adapters`: public source acquisition only. One adapter failure cannot reject the run.
- `packages/clustering`: deterministic normalization, lexical/event guardrails, provider interfaces for embeddings/LLM arbitration.
- `packages/scoring`: platform-local normalization and versioned Heat model.
- `packages/db`: parameterized D1 access and idempotency.
- `workers/pipeline`: orchestration, quality gates, Cron, Queue and read-only API.
- `apps/web`: HTML-first Astro UI; JavaScript is not required to read rankings.

## State and recovery

Git is the execution state. `docs/EXECUTION_STATE.md` and `docs/HANDOFF.md` are intended to let a fresh worker resume without previous chat context.
