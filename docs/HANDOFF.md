# Handoff

A fresh worker should read, in order: `README.md`, `docs/ARCHITECTURE.md`, `docs/EXECUTION_STATE.md`, this file, then only files implicated by current CI failures.

Do not regenerate the project or trust a prose claim of completion. Inspect GitHub HEAD and Actions. A successful next step is bounded: fix one failing gate, rerun, commit, update EXECUTION_STATE.

Production deployment is a separate gate. If Cloudflare credentials are not available, keep status deployment-ready/blocked-by-external-auth; never write `PRODUCTION_DEPLOYED`.
