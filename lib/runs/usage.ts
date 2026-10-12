/**
 * What a run cost in subscription usage, read from its own `data/runs/<id>/log.txt`.
 *
 * `claude -p --output-format json` prints one result object per pass, carrying `total_cost_usd` (the API-equivalent
 * price of that pass: on a Pro/Max plan it is usage, not a bill), `num_turns` and `duration_ms`. The runner appends
 * every pass to the same log, so summing them gives the run's total. A deleted run directory reads as zero.
 */
import fs from "node:fs";
import path from "node:path";
import { runDir } from "./launch";

export interface RunUsage { passes: number; costUsd: number; turns: number; minutes: number }

const sum = (text: string, key: string) => [...text.matchAll(new RegExp(`"${key}"\\s*:\\s*([0-9.]+)`, "g"))].map((m) => Number(m[1]));

export function usageFromLog(text: string): RunUsage {
  const costs = sum(text, "total_cost_usd");
  return {
    passes: costs.length,
    costUsd: costs.reduce((a, b) => a + b, 0),
    turns: sum(text, "num_turns").reduce((a, b) => a + b, 0),
    minutes: sum(text, "duration_ms").reduce((a, b) => a + b, 0) / 60_000,
  };
}

export function runUsage(runId: number): RunUsage {
  try {
    return usageFromLog(fs.readFileSync(path.join(runDir(runId), "log.txt"), "utf8"));
  } catch {
    return { passes: 0, costUsd: 0, turns: 0, minutes: 0 };
  }
}
