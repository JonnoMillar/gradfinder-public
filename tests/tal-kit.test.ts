/** The tal.net form kit: follow-up chains settle, duplicate option values pick the right option, Continue is guarded. */
// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const KIT = fs.readFileSync(path.resolve("lib/apply/ats/tal-kit.js"), "utf8");

/** A page shaped like a tal.net eform: answering "UK school?" reveals the school and exam fields, and so on. */
function page() {
  const dom = new JSDOM(`<!doctype html><body><form>
    <div class="form-group"><label for="uk">Did you study in the UK? *</label>
      <select id="uk" name="datafield_1"><option>Select</option><option>Yes</option><option>No</option></select></div>
    <div class="form-group" id="g2" data-hidden="1"><label for="yr">Exam results year? *</label>
      <select id="yr" name="datafield_2"><option>Select</option><option>2023</option><option>2024</option></select></div>
    <div class="form-group" id="g3" data-hidden="1"><label for="sch">School name *</label>
      <input id="sch" name="datafield_3" type="text"></div>
    <div class="form-group"><label for="dial">Dial code</label>
      <select id="dial" name="datafield_4--DIAL_CODE"><option>Country Code</option>
        <option value="44">Guernsey +44</option><option value="44">United Kingdom +44</option></select></div>
    <div class="form-group"><label for="opt">Anything else?</label><input id="opt" name="datafield_5" type="text"></div>
    <button type="submit" id="continue_button" name="continue_button">Save and Continue</button>
  </form></body>`, { runScripts: "outside-only" });
  const w = dom.window as unknown as Record<string, unknown> & Window;
  w.__gfVisible = (e: Element) => !e.closest("[data-hidden]");
  const doc = w.document;
  doc.getElementById("uk")!.addEventListener("change", () => {
    if ((doc.getElementById("uk") as HTMLSelectElement).value === "Yes") doc.getElementById("g2")!.removeAttribute("data-hidden");
  });
  doc.getElementById("yr")!.addEventListener("change", () => {
    if ((doc.getElementById("yr") as HTMLSelectElement).value !== "Select") doc.getElementById("g3")!.removeAttribute("data-hidden");
  });
  let clicks = 0;
  doc.getElementById("continue_button")!.addEventListener("click", (e) => { e.preventDefault(); clicks++; });
  dom.window.eval(KIT);
  const gf = (w as unknown as { __gf: Record<string, (...a: unknown[]) => unknown> }).__gf;
  return { dom, gf, doc, clicks: () => clicks };
}

describe("tal kit", () => {
  it("dump lists only visible fields with their required flag", () => {
    const { gf } = page();
    const names = (gf.dump() as { name: string; required: boolean }[]).map((f) => f.name);
    expect(names).toEqual(["datafield_1", "datafield_4--DIAL_CODE", "datafield_5"]);
  });

  it("settle keeps going until follow-up fields stop appearing", () => {
    const { gf } = page();
    const out = gf.settle([
      { match: "study in the UK", value: "Yes" },
      { match: "Exam results year", value: "2023" },
      { match: "School name", value: "Riverside College" },
    ]) as { applied: { name: string }[]; unresolved: unknown[]; passes: number };
    expect(out.applied.map((a) => a.name)).toEqual(["datafield_1", "datafield_2", "datafield_3"]);
    expect(out.unresolved).toEqual([]);
    expect(out.passes).toBeGreaterThanOrEqual(3);
  });

  it("settle reports required fields no rule covers, and never guesses a value", () => {
    const { gf } = page();
    const out = gf.settle([{ match: "study in the UK", value: "Yes" }]) as { unresolved: { label: string }[] };
    expect(out.unresolved.map((u) => u.label)).toEqual(["Exam results year? *"]);
  });

  it("select works by index, so a duplicate option value picks the right label", () => {
    const { gf, doc } = page();
    expect(gf.select("datafield_4--DIAL_CODE", "United Kingdom +44")).toBe("ok");
    const s = doc.getElementById("dial") as HTMLSelectElement;
    expect(s.selectedOptions[0].textContent).toBe("United Kingdom +44");
    expect(gf.select("datafield_4--DIAL_CODE", "Nowhere +1")).toMatch(/no option/);
  });

  it("next refuses to Continue while a required field is unanswered, then clicks once it is settled", async () => {
    const { gf, clicks } = page();
    const blocked = gf.next() as { clicked: boolean; unresolved: unknown[] };
    expect(blocked.clicked).toBe(false);
    expect(blocked.unresolved).toHaveLength(1);
    gf.settle([
      { match: "study in the UK", value: "Yes" }, { match: "Exam results year", value: "2023" },
      { match: "School name", value: "Riverside College" },
    ]);
    expect(gf.next()).toEqual({ clicked: true });
    await new Promise((r) => setTimeout(r, 80));
    expect(clicks()).toBe(1);
  });
});
