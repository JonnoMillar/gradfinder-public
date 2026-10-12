# Extraction calibration audit — 2026-09-21 (Stage 4, task 0)

20 extracted postings, hand-labelled **cold** (description read and schema filled before looking at the stored
answer), then diffed. Stratified: 12 `gemini-3.1-flash-lite` (8 kept/other-excluded + 4 excluded on
`not_entry_level:description`), 4 Groq `gpt-oss-120b`, 4 `gemini-3.6-flash` (all 4 happened to be
`not_entry_level:description` exclusions). IDs: 472 583 603 618 1390 635 1185 759 · 533 1050 592 1159 · 287 299 316 68 · 655 688 532 1139.

"Agree" = my primary answer or a listed acceptable alternative (e.g. `unknown` vs `true` for is_entry_level where the
posting never states it; `register_interest` vs `graduate_scheme` where the source's structural kind wins anyway).

| Field | Agree | Disagreements |
|---|---|---|
| kind | 19/20 | #532 model `other` vs mine `graduate_job` for a non-grad Anaplan role — prompt ambiguity, harmless (excluded anyway) |
| function | 19/20 | #1159 `engineering` vs `consulting` for "Applied AI Engineer, Government" — ambiguous posting, neither is an excluded function |
| is_entry_level | 18/20 | #472 Wayve kept though "Strong software engineering experience … building production services" (I say false); #583 untestable (excluded on function first). See note below |
| degree_class | 20/20 | — |
| subjects | 20/20 | — |
| visa_sponsorship | 20/20 | #635, #316 correctly `false`; #533 correctly `true` |
| cv / cover_letter / motivational_questions / video_interview / online_tests / assessment_centre | 20/20 each | #287 (Berkeley) got cv/online_tests/assessment_centre = true with the right quotes; nothing hallucinated |
| process_stages | 20/20 | — |
| deadline_text | 19/20 | #287 model quoted the posting's stale "open on 13th November 2025 and will close on 2nd January" — verbatim and real; source-parsed "Ongoing" wins in `jobs.deadline_text` anyway |

**Exclusions:** all 8 `not_entry_level:description` exclusions in the sample were correct (6+ / 5+ / 8+ years, "proven
track record", "Engineer III"). No false exclusion found.

**Lenient keeps:** the prompt says `false` "ONLY if the posting requires prior professional experience (e.g. 3+
years)"; the models read that as needing a number. A regex sweep over all 145 kept cloud-extracted rows found 3 clear
false-keeps (#472 Wayve, #759 OpenAI Codex "Have experience building or shipping…", #1262 ElevenLabs "Proven track
record"). ≈2%, and in the safe direction (noise in the list, not a missed job). **Decision: not tightening the rule** — a
stricter wording risks the costlier error, and re-extracting every kept row for consistency is API quota we don't have.

## Systematic misses → fixed (commit 371ec45)

1. **`application_requirements.other` misuse** — 13/232 rows copied the interview stages into it (#533 Monzo: "Initial
   Call, Take home task…"), ~20 filed how-to-apply sentences ("please apply through our careers portal", "Drop us your
   application", "click 'Apply'"). Class: prompt ambiguity (`other` was undefined). Fix: prompt now defines it as
   *materials to submit*; `cleanRequirementsOther()` in `groundExtraction` drops entries that duplicate a process stage
   or read as an apply-instruction. Test added. Backfilled onto the 293 already-extracted rows (23 changed) with no LLM
   calls, since the rule is deterministic.
2. **`is_entry_level` was unobservable** on kept rows (only surfaced when it caused an exclusion), so the audit could not
   separate `true` from `unknown`. Now stored as a posting fact with its evidence quote. Test added.

## Not fixed, noted
- `kind` for non-graduate jobs is inconsistent across models (`graduate_job` vs `other`); only affects `kind_bonus`
  (+1 vs −1) on kept rows. Revisit if it shows up in the ranked list.
- #533: "shipped an app in the Play Store" landed in `eligibility.other` — reasonable.
- Ollama rows (60) were not sampled: they are re-extracted by `scripts/_redo_pregrounding.ts` once the backlog run ends.
