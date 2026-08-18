# Sources

Status reflects the production adapter policy, not a claim that every endpoint will be reachable from every network at every moment.

| Source | Region | Signal | Access | Default | Notes |
|---|---|---|---|---|---|
| Baidu Hot Search | CN | search ranking + index | official public board | enabled | Parser has schema-change gate; no login bypass. |
| 36Kr | CN | news/editorial feed | official RSS `/feed` | enabled | News signal, not search-volume signal. |
| 人民网 | CN | news/editorial feed | official RSS `rss/ywkx.xml` | enabled | News coverage signal. |
| Hacker News | GLOBAL | community votes/comments/rank | official Firebase API | enabled | Public near-real-time API. |
| Wikimedia Pageviews | GLOBAL | page-view attention | official Analytics API | enabled | Uses previous complete UTC day. |
| BBC News | GLOBAL | news/editorial feed | public RSS | enabled | Editorial coverage signal. |
| GitHub Trending | GLOBAL | developer-community trending | public `/trending` page | enabled | Public page; crawler obeys robots and conservative frequency. |
| YouTube | GLOBAL | mostPopular/video metrics | official Data API | disabled by default | Requires `YOUTUBE_API_KEY`; current mostPopular scope is not equivalent to legacy Trending. |
| 知乎 | CN | hot list | official developer API | disabled by default | Requires approved API access/token. |
| 微博 | CN | hot search | no stable authorized production API configured | disabled | No circumvention of login/anti-bot controls. |
| Google Trends | GLOBAL | search attention | API Alpha | disabled | `requires_access`; never faked. |
| GDELT Cloud | GLOBAL | global news stories/events | official authenticated API | disabled | Legacy DOC query search is not treated as unbiased global ranking. |

Adapters expose `healthy`, `degraded`, `unavailable`, `disabled`, `rate_limited`, `auth_required`, `schema_changed`, or `requires_access`.
