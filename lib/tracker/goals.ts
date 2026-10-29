/**
 * The weekly goal behind the "This week" rings (Jonno 2026-09-28). Pure: takes the tracker rows and a clock, so the
 * rules are unit-tested rather than eyeballed.
 *
 * - Target: at least 6 applications a week (Jonno: "more than 5", since much of each application is automated), or
 *   whatever pace the 40-by-19-December goal needs if that is higher. Live processes take time, so each role at
 *   tests costs half a slot and each at interview a whole one; never below 3.
 * - Rings, after Apple's Activity rings: applications sent (the target above), online assessments sat (fixed 3 a
 *   week) and HireVues recorded (fixed 2 a week). The last two depend on invites arriving, so a short ring can mean
 *   "none sent to me yet" rather than "not done": the legend says how many are waiting.
 * - Streak, after Duolingo, is kept separate from the target and has a low bar: a week counts if one application
 *   went in. One quiet week is forgiven per streak (the streak freeze), so a busy exam week doesn't wipe it.
 * - Milestones at 1, 5, 10, 20, 30 and 40 applications sent.
 *
 * Weeks run Monday to Sunday, local time.
 */

export const GOAL_TOTAL = 40;
export const GOAL_BY = "2026-12-19";
export const BASE_PER_WEEK = 6;
export const MIN_PER_WEEK = 3;
/** Fixed weekly targets for the other two rings (Jonno 2026-10-27): online assessments sat, HireVues recorded. */
export const TESTS_PER_WEEK = 3;
export const HIREVUES_PER_WEEK = 2;
export const MILESTONES =[1, 5, 10, 20, 30, 40] as const;
const SUBMITTED = new Set(["applied", "tests", "tests_done", "hirevue", "hirevue_done", "interview", "interview_done", "offer"]);
const DAY = 86_400_000;

export interface GoalApp { id: number; status: string; appliedAt: string | null }
export interface GoalMove { appId: number; from: string | null; to: string; at: string }

export interface WeekGoal {
  weekStart: string;            // YYYY-MM-DD (Monday)
  weekEnd: string;              // YYYY-MM-DD (Sunday)
  daysLeft: number;             // including today
  target: number;
  base: number;
  load: number;                 // slots taken by live tests/interviews
  tests: number;                // online tests waiting to be sat now (status tests)
  testsDone: number;            // online tests sat this week (moves to tests_done)
  hirevues: number;             // HireVues waiting to be recorded now (status hirevue)
  hirevuesDone: number;         // HireVues recorded this week (moves to hirevue_done)
  interviews: number;
  pace: number;                 // per week, to reach GOAL_TOTAL by GOAL_BY
  sent: number;                 // this week
  linedUp: number;              // this week
  sentTotal: number;
  streak: { weeks: number; restUsed: boolean; thisWeekCounts: boolean; history: { weekStart: string; sent: number }[] };
  milestone: { prev: number; next: number | null };
}

/** Monday 00:00 local of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Everything the rings, streak and milestone need. */
export function weekGoal(apps: GoalApp[], moves: GoalMove[], now = new Date()): WeekGoal {
  const start = mondayOf(now);
  const end = addDays(start, 7);
  const inWeek = (iso: string | null, s = start, e = end) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= s.getTime() && t < e.getTime();
  };

  const sentDates = apps
    .filter((a) => a.appliedAt && (SUBMITTED.has(a.status) || ["rejected", "closed"].includes(a.status)))
    .map((a) => a.appliedAt!);
  const sentTotal = sentDates.length;
  const sent = sentDates.filter((d) => inWeek(d)).length;

  const linedUp = new Set(
    moves.filter((m) => (m.to === "interested" || m.to === "applying") && inWeek(m.at)
      && (m.from === null || m.from === "discovered" || m.from === "interested")).map((m) => m.appId),
  ).size;

  const tests = apps.filter((a) => a.status === "tests").length;
  const hirevues = apps.filter((a) => a.status === "hirevue").length;
  const doneIn = (to: string) => new Set(moves.filter((m) => m.to === to && inWeek(m.at)).map((m) => m.appId)).size;
  const testsDone = doneIn("tests_done");
  const hirevuesDone = doneIn("hirevue_done");
  const interviews = apps.filter((a) => a.status === "interview").length;
  // a HireVue to record weighs like an online test
  const load = Math.floor((tests + hirevues) * 0.5 + interviews);

  const [gy, gm, gd] = GOAL_BY.split("-").map(Number);
  const weeksLeft = Math.max(1, Math.ceil((new Date(gy, gm - 1, gd).getTime() - start.getTime()) / (7 * DAY)));
  const pace = Math.max(0, Math.ceil((GOAL_TOTAL - sentTotal) / weeksLeft));
  const base = Math.max(BASE_PER_WEEK, pace);
  const target = Math.max(MIN_PER_WEEK, base - load);

  // streak: walk back week by week; the current week only counts once something is sent (it is still open)
  const history: { weekStart: string; sent: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const s = addDays(start, -7 * i);
    history.push({ weekStart: ymd(s), sent: sentDates.filter((d) => inWeek(d, s, addDays(s, 7))).length });
  }
  const thisWeekCounts = sent > 0;
  let weeks = thisWeekCounts ? 1 : 0;
  let restUsed = false;
  for (let i = 1; i < 60; i++) {
    const s = addDays(start, -7 * i);
    const n = sentDates.filter((d) => inWeek(d, s, addDays(s, 7))).length;
    if (n > 0) { weeks++; continue; }
    // one quiet week is forgiven, but only if the streak carries on before it
    const before = addDays(s, -7);
    const prevSent = sentDates.some((d) => inWeek(d, before, s));
    if (!restUsed && weeks > 0 && prevSent) { restUsed = true; continue; }
    break;
  }

  const next = MILESTONES.find((m) => m > sentTotal) ?? null;
  const prev = [...MILESTONES].reverse().find((m) => m <= sentTotal) ?? 0;

  return {
    weekStart: ymd(start), weekEnd: ymd(addDays(start, 6)),
    daysLeft: Math.round((end.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / DAY),
    target, base, load, tests, testsDone, hirevues, hirevuesDone, interviews, pace, sent, linedUp, sentTotal,
    streak: { weeks, restUsed, thisWeekCounts, history },
    milestone: { prev, next },
  };
}
