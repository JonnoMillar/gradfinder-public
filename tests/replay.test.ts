import { describe, expect, it } from "vitest";
import { script, settle } from "@/components/ClimbReplay";

const at = (d: number, min = 0) => new Date(Date.UTC(2026, 9, d, 12, min)).toISOString();

describe("Climb replay script", () => {
  it("ends with the counts the stairs show, and undone rejections are not buried", () => {
    const { beats, T } = script([
      { appId: 1, to: "applying", at: at(1) },
      { appId: 1, to: "applied", at: at(2) },
      { appId: 2, to: "applied", at: at(2) },
      { appId: 2, to: "tests", at: at(3) },
      { appId: 2, to: "tests_done", at: at(4) },   // same stage: a nudge
      { appId: 1, to: "rejected", at: at(5) },
      { appId: 2, to: "rejected", at: at(6) },
      { appId: 2, to: "tests_done", at: at(7) },   // the rejection undone a day later: real history, kept
      { appId: 3, to: "interested", at: at(7) },
      { appId: 3, to: "closed", at: at(8) },
      { appId: 4, to: "rejected", at: at(9) },     // never on the climb: its grave just appears
    ], { lin: 10_000, per: 100 });
    const last = beats[beats.length - 1];
    expect(last.counts).toEqual([0, 0, 1, 0, 0, 0]);
    expect(last.buried).toBe(2);
    expect(last.sent).toBe(2);
    expect(beats.map((b) => b.step.kind)).toEqual(["move", "move", "move", "move", "nudge", "fall", "fall", "move", "move", "leave", "reveal"]);
    expect(beats.filter((b) => b.unbury).map((b) => b.appId)).toEqual([2]);
    // part real time (10 s over the span), part queue (100 ms a beat)
    expect(beats[0].t).toBe(0);
    expect(last.t).toBe(10_000 + 10 * 100);
    expect(T).toBe(last.t);
    expect(beats.every((b, i) => i === 0 || b.t >= beats[i - 1].t + 100)).toBe(true);
  });

  it("drops a move undone within the hour, with its undo", () => {
    const moves = [
      { appId: 2, to: "applied", at: at(1) },
      { appId: 2, to: "tests", at: at(2) },
      { appId: 2, to: "applied", at: at(5, 0) },   // misclick back...
      { appId: 2, to: "tests", at: at(5, 1) },     // ...and forward again a minute later
      { appId: 2, to: "tests_done", at: at(6) },
      { appId: 7, to: "hirevue_done", at: at(4) },
      { appId: 7, to: "rejected", at: at(6, 0) },  // a wrong rejection...
      { appId: 7, to: "hirevue_done", at: at(6, 30) },   // ...put right half an hour later
    ];
    expect(settle(moves).map((m) => `${m.appId}:${m.to}`)).toEqual(["2:applied", "2:tests", "2:tests_done", "7:hirevue_done"]);
    // the same back-and-forth over days is history, kept
    expect(settle([{ appId: 1, to: "tests", at: at(1) }, { appId: 1, to: "applied", at: at(2) }, { appId: 1, to: "tests", at: at(3) }])).toHaveLength(3);
  });
});
