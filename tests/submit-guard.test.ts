/** The submit guard blocks the final Submit control and nothing else. */
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { submitGuardScript } from "@/lib/runs/guard";

function page(html: string) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: "outside-only" });
  const submits: string[] = [];
  dom.window.document.addEventListener("submit", (e) => { e.preventDefault(); submits.push((e as SubmitEvent).submitter?.getAttribute("name") ?? "form"); });
  dom.window.eval(submitGuardScript());
  return { doc: dom.window.document, submits };
}

describe("submit guard", () => {
  const FORM = `<form id="f"><button type="submit" name="continue_button">Save and Continue</button>
                <button type="submit" name="submit_button">SUBMIT</button></form>`;

  it("blocks the tal.net final submit button click", () => {
    const { doc, submits } = page(FORM);
    (doc.querySelector("[name=submit_button]") as HTMLElement).click();
    expect(submits).toEqual([]);
  });
  it("lets Save and Continue through", () => {
    const { doc, submits } = page(FORM);
    (doc.querySelector("[name=continue_button]") as HTMLElement).click();
    expect(submits).toEqual(["continue_button"]);
  });
  it("blocks programmatic form.submit() and requestSubmit() on a form with the final submit control", () => {
    const { doc, submits } = page(FORM);
    const f = doc.getElementById("f") as HTMLFormElement;
    f.submit();
    f.requestSubmit();
    expect(submits).toEqual([]);
  });
  it("blocks a generic 'Submit application' button on another ATS", () => {
    const { doc, submits } = page(`<form><button type="submit">Submit application</button></form>`);
    (doc.querySelector("button") as HTMLElement).click();
    expect(submits).toEqual([]);
  });
  it("lets Submit through once the runner sets __gfGuardOff (Jonno submits by hand at ready)", () => {
    const { doc, submits } = page(FORM);
    const win = doc.defaultView as unknown as { __gfGuardOff?: boolean };
    const f = doc.getElementById("f") as HTMLFormElement;
    win.__gfGuardOff = true;
    (doc.querySelector("[name=submit_button]") as HTMLElement).click();
    f.requestSubmit();
    expect(submits).toEqual(["submit_button", "form"]);
  });
  it("does not touch an unrelated form", () => {
    const { doc, submits } = page(`<form id="s"><button type="submit" name="go">Search</button></form>`);
    (doc.querySelector("button") as HTMLElement).click();
    expect(submits).toEqual(["go"]);
  });
});
