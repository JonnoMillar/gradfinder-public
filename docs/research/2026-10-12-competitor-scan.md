# Competitor scan: job trackers and grad tools (2026-10-12)

Desk research only (web search + vendor pages, 2026-10-12). Prices and feature claims come mostly from vendor pages
or from review sites run by competitors (LoopCV, JobShinobi, Scoutify), so treat numbers as indicative. Anything under
"How their backend probably works" is my inference from public behaviour, not verified.

## 1. The landscape

| Product | Who it's for | Core idea | Price (indicative) | Fit for UK grads/placements |
|---|---|---|---|---|
| **Huntr** | US job switchers; B2B: bootcamps, uni career centres, coaches | Kanban board + Chrome "save from any site" + autofill + AI CV/letter | Free (≈40 jobs), Pro ≈$40/mo | Weak: no UK grad cycle, no sources |
| **Teal** | US mid-career switchers | Resume builder + tracker + keyword match | Free tracker, Teal+ ≈$29/mo or ≈$13/wk | Weak: reviewers say non-US features don't adapt |
| **Simplify** | US students/new grads (tech) | Owns a jobs DB (hourly career-page scraping) + Copilot autofill on 80% of forms + tracker auto-logs submissions | Free core, paid Simplify+ | Medium: great mechanics, US-centric listings |
| **Jobright** | US new grads, H-1B seekers | 8M-listing aggregator, AI matching, "Orion" copilot, insider-connection referrals, auto-apply agent | Free limited, ≈$29–59/mo | Weak: US data |
| **LoopCV / AIApply / LazyApply** | Volume appliers | Auto-apply bots | Subscription | Bad fit: spray-and-pray; reviews report silent failures |
| **Careerflow** | General | LinkedIn optimiser + docs + tracker | Subscription | Weak |
| **Trackr** (ex-Bristol Tracker) | UK finance/tech students: spring weeks, internships, placements, grad schemes | Public spreadsheet of opening/closing dates, "detected within minutes"; cover-letter-required flag; season insight reports; student group chats | Free sheet; Premium alerts ≈£25–30 + £10–15 per extra type | **Direct UK grad competitor** (deadlines only) |
| **Intervyo** | UK finance/consulting/law students | Tracker sheet (Opened/Closing this week), Firm Radar alerts, free Kanban pipeline, plus 15 AI prep tools: HireVue practice, psychometric tests, assessment-centre and superday simulators, firm dossiers, question predictions | Free tracker; paid "Firm Packs" | **Closest UK competitor** (tracker + prep) |
| **GradBlueprint** | UK grads | Solo-built: tracker, ATS CV score, AI mock interviews, scheme DB, "Career Match" | Freemium, .ac.uk discount | Small, same idea space |
| **Bright Network / TARGETjobs / Higherin / Gradcracker / Prospects / Milkround** | UK students | Employer-funded job boards; Bright Network has a deadline tracker but says there's no place to track roles you've applied to | Free to students | They're our sources, not our product |
| **Handshake** | University career services (UK since 2020) | Uni-licensed platform, feed, employer-paid promotion | Free to students | Distribution channel more than competitor |
| **Welcome to the Jungle (Otta)** | UK/EU tech/startup job seekers | Vetted companies, swipe triage, salary charts, Otta's "own take" on each company | Free | UX benchmark |

**The gap nobody fills:** a UK grad/placement seeker *outside* finance/law (tech, data, AI, sport, scale-ups) who wants
one place that merges every board and employer ATS, tells them which roles are worth it, and helps them actually apply.
Trackr and Intervyo are finance-first and stop at a deadline sheet plus prep. The US tools have the mechanics but
not the UK cycle (spring weeks, schemes, rolling deadlines, tal.net, HireVue, intake year).

## 2. How their backend probably works (inference)

- **Huntr / Teal / Careerflow** — standard SaaS CRUD (board, jobs, contacts) plus a Chrome extension that reads the
  open job page (JSON-LD `JobPosting` where present, per-site selectors otherwise). Autofill = label-to-profile-field
  mapping with per-ATS adapters (reviews: good on Greenhouse/Lever/Workday, poor on custom forms). AI CV/letter tools
  are thin wrappers over a hosted LLM API. They own no job data: the user brings the job. Revenue: short subscriptions
  (Teal's weekly plan targets the urgent few weeks of a search); Huntr also sells Advisor (B2B coach dashboard + org API).
- **Simplify** — owns the data: scrapes company career pages and ATS APIs hourly (same pattern as our
  Greenhouse/Ashby/Lever adapters), plus community submissions via GitHub issues; the famous
  `SimplifyJobs/Summer20XX-Internships` repos are generated from a `listings.json` by GitHub Actions — free marketing
  that funnels students into the extension. Copilot keeps a saved-answer bank and reuses answers to repeated questions.
- **Jobright** — big aggregator + embedding similarity between CV and postings, LLM copilot on top, a people dataset
  for "insider connections". Auto-apply claims are unverified.
- **Trackr / Intervyo** — career-page monitors (scripts plus human curation) feeding a spreadsheet-style front end;
  money from alerts (Trackr) or prep packs (Intervyo). Intervyo's apply links carry its own tracking parameters.
- **Bright Network & co.** — employer-paid: employers pay for reach into the student base, so "matching" serves
  employers. Their deadline data is first-party because employers post it.

**Contrast with us:** we're the only one built on *the student's* side of the incentive: no employer pays, nothing
is promoted, and every shown fact has a `source_url`.

## 3. UI/UX compared

| Pattern | Who | Ours |
|---|---|---|
| Kanban board (Saved → Applied → Interview → Offer) | Huntr, Teal, Intervyo, GradBlueprint | Stage track + Climb staircase on `/applications`: more visual, less familiar |
| Spreadsheet with status, open/close dates, days left, "Opened / Closing this week" | Trackr, Intervyo | Ranked list + This week band + Last chance; no "opened this week" |
| Feed / swipe triage | Otta, Handshake | Up next: Go for it · Not interested · Later |
| One-click save from any page (extension) | Huntr, Teal, Simplify | **None** — only swept roles exist |
| "What to do now" | Mostly absent (Huntr has reminders) | **Do this first** card driven by `attention()` — ours is stronger here |
| Company page with opinionated take + salary chart | Otta | Role factfile with deep research, values cards, commute — richer, but sourced |

Reviewers repeatedly call Teal and Huntr "overwhelming" and "crowded". Our role page (≈10 sections) carries the
same risk; the fix that worked elsewhere is a short opinionated summary up top with detail behind it.

## 4. What they have that we don't

1. **Save a role from anywhere** (extension or paste a URL). Today a role a friend sends or a LinkedIn post can't
   enter the app unless a sweep finds it. Biggest everyday gap.
2. **"Not open yet" watchlist + open alerts** (Trackr Premium, Intervyo Firm Radar, "Dates TBC" rows). UK schemes
   open on a cycle; knowing BlackRock opened today matters more than a nightly sweep. We have no push/WhatsApp/email alert.
3. **Opening-date history / season insights** (Trackr's yearly reports: when each firm opened, how fast it filled).
4. **Process facts per role at a glance**: cover letter required? which test provider (SHL, Watson-Glaser, Pymetrics)?
   HireVue? rolling? (Trackr shows the cover-letter flag in the sheet; Intervyo maps each firm's stages.)
5. **Test and HireVue practice** (Intervyo's question banks, timed practice, assessment-centre simulator).
6. **Contacts / networking CRM** (Huntr, Teal; Jobright's referral finder).
7. **Funnel metrics** (Huntr): response rate by sector, source, or stage, time to reply.
8. **Student reviews of employers** (Higherin/RateMyPlacement) used as culture evidence.
9. **Mobile / notifications** — everyone has a phone surface; we're desktop-on-localhost.

## 5. What to steal (my priority order)

| # | Steal | Why | Size |
|---|---|---|---|
| 1 | **Add role by URL** (paste box first; extension later) — run the existing JSON-LD parser (`parse/jsonld.ts`) + extraction on any URL | Closes gap 1 with code we already have | S–M |
| 2 | **Firm watchlist with "opened" alerts** — firms whose 2027 scheme isn't live; the sweep notices a first-seen role and pings (email to self, or desktop notification) | The UK cycle is about being early; Trackr charges for exactly this | M |
| 3 | **Process chips on every role row**: cover letter · tests (provider) · HireVue · rolling | Cheap triage signal; data partly exists in deep research `process` | S–M |
| 4 | **Keep first-seen/closed dates per firm per cycle** → "opened ~mid-Sept last year", "closed early last year" | Starts the history only we'd have; EDF closing early is the case for it | S now, pays off next cycle |
| 5 | **Funnel stats on `/applications`** (sent → test → HireVue → interview, by sector) | The Climb already holds the data | S |
| 6 | **Higherin reviews as sourced culture facts** in deep research | Already a source adapter; real student voices | S |
| 7 | **Contacts per company** (name, how met, last touch) | Networking matters at boutique firms; low priority for Jonno now | M |

**Don't steal:**
- **ATS keyword "match score".** UK grad schemes mostly screen with online tests, HireVue and assessment centres, and
  our fit ring is already a better signal. A fake-precision % would break the "no invented detail" rule.
- **Auto-apply at volume.** The ISE puts competition at 140 applications per vacancy, and about half of employers
  worry AI misrepresents graduates. Our fill-then-stop-for-review model is the right side of that line.
- **AI-scored HireVue/test practice built by us.** Intervyo already does it, the free test publishers' practice
  exists, and it would cost per-use model spend. Link out instead (as a "prep" chip per test provider).

## 6. What we have that's unique (or could be)

1. **Sourced, honest facts.** Every claim carries a URL and a verbatim quote; empty sections list what was searched.
   Competitors' AI "insights" (Otta's take, Intervyo dossiers, Jobright matches) are unsourced.
2. **Merged UK coverage.** Bright Network + TARGETjobs + Higherin + LinkedIn/Indeed + employer ATS boards, deduped, with
   liveness checks against the employer's own ATS. Trackr/Intervyo cover finance/law lists by hand; US tools don't do the UK.
3. **Grad-cycle model.** Intake-2027 evidence, register-interest roles, rolling deadlines, HireVue and tests as real
   stages, a closed status that sync never moves. US trackers stop at "Interview".
4. **Agent that fills the whole form, asks once in batched cards, and is guarded from pressing Submit.** That sits
   between Simplify's field autofill and LoopCV's blind auto-apply, and nobody else does it.
5. **Answers grounded in your own knowledge store, in your voice, never inventing a fact**, and aware of employer AI
   rules (PwC, Anthropic). Competitors generate generic text.
6. **Gmail sync with a forward-only state machine.** JobShinobi/Jofollow classify emails; ours moves the tracker
   safely and turns recruiter asks into "Do this first".
7. **Employer values → your stories, STAR cue cards, commute times.** No competitor joins "what they look for" to
   "which of your stories proves it".
8. **Could be unique:** opening-date history across cycles (#4 above), and a "placement mode" (Year-in-industry
   cycle, sandwich-degree eligibility) — Trackr lists placements but nobody helps you *apply* to them.

## 7. If gradfinder ever goes beyond Jonno

- **Positioning:** "Trackr tells you it opened. Gradfinder tells you if it's worth it, and helps you apply properly."
  For UK grads and placement seekers in tech/data/business, not finance-only.
- **Hard parts:** per-user Claude evaluation cost (Intervyo/Jobright pass model cost on via subscription); scraping the
  boards that would be competitors; Gmail restricted-scope verification; CV/GDPR. Unchanged from the 2026-10-12 memo.
- **Cheap distribution seen working:** Simplify's public GitHub lists, Trackr's public sheet and season reports,
  Handshake via university careers services.

## Sources
- Huntr: [LoopCV review](https://www.loopcv.pro/directory/huntr/), [Scoutify review](https://scoutify.com/blog/huntr-review),
  [Huntr Advisor for bootcamps](https://huntr.co/bootcamps), [JobShinobi comparison](https://jobshinobi.com/compare/job-tracking-apps-like-huntr-2026)
- Teal: [FrontDesk pricing](https://frontdeskreview.com/software/resume-builders/teal.md), [Enhancv review](https://enhancv.com/blog/teal-review/),
  [Trustpilot](https://www.trustpilot.com/review/tealhq.com?page=3)
- Simplify: [help centre, Copilot autofill](https://help.simplify.jobs/articles/3296996-using-copilot-to-autofill-applications),
  [Summer2026-Internships repo](https://github.com/SimplifyJobs/Summer2026-Internships), [Summer2027 summary](https://gittrend.io/repo/SimplifyJobs/Summer2027-Internships)
- Jobright: [Careery review](https://careery.pro/blog/ai-job-search/jobright-ai-review), [The Register](https://www.theregister.com/2025/06/24/ai_may_take_jobs_but/)
- Trackr: [the-trackr.com](https://the-trackr.com/), [Spring Weeks Season Insights 2026](https://the-trackr.com/wp-content/uploads/2026/09/Spring-Weeks-Season-Insights-2026.pdf),
  [Premium form](https://tally.so/r/nWZWXj)
- Intervyo: [tracker](https://www.intervyo.co.uk/tracker), [features](https://www.intervyo.co.uk/features),
  [vs Trackr](https://www.intervyo.co.uk/compare/intervyo-vs-trackr), [HireVue practice](https://www.intervyo.co.uk/assessments/hirevue)
- GradBlueprint: [Product Hunt listing](https://webmail.hunted.space/product/gradblueprint)
- Bright Network: [support: deadlines](https://support.brightnetwork.co.uk/hc/en-gb/articles/12507026017553-Where-can-I-find-the-jobs-I-applied-to-and-see-deadlines)
- Handshake UK: [FE News launch](https://www.fenews.co.uk/press-releases/51566-for-wed-22nd-graduate-careers-platform-handshake-launches-in-uk-partners-with-cambridge-york-and-liverpool-universities-increases-vacancies-by-300-diversifies-recruitment), [Sacra](https://sacra.com/c/handshake/)
- Otta / Welcome to the Jungle: [Scoutify review](https://scoutify.com/blog/otta-review), [App Store](https://apps.apple.com/us/app/-/id1640509194)
- Auto-apply tools: [LoopCV on Careerflow](https://www.loopcv.pro/directory/careerflow/), [TechJockey LoopCV reviews](https://www.techjockey.com/reviews/loopcv)
- Email-based tracking: [Jofollow](https://addons.mozilla.org/firefox/addon/jofollow/), [JobShinobi](https://jobshinobi.com/blog/email-based-job-application-tracker-how-it-works)
- Market: [ISE top 10 stats 2025](https://ise.org.uk/knowledge/insights/513/ise_top_10_stats_of_2025_you_need_to_know/),
  [ISE Student Recruitment Survey 2025](https://ise.org.uk/_userfiles/pages/files/reports/student_recruitment_survey_2025.pdf)
