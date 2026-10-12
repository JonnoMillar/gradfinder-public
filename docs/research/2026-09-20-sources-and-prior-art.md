# Research sweep: sources & prior art (2026-09-20)

Everything below was verified live from this machine on 2026-09-20 with plain HTTP (curl / python urllib) unless stated.

## Prior art

| Project | Verdict |
|---|---|
| [python-jobspy](https://github.com/speedyapply/JobSpy) (4k★, active Feb 2026) | **Use** as a Python sidecar for LinkedIn + Indeed. Tested: 25/25 rows from each for "graduate scheme 2027, London". Indeed rows include company rating, review count, headcount, logo, full description. LinkedIn attributes reposts to "targetjobs UK" → company normalisation required. |
| [ats-scrapers](https://github.com/kalil0321/ats-scrapers) (Python, MIT) | **Don't depend on it.** Confirms the pattern, but the ATS adapters are 5-line HTTP calls; rewriting in TS avoids a second Python dependency. |
| [ts-jobspy](https://github.com/alpharomercoma/ts-jobspy) | Not used: less maintained than the Python original; LinkedIn/Indeed breakages get fixed upstream first. |
| Levergreen / ApplyPilot / AIHawk | Not used: auto-apply or heavy infra, out of scope. |

## Sources — verdicts

| Source | Method | Verified | Notes |
|---|---|---|---|
| **Higherin** (ex-RateMyPlacement) | Sitemap `job-sitemap-1.xml` (1,388 jobs, ~336 grad-slugged) → job page JSON-LD `JobPosting` + `EmployerAggregateRating` + logo | ✅ | Richest single source: salary, location, deadline, description, **student review rating**. robots.txt permits. |
| **TARGETjobs** | `POST /ext/svc/inferno-search-service-1-0/search` (JSON) | ✅ | 2,579 open opportunities; 658 London; 1,412 "Graduate job". Returns title, org+logo, deadline (unix), salary, apply URL. **Requires `Origin: https://targetjobs.co.uk` header — without it returns HTTP 200 with 0 results** (silent failure; adapter must treat 0 as error). |
| **Bright Network** | Sitemap `sitemap-main_jobs.xml` (2,988 URLs) → job page JSON-LD `JobPosting` | ✅ | Intermittent TCP resets → needs retry/backoff + throttle. Has a separate `job_application_deadlines` sitemap. |
| **LinkedIn** | python-jobspy | ✅ | Rate-limits ~10 pages/IP; keep result counts modest, run last. |
| **Indeed UK** | python-jobspy | ✅ | Best company metadata of the boards. |
| **Company ATS watchlist** | Greenhouse `boards-api.greenhouse.io/v1/boards/{slug}/jobs`, Ashby `api.ashbyhq.com/posting-api/job-board/{slug}`, Lever `api.lever.co/v0/postings/{slug}` | ✅ | No auth. Verified London counts: Anthropic 50, Wayve 72, Faculty 58, Jane Street 58, Monzo 55, Cohere 35, OpenAI 30, ElevenLabs 25, Lovable 26, Isomorphic 17, Zopa 31. Few have "graduate" in the title → entry-level classification must read the description. Slug list is a config file the user can extend. |
| Gradcracker | Sitemap (14k URLs incl. `/hub/.../<id>/<slug>` jobs) | ✅ reachable, intermittent 000s | STEM/engineering focus; **stretch** for v1. |
| Prospects | Client-side rendered, API not investigated | ⏸ | v2. |
| Milkround | StepStone/Totaljobs frontend; server-rendered cards; robots partially disallows | ⏸ | Low grad-scheme signal; v2. |
| Adzuna / Reed APIs | Free keys, signup required | ⏸ | Not needed for v1 coverage; v2 if gaps appear. |

## Research enrichment — free endpoints verified

| Need | Endpoint | Status |
|---|---|---|
| Company summary | `en.wikipedia.org/api/rest_v1/page/summary/{title}` | ✅ |
| Recent news | `news.google.com/rss/search?q="{company}"+when:30d&hl=en-GB&gl=GB&ceid=GB:en` | ✅ |
| Web search (pay, competitiveness, process) | `html.duckduckgo.com/html/?q=` | ✅ (throttle; parse `result__a` + snippets) |
| Student reviews / rating | Higherin `EmployerAggregateRating` on job + company-profile pages | ✅ |
| Employee rating / headcount | Indeed via jobspy (`company_rating`, `company_reviews_count`, `company_num_employees`) | ✅ |
| Logos | Source-provided (Higherin/TARGETjobs/Indeed) → fallback `google.com/s2/favicons?sz=128&domain=` | ✅ (Clearbit logo API is dead; Brandfetch CDN needs a client id) |
| Glassdoor / Levels.fyi | Direct scraping | ❌ blocked; only via search snippets, flagged as low-confidence |

## Decisions

- v1 sources: Higherin, TARGETjobs, Bright Network, LinkedIn, Indeed, ATS watchlist. Gradcracker if time allows. That's 6 validated vs the 5 in the contract.
- JSON-LD `JobPosting` is the common denominator for two of the three grad boards → one shared parser.
- Every adapter asserts a minimum result count and throws on zero; the sweep records per-source outcomes so the UI can show "Bright Network failed at 20:41: connection reset".
