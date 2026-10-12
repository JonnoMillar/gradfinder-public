/** The store index: one line per section with its line range and tags; raw imports and CV files never listed. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildIndex } from "@/lib/apply/kit-index";

describe("buildIndex", () => {
  it("maps sections, skips inbox and cv", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-"));
    fs.writeFileSync(path.join(dir, "stories.md"), ["# Stories", "", "## 1. Forecast", "Tags: initiative", "- S", "## 2. Football", "- S"].join("\n"));
    fs.writeFileSync(path.join(dir, "facts.yaml"), "name: x\n");
    for (const d of ["inbox", "cv"]) { fs.mkdirSync(path.join(dir, d)); fs.writeFileSync(path.join(dir, d, "a.md"), "## secret\n"); }
    const idx = buildIndex(dir);
    expect(idx).toContain("- stories.md:3-5 1. Forecast [initiative]");
    expect(idx).toContain("- stories.md:6-7 2. Football");
    expect(idx).toContain("- facts.yaml");
    expect(idx).not.toContain("secret");
  });
});
