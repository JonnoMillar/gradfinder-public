# Stage 5 — three design directions

Built 2026-09-22. Every value in every mock is a **real row from `data/app.db`** as it stood that
day — no lorem ipsum, no invented facts.

These are a **point-in-time record of the decision**, not living code. The `.html` files are
self-contained (open one directly in a browser) and the `.png` files are what Jonno reviewed. The
generator scripts that produced them were scratch and have been deleted now that Stage 6 has landed;
the shipped UI in `app/` is the living version of Direction D.

The same job is the factfile in all three so they are directly comparable: **EDF UK — Data & Technology
Graduate 2027** (`jobs.id = 1915`). It was picked because it exercises every state the factfile has to
handle: a real deadline 10 days out, a published salary band, a multi-office London listing, two sources
that deduped into one row, a 2:2 rule, two named process stages, and six of eight requirement flags that
came back `unknown` and must render as unknown.

## Constraints these were designed against

From the brief, 2026-09-22. All four of the obvious answers were ruled out by Jonno:

- not **job-board sludge** (Indeed/LinkedIn: promoted rows, identical grey cards, uniform shouting)
- not a **generic SaaS dashboard** (gradients, hero-metric tiles, icon sidebar)
- not a **spreadsheet / dev tool** (raw table, monospace everywhere, no hierarchy)
- not **overdesigned editorial** (display serif, magazine whitespace)

Usage is a blend: the baseline Jonno checks *before applying to anything*, in both short scans and
longer shortlisting sessions.

## A — Dossier · `direction-a-dossier.html` (rejected)

**Organising axis: rank.** Two-pane master/detail — the list rail never moves while you read a factfile
on the right, so scanning and reading are the same surface at two densities. Light, cool off-white,
two ink levels only; the single warm colour is reserved for deadline urgency so it means something.
Rows are hairline-separated typographic blocks, not cards.

- Best at: the blended rhythm. Compare six roles without losing your place.
- Provenance: source domain sits inline next to every value, permanently, never on hover.
- Weakest at: small screens (the two-pane layout has to collapse), and the reading column leaves the
  right side sparse on a wide monitor.

## B — Runway · `direction-b-runway.html` (basis for the chosen direction)

**Organising axis: time.** Deadline bands *are* the layout, with days-left as a large figure in a left
gutter that forms the visual spine. Dark, plum-tinted rather than blue-black, with proportional type and
soft surfaces specifically so it does not read as a terminal. Quick keep/skip actions on every row.

- Best at: the 8am pass. "What closes this week, what can I kill."
- Honest about its own weakness, visibly: **458 of 639 roles publish no deadline at all**, so the
  "rolling / no deadline" band is the biggest one and falls back to rank ordering. The design shows that
  number rather than hiding it.
- Weakest at: deep comparison — it is a triage surface first, and the factfile is a separate screen.

## C — Evidence · `direction-c-evidence.html` (rejected; three ideas carried over)

**Organising axis: what is actually known.** Confidence and provenance are the primary visual dimension.
The palette *is* the confidence scale (high = posting, medium = Wikipedia/news, low = search snippet,
plus a distinct not-found treatment), and every colour also carries its word, so nothing is encoded by
hue alone. Each row carries a knowledge meter (`7/9` key fields evidenced) and lists its own gaps. The
factfile splits into "Evidenced" and "Not found" side by side.

- Best at: deciding whether a role is worth 90 minutes of application effort, and catching bad research.
- It surfaces the **source-integrity problem found while building this** (see below) as a first-class UI
  element rather than a silent data bug.
- Weakest at: speed. It is the densest of the three and the least suited to a 60-second scan.

## Screenshots

| Direction | List | Factfile |
|---|---|---|
| A Dossier | `a-dossier-list.png` | `a-dossier-factfile.png` |
| B Runway | `b-runway-list.png` | `b-runway-factfile.png` |
| C Evidence | `c-evidence-list.png` | `c-evidence-factfile.png` |
| **D Runway, calm (chosen)** | `d-runway-calm-list.png` | `d-runway-calm-factfile.png` |

Direction D is the one that was built. `DECISION.md` explains how B became D. Screenshots of the
**shipped** UI are `live-list.png`, `live-factfile.png`, `live-tracker.png`, `live-company.png`,
`live-sweeps.png` and `live-filtered.png`.

## Two data problems these mocks exposed

Both are Stage 4 issues, not design issues, but they change what the UI has to show.

1. **Wrong-entity Wikipedia matches — still live in the DB.** The company summary is fetched by
   name, and short or ambiguous names resolve to the wrong article. `lib/research/wikipedia.ts`
   `pickSummary()` only asks *"does this read like an organisation?"* (an `ORG_WORDS` regex over the
   short description) — it never compares the article title to the employer name. A second guard
   added in `13fa0ab` asks the **LLM** `wikipedia_matches_employer`, using the posting blurb and
   London job titles as ground truth.

   That guard works but is model-dependent. It cleared `ICE` (the run left sector null rather than
   guessing, which is correct), and **missed these, all still wrong after the 2026-09-22 reclassify
   pass**:

   | Company | Resolves to | Why the org-words regex let it through |
   |---|---|---|
   | Attio | `GV_(company)` | "venture capital **company**" |
   | Allye Energy | `List_of_Cadbury_brands` | "Cadbury is … confectionery **company**" |
   | Freshminds | `Caroline_Plumb` | a person, but her lead names a **company** |
   | Blenheim Chalcot | `Manoj_Badale` | a person, but his lead names a **business** |

   Attio is the top-ranked role in the list, so this is not cosmetic. The cheap fix is a
   deterministic guard *before* the LLM one: reject the article when its title shares no significant
   token with the employer name. That catches all four without an LLM call, and failing closed just
   means no Wikipedia summary — the safe direction.
2. **Logo coverage is thin.** Only 194 of 527 companies have a `logo_url` and 222 have a `domain`, so
   roughly 58% of rows fall back to initials. The initials mark has to be a designed element, not an
   afterthought — and deriving `domain` from `apply_url`/`canonical_url` would recover a lot of them.
