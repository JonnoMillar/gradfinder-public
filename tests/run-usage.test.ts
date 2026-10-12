/** A run's usage is the sum of every pass's result object in its log, stray stderr lines and all. */
import { describe, expect, it } from "vitest";
import { usageFromLog } from "@/lib/runs/usage";

describe("usageFromLog", () => {
  it("sums every pass", () => {
    const log = [
      `{"type":"result","num_turns":16,"duration_ms":31529,"total_cost_usd":0.2309994}`,
      "Warning: something on stderr",
      `{"type":"result","num_turns":29,"duration_ms":63957,"total_cost_usd":0.4426896}`,
    ].join("\n");
    const u = usageFromLog(log);
    expect(u.passes).toBe(2);
    expect(u.costUsd).toBeCloseTo(0.673689, 5);
    expect(u.turns).toBe(45);
    expect(u.minutes).toBeCloseTo(1.5914, 3);
  });

  it("reads an empty log as zero", () => {
    expect(usageFromLog("")).toEqual({ passes: 0, costUsd: 0, turns: 0, minutes: 0 });
  });
});
