# Existing form-filling tools (2026-11-09)

Question (Jonno): has anyone built something much better at filling varied application forms than our
`claude -p` + Playwright MCP loop, and what can we take? READMEs read on 2026-11-09; source code not yet read.

## The pattern every good one shares
Deterministic first, LLM last. Pull the form fields out of the DOM, match them to profile values with rules and
an answer bank (questions answered once are cached), fill them in batch, and send only the leftovers to a model.
Our tal.net kit (`window.__gf.settle`) already does this for one ATS. On every other site our agent works one field
per turn, and that is why run 29 cost what it did.

## Candidates (all MIT unless stated)
| Project | ATSs | How it fills | Takeaway |
|---|---|---|---|
| [summitsingh/ai-job-pilot](https://github.com/summitsingh/ai-job-pilot) (Python, 6 stars) | Greenhouse, Ashby, Lever, Workable. Not Workday/iCIMS/Taleo | Attaches over **CDP** like our runner; `hard_patterns.py`/`templates.py` rules, batched JS fill, real clicks for selects; at most 1 LLM call per form; unknown = skip | Best reference for rule tables and React-select handling. Self-reported 82/82 fields on Ashby+Lever with zero model calls |
| [shankswhite/JobApplyAgent](https://github.com/shankswhite/JobApplyAgent) (Node .mjs, 1 commit) | Greenhouse, Ashby, Lever, Workday (generic DOM) | `extract-form-fields.mjs` → 8-layer `answer-resolver.mjs` → `fill-form.mjs` (3 passes, "Add another" entries, typeahead: type prefix, poll ~2.5 s, match exact → startsWith → contains); `form-answers-cache.json` answer bank | **Dropped (Jonno):** 0 stars, one commit on 2026-04-26, no tests. It does the same jobs as ai-job-pilot, so it adds nothing |
| [HarshadLambate/workday-autofill](https://github.com/HarshadLambate/workday-autofill) (Python, PyPI) | Workday full flow, Lever, Greenhouse best effort. Not Oracle | Profile → rules → `answers.yaml` bank → optional AI → ask user; legal/identity never AI-filled | Only one with real Workday multi-page handling; read `workday.py` when a Workday form comes up |
| [Skyvern](https://www.skyvern.com/docs/cookbooks/job-application-filler) (AGPL-3.0, 20k+ stars) | Any (vision + LLM) | Needs its own LLM API key per step | Not usable here: no Anthropic API, and free-tier providers may train on Jonno's data. Still an LLM-per-page loop |
| [Stagehand](https://docs.stagehand.dev/v4/best-practices/caching) / [browser-use](https://github.com/browser-use/browser-use) | Any | LLM per action; Stagehand caches repeated actions server-side (Browserbase) | Same API-key problem; the caching only pays off on repeated identical forms |
| [Simplify Copilot](https://simplify.jobs/copilot) (free, closed source extension) | 100+ portals incl. Workday, iCIMS, Taleo, Greenhouse, Lever, SmartRecruiters | Hand-maintained per-ATS autofill; zero LLM tokens | Could fill structured fields for free in the runner's Chrome; profile data lives on Simplify's servers |

None of them covers Oracle Recruiting Cloud or tal.net, the two forms we hit most.

## Decision
ai-job-pilot is the reference: 85 commits from 2026-10-04 to 10-23, an offline test suite, and live checks. Its four ATSs
are where 134 kept roles link directly (Ashby 60, Greenhouse 49, Lever 15, Workable 10; DB, 2026-11-09). It is Python
driving CDP; we run JS in the page through the MCP. So we port its techniques into `lib/apply/ats/tal-kit.js` (MIT, with
credit), not its files:
(1) the field reader (`schema_dump.py`: type, label, required, options, custom-select, yes/no buttons);
(2) the React-select handling (`set_select.py`: mouse events on `.select__control`, click the option by exact text,
read it back);
(3) a fixed label → facts.yaml rule table plus safety rules (`hard_patterns.py`: a sponsorship question never picks a
country-specific visa option and fails loudly). Its own rule values are US-centric and are not copied.
