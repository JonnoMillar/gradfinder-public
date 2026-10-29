# ATS form-filling notes

How each applicant-tracking system behaves under browser automation. Mechanics only — no personal data here;
The user's facts live in the gitignored `profile/` store (see `profile/README.md`).

## Tooling
- Playwright MCP (`mcp__plugin_playwright_playwright__*`), headed local browser with its own profile — separate
  from the user's everyday Chrome, so the user logs in there by hand. Claude never types passwords.
- `browser_snapshot` writes a `.yml` to `.playwright-mcp/` in the repo root (gitignored — snapshots contain
  personal form data). A form page is ~100–260 lines, roughly 3–8k tokens.
- Workflow: read page → the user supplies/approves values → fill → read back and verify → the user approves → save.
  The user ticks declarations and presses the final submit.

## tal.net (Oleeo) — verified 2026-09-23 on a real graduate form
- **Logged out, eform URLs silently redirect to `/candidate` home.** After login it also lands on home — navigate
  to the eform URL again.
- **Drop the `xf-<token>` URL segment**; it rotates per session. Stable form:
  `https://<tenant>.tal.net/vx/lang-en-GB/mobile-0/appcentre-1/brand-<n>/user-<id>/spa-1/candidate/eform/<form-id>/page/<N>`
- Left-hand progress tracker links every page (`.../page/1` … `/page/N`), each marked complete/incomplete.
- Session timeout banner: 2 hours. Save each page ("Save and Continue").
- Cookie banner on first load: "I accept" / "Opt Out".
- **Dropdowns are custom widgets**: a visible `button` plus a hidden native `<select>` (`combobox [aria-hidden]`
  in the snapshot). Setting the hidden select directly is untested; what works: click the button, then click
  `role=option[name="..."]`. Long lists (countries, dial codes, counties) also show a search box.
- **Verify selects after filling**:
  `[...document.querySelectorAll('select')].map(s => ({name: s.name, value: s.value, text: s.selectedOptions[0]?.text}))`
  Field names look like `datafield_133504_1_1`; phone dial code is a separate select `…--DIAL_CODE`.
- Plain textboxes: `browser_fill_form` works (several fields in one call).
- Phone: pick the dial code from its own dropdown, type the national number without the country code.
- Address: set Country first; County/State options are then the UK counties (e.g. "Greater London").
- Dropdown button refs change after a selection — re-read the snapshot before the next click.
- **Answers reveal new questions (2026-09-30).** Picking "British" on page 4 opened "Did you study in the UK?",
  which opened the exam year, school, IB, part of the UK, A levels, AS levels… a chain of ~10 fields. Loop: answer one →
  re-list visible fields → answer the new one → repeat until nothing new appears. Only then click Continue, and only after
  every required field is filled. Never click Continue on the strength of the first snapshot.
- Visible-fields dump (skips hidden conditional selects, which `querySelectorAll('select')` lists by the hundred):
  `[...document.querySelector('main').querySelectorAll('input:not([type=hidden]),select,textarea')].filter(e=>e.getBoundingClientRect().height>0&&!e.closest('[aria-hidden=true]'))`
- After a Continue, check the progress tracker for pages still marked "Item incomplete" before moving on.
- `select[name="datafield_…"]` works with `browser_select_option` / `browser_fill_form` directly; no need to click the
  custom widget.

## Oracle Recruiting Cloud (WTW, eedu.fa.em3.oraclecloud.com) — filled by hand 2026-10-21, NOT yet a kit adapter
- One long page (all sections), saved server-side per email login; `/apply/section/1` bounces to the job page until logged in.
- Radio groups are `role=radiogroup`/`role=radio` buttons: click by option text via JS works. Text inputs need the native value setter + `input`/`change` events.
- Dates are JET comboboxes: click, ctrl+a, type, click the single suggestion (list pops up above/below and the page scrolls: re-screenshot between steps; coordinate clicks misfire).
- Each education/experience entry is its own form. Education asks "highest level" per entry (US-style list: A-levels = Other > High School Graduate), plus Country > State (county list, e.g. London / Nottinghamshire) > City.
- Pre-existing profile entries can disagree with facts.yaml: check dates against it. Entry cards show "Fields to fix: N" until complete.
- JS tool blocks some reads ("Cookie/query string data"): read state with screenshots instead.

## ByteDance (jobs.bytedance.com) — run 17, 2026-10-28
- **Never click "Parse the resume and overwrite text" (`[data-test=parseResume]`).** It reloads the page behind a
  prompt; the next Playwright call hung 13 minutes and the run hit its cap. Upload the CV and type the fields by hand.
- **A click that opens a file chooser freezes later calls until the chooser is answered** (a plain `browser_evaluate` took
  3.5 minutes). Click `.uploadPlaceholder-selectFile`, then call `browser_file_upload` as the very next call: no
  evaluate or snapshot in between. After any call that errors with "modal state", answer the modal first.
- One long page, nothing saved until Submit. Sections Work Experience, Internship, Project Experience, Work Samples,
  Honor and Awards, Language Skills, Self Introduction, SNS each start collapsed behind a `+ Add` link.
- Dropdowns are `ud__select` widgets (formily ids, `#formily-item-…`): the ref-based click times out at 5 s; click the
  `.ud__select__selector` inside the item id instead.
