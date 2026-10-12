/**
 * The default next step for each stage (Jonno 2026-09-29: "default per stage, editable"). Shown whenever a tracked role
 * has no next step of his own, so every live application always says what to do next. His own step (applications.
 * next_action) always wins; this is never written to the database.
 */

export interface Step { text: string; due: string | null; auto: true }

const DAY = 86_400_000;
/** chase a silent application after three weeks */
export const CHASE_AFTER_DAYS = 21;

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

export function defaultStep(status: string, appliedAt: string | null = null): Step | null {
  switch (status) {
    case "interested": return { text: "Fill out the application", due: null, auto: true };
    case "applying": return { text: "Submit the application", due: null, auto: true };
    case "applied": {
      const t = appliedAt ? Date.parse(appliedAt) : NaN;
      return { text: "Chase if nothing heard", due: Number.isNaN(t) ? null : ymd(t + CHASE_AFTER_DAYS * DAY), auto: true };
    }
    case "tests": return { text: "Complete the online test", due: null, auto: true };
    case "tests_done": return { text: "Wait for the result", due: null, auto: true };
    case "hirevue": return { text: "Record the HireVue", due: null, auto: true };
    case "hirevue_done": return { text: "Wait for the result", due: null, auto: true };
    case "interview": return { text: "Prepare for the interview", due: null, auto: true };
    case "interview_done": return { text: "Wait for the result", due: null, auto: true };
    case "offer": return { text: "Decide on the offer", due: null, auto: true };
    default: return null;
  }
}
