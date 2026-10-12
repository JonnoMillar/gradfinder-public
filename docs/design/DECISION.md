# Design decision — Stage 5

**Decided 2026-09-22 by Jonno. Chosen: Direction D — "Runway, calm".**

Mock: `direction-d-runway-calm.html` · screenshots `d-runway-calm-list.png`, `d-runway-calm-factfile.png`.
Built for real in Stage 6 — see `app/`, and `live-*.png` for the shipped result. The mock generators
were scratch and have been deleted.

## How we got here

Three directions were built first (`README.md` describes all three in full):

| | Axis | Verdict |
|---|---|---|
| A — Dossier | rank, two-pane master/detail | **Rejected.** "Way too much going on, too cramped." The two-pane layout put the list and the whole factfile on screen at once, which is the opposite of what Jonno wanted. |
| B — Runway | time, dark, single column | **Closest.** "I like B slightly more than the others." |
| C — Evidence | provenance and confidence | **Rejected as a whole**, but its ideas survive — see *What C contributed*. |

Jonno's feedback on the set, verbatim: *no two-lane thing like in A; the majority of the information
about each job hidden behind a detailed view you have to click on; a bit more space and less text on
show at all times; see if there are any other ways to display some of the information points more
cleanly and visually, like less text more symbol/visual/component.*

D is B rebuilt against exactly that. Then two rounds of his notes on D itself:

1. *"Company and role title need to be pretty clear. Split them up in the row so they are separate but
   also ensure they are the main thing I'm looking at. Slightly bigger company logo."* → the row became
   four explicit columns (days · company · title · signals), company and title both at full ink with a
   hairline between them, logo 20px → 30px, and the container widened to 1010px so neither clips.

## What D is

**Organising axis: time.** Deadline bands are the layout; days-left is a large figure in a left gutter
that forms the spine of the page. Single column, no split view.

**The row carries four things and nothing else:**

1. days-left (colour-tiered: ≤3 hot, ≤7 warm, ≤30 mid, beyond that cool, `open` for no deadline)
2. company — logo 30px + name, its own column
3. role title — its own column, the widest thing on the row
4. a signal cluster: sector dot · AI-forward dots · compressed pay (`£30–35k`) · `+N` offices pin

Everything else is behind the click.

**Theme:** dark, plum-tinted (`oklch(0.183 0.014 322)`) rather than blue-black, with proportional type
and soft surfaces, specifically so it does not read as a terminal — "spreadsheet / dev tool" was one of
the four rejected anti-references and terminal-dark is the trap one tier below it.

**Symbol decisions (the "less text, more visual" ask):**

- Sector → a coloured dot on a fixed hue map, with the word shown **only when it is informative**.
  `other` and "not researched" get a neutral grey dot and no label, which removes the word "Other"
  from most rows without pretending we classified them.
- AI-forward → three dots, filled to the level. Never assessed renders as `–`, matching the pay
  column's `—`, rather than the words "not assessed" repeated down the page.
- Pay → `£30,000 to £35,000` compressed to `£30–35k` on the row; the full string is on the factfile.
- Offices → the pin only appears when there *are* offices beyond London. A bare pin on every row says
  nothing.
- A legend strip names each glyph once, at the top, so none of them need a label in the rows.

**The factfile opens progressively.** Visible: countdown, a six-cell icon-led "at a glance" grid,
requirements as an icon board, process as a stepped track, and the rank breakdown as bars. Collapsed
behind `<details>`: company facts with sources, recent news, and the raw posting text.

## What C contributed

C lost, but three of its ideas are carried into D and must survive into Stage 6:

- **Unknown is a rendered value.** "Not stated" appears in the same slot, same size, as a known value.
- **Provenance stays inline.** The source domain sits next to the value it justifies, permanently,
  not behind a hover.
- **A source-integrity warning** on the company summary, because the wrong-entity bug below is real.

## Accessibility notes carried into Stage 6

- Sector is the only thing encoded primarily by hue. It carries a `title`, the legend names the
  mapping, and the word appears in full on the factfile. Deadline urgency is colour **and** a number
  **and** a band heading — never colour alone.
- Contrast: body text `--ink-2` `oklch(0.760 0.011 322)` on `--bg` `oklch(0.183 0.014 322)` ≈ 7:1.
  `--ink-3` is reserved for ≥12px labels and decorative glyphs.
- Every transition is disabled under `prefers-reduced-motion`.

## Open items this stage surfaced (not design bugs)

1. **Wrong-entity Wikipedia matches — FIXED 2026-09-22.** The company summary was fetched by name, and
   short or ambiguous names resolved to the wrong article. `lib/research/wikipedia.ts` `pickSummary()`
   only asked *"does this read like an organisation?"* (an `ORG_WORDS` regex over the short
   description) — it never compared the article title to the employer name. The **LLM** guard added in
   `13fa0ab` (`wikipedia_matches_employer`) is model-dependent: it cleared `ICE` but waved through
   `Attio → GV (company)`, `Allye Energy → List of Cadbury brands`, `Freshminds → Caroline Plumb` and
   `Blenheim Chalcot → Manoj Badale`, with Attio the top-ranked role in the list.

   `titleMatchesName()` is now a deterministic first tier, run before the org-words test and before any
   LLM call. The **head** of the employer name (its first identity-bearing word) must equal, or be a
   prefix of, a word in the article title — or an initialism must spell the other side out **exactly**,
   in either direction. It strips legal/geographic/category words (Ltd, Group, UK, International,
   Services, Capital, Equity…), folds accents and absorbs an in-word `&`. The LLM guard stays as tier 2
   for pairs that share nothing textual, or whose shared text is ambiguous.

   **17 wrong matches found, 0 legitimate ones lost.** Audited against all 173 wikipedia-sourced
   companies: the four above plus Hymans Robertson → *Collective defined contribution*, Ameresco →
   *Energy service company*, Private Equity Insights → *Ardian*, Codestone → *Tagetik*, Turner &
   Townsend → *International Institute for Conservation*, IGES Institut → *Clock-face scheduling*,
   Langan Engineering → *Starrett City Associates*, five parent-company or brand-list articles
   (BakerHicks → Morgan Sindall, e.surv → LSL Property Services, M Group Services → Telent, Budweiser
   Brewing Group UK&I → Anheuser-Busch brands, MI5/MI6/GCHQ → British intelligence agencies), and
   `J.P. Morgan` → *J. P. Morgan*, **the banker rather than the bank**. That last one now resolves to
   `J.P._Morgan_&_Co.`.

   **Lesson from the cleanup run:** a stricter tier 1 changes *which* article the candidate loop lands
   on, because rejecting hit #1 makes it try hit #2. The first version let three companies walk on to
   another wrong article that shared only a trailing or one-letter word (`Insight Partners`, `Genesee
   Brewing Company`, `M-Brain Group`). Tier 2 caught all three in the run, and the head-word rule now
   catches them in tier 1. So the real check is `wikipediaSummary()` against the live API, not
   `titleMatchesName()` against the old resolutions. Both are regression tests now, alongside eight
   legitimate pairs an earlier cut wrongly rejected (`S&P Global`, `P&G → Procter & Gamble`,
   `L'Oreal → L'Oréal`, `Societe Generale`, `Citi → Citigroup`, `Franklintempleton`, `JPMorganChase`,
   `Lseg → London Stock Exchange Group`).

   Known gaps, all failing closed (no Wikipedia summary, which is the safe direction): a mixed-case
   initialism (`PwC → PricewaterhouseCoopers`) isn't detected; a name that leads with a generic-looking
   word that isn't in the strip list (`Bank of America Merrill Lynch → Merrill Lynch`) is rejected; and
   a person who shares the firm's exact name can only ever be caught by tier 2.
2. **Logo coverage.** 194/527 companies have `logo_url`, 222 have `domain` — so ~58% of rows render
   the initials fallback. It is now a 30px designed element rather than an afterthought, but deriving
   `domain` from `apply_url`/`canonical_url` would recover a lot of real logos.
3. **Rank ties.** Many roles sit on exactly 10 because sector + ai_forward + kind saturate. Fine for
   now; if the list feels undifferentiated in use, the tiebreak wants revisiting in `lib/pipeline/rank.ts`.
