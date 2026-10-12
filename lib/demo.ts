/**
 * Demo mode (`npm run demo`, and the hosted demo): a fictional user on real public postings. Read-only: every server
 * action returns DEMO_READ_ONLY, so no visitor can change what the next one sees, and the run runner never starts.
 */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";
export const DEMO_READ_ONLY = { ok: false as const, error: "This is the demo: nothing you change here is saved." };
