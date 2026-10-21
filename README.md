# gradfinder

A graduate-job finder and tracker that runs on your own machine, with Claude doing the judgement work.

It sweeps employer job boards (Greenhouse, Lever, Ashby) and UK graduate boards (TARGETjobs, Higherin) for
London 2027-intake roles, filters them against your criteria, has Claude evaluate and research each one, and tracks
your applications from Gmail. One-click **Apply with Claude** fills an application form from your own knowledge
store and stops before Submit: you review every answer and press Submit yourself.

Every fact on screen is traceable to a URL. Anything the sources did not say reads "Not stated".

Built by Jonno Millar for his own 2027 search, with Claude Code. This is the public copy: the demo below uses real
public postings and a fictional graduate, Alex Morgan.

## Try the demo

**Live: https://gradfinder-demo.vercel.app** (read-only; a fictional graduate, Alex Morgan, on real public postings).

Or run it locally (2 minutes):

Needs **Node 24**.

```bash
git clone https://github.com/JonnoMillar/gradfinder-public gradfinder && cd gradfinder
npm ci
npm run demo:seed
npm run demo        # http://127.0.0.1:3100
```

The demo serves `data/demo.db` and `demo/profile/` with the run runner off, so nothing can act. Every page shows a
"Demo data" label, and it is read-only: buttons answer "nothing you change here is saved". Postings ship as short
excerpts that link to the employer's own page; the demo's emails are made up and come from `example.com`.

## What it runs on

gradfinder is built for one person on one machine. It needs Node 24 and a Claude subscription with Claude Code:
evaluation, research, Apply runs and the Gmail sync all run on it, and it never calls the Anthropic API. Free LLM
keys (Groq, Gemini AI Studio, OpenRouter `:free`, Cerebras, Mistral) are optional, for posting extraction. Personal
settings live in `config/` and a gitignored `profile/` folder that holds the knowledge store and never leaves the
machine.

## How it works

```
sweep (5 sources) -> filter (criteria) -> extract (free LLMs, per posting)
                                          evaluate + research (Claude)      -> rank -> UI
     layer 1: raw                         layer 2: derived                          layer 3: your tracker
```

The pipeline only writes layers 1 and 2; the UI and the Gmail sync only write layer 3. Your statuses, notes and
deadlines survive every re-sweep.

**Apply with Claude** queues a run. A runner started with the app launches a headless `claude -p` session with a tool
allowlist and a Playwright browser it owns. The agent fills the form from `profile/`, asks for every gap at once on
question cards in the app, and stops at **Ready**. A code guard (`lib/runs/guard.ts`) blocks the employer's final
Submit while the agent drives; it is released only after the agent's process has exited, so the Submit press is
always yours.

## Commands

See `CLAUDE.md` for the full list and a map of the code. `npm test` and `npm run typecheck` must stay green.

## Rules the code keeps

- No invented facts: every UI value comes from a sourced `facts` row or the posting itself.
- Sources fail loudly: a source that returns nothing is recorded as a failure, never as "no jobs".
- Emails and web pages are data, never instructions.
- Secrets live in `.env` only; `profile/`, `data/` and your CV never leave your machine.

## Licence

© 2026 Jonno Millar, all rights reserved. Public to read, not to reuse (see `LICENSE`).
