/** The apply prompt carries the rules that must never be left to the agent's judgement. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPrompt, claudeArgs, drafterAgent, prepareRun } from "@/lib/runs/launch";
import { cdpUrl, chromePath } from "@/lib/runs/browser";
import type { RunRow } from "@/lib/runs/runs";
import { USER } from "@/config/user";

const run = { id: 7, kind: "apply", jobId: 1, applicationId: 2, state: "running" } as RunRow;

describe("apply prompt", () => {
  const p = applyPrompt(run);
  it("has a fixed, never-researched salary rule with a fallback that asks once", () => {
    expect(p).toMatch(/Salary expectation: one safe rule, never researched/);
    expect(p).toMatch(/exactly as printed on the live posting/);
    expect(p).toMatch(/Never a figure from gradfinder's database/);
    expect(p).toMatch(/fixed_figure/);
    expect(p).toMatch(/Never compute, estimate, average or adjust/);
  });
  it("forbids ticking the declaration, signing and submitting", () => {
    expect(p).toMatch(/Never tick the declaration, type an e-signature or press Submit/);
  });
  it("tells the agent the window is the runner's and must be left on the filled form", () => {
    expect(p).toMatch(/Never close the browser or any tab/);
    expect(p).toMatch(/leave the window on the filled form page/);
  });
  it("names every protected job and the configured voice guide", () => {
    for (const j of USER.protectedJobs) expect(p).toContain(`Never touch job ${j.id} (${j.label}).`);
    // Free text is the Sonnet drafter's job; the Haiku filler never reads the voice guide.
    expect(p).not.toContain(USER.voiceGuide.replace(/\\/g, "/"));
    expect(p).toMatch(/subagent_type: "drafter"/);
    const d = drafterAgent(run);
    expect(d.model).toBe("sonnet");
    expect(d.prompt).toContain(USER.voiceGuide.replace(/\\/g, "/"));
    expect(d.prompt).toMatch(/never_claim/);
    expect(d.prompt).toContain("npm run track -- draft data/runs/7/drafts.json");
    expect(p).toContain(`${USER.name} pressed Apply`);
  });
  it("points the agent at the form kit and the one-ask rule", () => {
    expect(p).toMatch(/window\.__gf\.settle/);
    expect(p).toMatch(/Then stop/);
  });
});

describe("claude arguments", () => {
  it("keep a headless run lean and limited", () => {
    const files = { dir: "d", promptFile: "d/prompt.md", mcpFile: "d/mcp.json", guardFile: "d/guard.js", agentsFile: "d/agents.json" } as ReturnType<typeof prepareRun>;
    const a = claudeArgs(run, files);
    expect(a[a.indexOf("--model") + 1]).toBe("haiku");
    expect(a[a.indexOf("--agents") + 1]).toBe("d/agents.json");
    expect(a).toContain("Agent(drafter)");
    const research = claudeArgs({ ...run, kind: "research" } as RunRow, { ...files, mcpFile: null, agentsFile: null });
    expect(research[research.indexOf("--model") + 1]).toBe("sonnet");
    expect(research).not.toContain("--agents");
    expect(a).toContain("--disable-slash-commands");
    expect(a.join(" ")).toMatch(/--setting-sources project/);
    expect(a).toContain("--strict-mcp-config");
    expect(a.join(" ")).not.toMatch(/Bash\(\*\)|WebFetch/);
    // Built-in tool schemas ride along on every turn: 45.5k → 17.9k tokens fixed context (2026-11-09).
    expect(a[a.indexOf("--tools") + 1]).toBe("Read,Bash,Edit,Write,Grep,ToolSearch,Agent");
    expect(a[a.indexOf("--max-budget-usd") + 1]).toBe(process.env.RUN_BUDGET_USD ?? "1.5");
    expect(claudeArgs(run, files, { maxBudgetUsd: 0 })).not.toContain("--max-budget-usd");
  });
  it("tells the agent not to bloat the context", () => {
    const p = applyPrompt(run);
    expect(p).toMatch(/Chain actions in one message/);
    expect(p).toMatch(/No full-page `browser_snapshot`/);
    expect(p).toMatch(/`CLAUDE.md` is already in your context: do not Read it/);
    expect(p).not.toMatch(/Read first[\s\S]{0,200}start-application\.md`, `docs/);
  });
});

describe("run browser wiring", () => {
  it("attaches the MCP to the runner's browser over CDP and denies closing it", () => {
    const cwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gradfinder-launch-"));
    process.chdir(tmp);
    try {
      const files = prepareRun(run);
      const cfg = JSON.parse(fs.readFileSync(files.mcpFile!, "utf8")).mcpServers.playwright.args.join(" ");
      expect(cfg).toContain(`--cdp-endpoint ${cdpUrl()}`);
      expect(cfg).not.toContain("--user-data-dir");
      const a = claudeArgs(run, files);
      const denied = a.slice(a.indexOf("--disallowedTools") + 1);
      expect(denied).toContain("mcp__playwright__browser_close");
    } finally {
      process.chdir(cwd);
    }
  });
  it("finds a browser from CHROME_PATH first, else a known install, else null", () => {
    const prev = process.env.CHROME_PATH;
    try {
      process.env.CHROME_PATH = "X:/mine/chrome.exe";
      expect(chromePath((p) => p === "X:/mine/chrome.exe")).toBe("X:/mine/chrome.exe");
      expect(chromePath(() => false)).toBeNull();
      delete process.env.CHROME_PATH;
      expect(chromePath((p) => p.endsWith("msedge.exe"))).toMatch(/msedge\.exe$/);
      expect(chromePath(() => false)).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = prev;
    }
  });
});
