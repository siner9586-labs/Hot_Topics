# ADR 001 — Cloudflare deployment topology

**Decision:** Astro SSR Worker + one pipeline Worker with D1, Queue and Cron.

**Reason:** preserves HTML-first UI and asynchronous data processing while minimizing Workers, duplicated D1 bindings and operational cost. Collection/processing/API remain code modules rather than separate deployments until scale justifies separation.
