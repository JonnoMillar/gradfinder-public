import { describe, expect, it } from "vitest";
import { mondayOf, weekGoal, type GoalApp, type GoalMove } from "@/lib/tracker/goals";

// Wednesday 30 Sept 2026, midday local
const now = new Date(2026, 8, 30, 12);
const app = (id: number, status: string, appliedAt: string | null = null): GoalApp => ({ id, status, appliedAt });
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10).toISOString();

describe("weekGoal", () => {
  it("weeks start on Monday", () => {
    expect(mondayOf(now).getDate()).toBe(28);
    expect(weekGoal([], [], now)).toMatchObject({ weekStart: "2026-09-28", weekEnd: "2026-10-04", daysLeft: 5 });
  });

  it("targets at least 6 a week, minus live tests and interviews, never below 3", () => {
    expect(weekGoal([], [], now).target).toBe(6);
    const busy = [app(1, "tests"), app(2, "tests"), app(3, "interview")];
    expect(weekGoal(busy, [], now)).toMatchObject({ load: 2, target: 4 });
    const swamped = Array.from({ length: 8 }, (_, i) => app(i, "interview"));
    expect(weekGoal(swamped, [], now).target).toBe(3);
  });

  it("counts tests and HireVues separately, waiting and done this week", () => {
    const apps = [app(1, "tests"), app(2, "hirevue"), app(3, "hirevue")];
    const moves: GoalMove[] = [
      { appId: 4, from: "tests", to: "tests_done", at: at(2026, 9, 29) },
      { appId: 5, from: "hirevue", to: "hirevue_done", at: at(2026, 9, 30) },
      { appId: 6, from: "hirevue", to: "hirevue_done", at: at(2026, 9, 22) },   // last week
    ];
    expect(weekGoal(apps, moves, now)).toMatchObject({ tests: 1, hirevues: 2, testsDone: 1, hirevuesDone: 1, load: 1 });
  });

  it("raises the base when the 40-by-19-December pace needs more than 6", () => {
    const late = new Date(2026, 11, 7, 12);   // two weeks before the goal date, nothing sent
    expect(weekGoal([], [], late)).toMatchObject({ pace: 20, base: 20, target: 20 });
  });

  it("counts this week's sends and line-ups", () => {
    const apps = [app(1, "applied", at(2026, 9, 29)), app(2, "tests_done", at(2026, 9, 23)), app(3, "rejected", at(2026, 9, 30))];
    const moves: GoalMove[] = [
      { appId: 4, from: "discovered", to: "interested", at: at(2026, 9, 29) },
      { appId: 4, from: "interested", to: "applying", at: at(2026, 9, 30) },
      { appId: 5, from: "discovered", to: "interested", at: at(2026, 9, 25) },   // last week
    ];
    expect(weekGoal(apps, moves, now)).toMatchObject({ sent: 2, sentTotal: 3, linedUp: 1 });
  });

  it("streak: the open week counts once something is sent; one quiet week is forgiven", () => {
    // sent in the weeks of 7 and 14 Sept, quiet week of 21 Sept, sent again this week (28 Sept)
    const apps = [app(1, "applied", at(2026, 9, 8)), app(2, "applied", at(2026, 9, 15)), app(3, "applied", at(2026, 9, 29))];
    const g = weekGoal(apps, [], now);
    expect(g.streak).toMatchObject({ weeks: 3, restUsed: true, thisWeekCounts: true });
    // nothing yet this week: last week's run still stands
    const g2 = weekGoal([app(1, "applied", at(2026, 9, 22))], [], now);
    expect(g2.streak).toMatchObject({ weeks: 1, thisWeekCounts: false });
  });

  it("a second quiet week ends the streak", () => {
    const apps = [app(1, "applied", at(2026, 9, 1)), app(2, "applied", at(2026, 9, 29))];
    expect(weekGoal(apps, [], now).streak.weeks).toBe(1);
  });

  it("milestones", () => {
    expect(weekGoal([], [], now).milestone).toEqual({ prev: 0, next: 1 });
    const six = Array.from({ length: 6 }, (_, i) => app(i, "applied", at(2026, 9, 29)));
    expect(weekGoal(six, [], now).milestone).toEqual({ prev: 5, next: 10 });
  });
});
