# Sources

Status reflects the production adapter policy, not a claim that every endpoint will be reachable from every network at every moment.

Last public-entry verification: **2026-08-18**. Verification means the official/public entry or documentation was discoverable at audit time; production health is still determined by each live pipeline run.

| Source | Region | Signal | Access | Default | Notes |
|---|---|---|---|---|---|
| Baidu Hot Search | CN | search ranking + index | official public board | enabled | Public realtime board reachable; parser has schema-change gate; no login bypass. |
| 36Kr | CN | news/editorial feed | official RSS `/feed` | enabled | 36Kr's current RSS center documents `/feed`; news signal, not search-volume signal. |
| 人民网 | CN | news/editorial feed | official RSS `rss/ywkx.xml` | enabled | Current 人民网 RSS directory documents the feed; news coverage signal. |
| Hacker News | GLOBAL | community votes/comments/rank | official Firebase API | enabled | Public top-stories API reachable; near-real-time community signal. |
| Wikimedia Pageviews | GLOBAL | page-view attention | official Analytics API | enabled | Uses previous complete UTC day. |
| BBC News | GLOBAL | news/editorial feed | public RSS | enabled | BBC documents RSS headline feeds; editorial coverage signal. |
| GitHub Trending | GLOBAL | developer-community trending | public `/trending` page | enabled | Public trending page reachable; crawler uses conservative 3-hour cadence. |
| YouTube | GLOBAL | mostPopular/video metrics | official Data API | disabled by default | Requires `YOUTUBE_API_KEY`; current mostPopular scope is not equivalent to legacy Trending. |
| 知乎 | CN | hot list | official developer API | disabled by default | Requires approved API access/token. |
| 微博 | CN | hot search | no stable authorized production API configured | disabled | No circumvention of login/anti-bot controls. |
| Google Trends | GLOBAL | search attention | API Alpha | disabled | `requires_access`; never faked. |
| GDELT Cloud | GLOBAL | global news stories/events | official authenticated API | disabled | Legacy DOC query search is not treated as unbiased global ranking. |

Adapters expose `healthy`, `degraded`, `unavailable`, `disabled`, `rate_limited`, `auth_required`, `schema_changed`, or `requires_access`.

## Audit policy

- Public documentation/entry verification is not promoted to `healthy`; only a live adapter collection run can do that.
- A source returning a login, CAPTCHA, bot challenge, unexpected HTML, schema failure, or rate limit is recorded as degraded/unavailable instead of being bypassed.
- Source counts in `artifacts/final_status.json` must come from executable pipeline evidence, not this document.
