/**
 * Code-enforced "no submit": an init script the runner adds to the run's browser (Playwright MCP --init-script), so
 * the employer's final Submit control cannot be activated from inside a run, whatever a prompt or a web page says.
 * Jonno submits himself in v1: once a run is `ready` and its claude process has exited, the runner sets
 * `window.__gfGuardOff = true` in the open pages (lib/runs/browser.ts `releaseGuard`) so he can press Submit by hand.
 * The script blocks click, submit events and programmatic form.submit()/requestSubmit()
 * for a form that contains a final-submit control. "Save and Continue" is untouched.
 *
 * Final-submit controls: tal.net's `submit_button`, or a button whose text is Submit / Submit application /
 * Confirm and submit. Add other ATSs here as their forms are met, with a test.
 */
export const FINAL_SUBMIT_TEXT = "^\\s*(submit( my)?( application)?|confirm and submit|final submit)\\s*$";

export function submitGuardScript(): string {
  return `(function () {
  if (window.__gfGuard) return;
  window.__gfGuard = true;
  // A beforeunload prompt freezes every Playwright MCP call until it is answered (run 17: one 13-minute stall).
  var addL = window.addEventListener;
  window.addEventListener = function (t) { if (t === "beforeunload") return; return addL.apply(this, arguments); };
  try { Object.defineProperty(window, "onbeforeunload", { get: function () { return null; }, set: function () {} }); } catch (e) {}
  var TEXT = new RegExp(${JSON.stringify(FINAL_SUBMIT_TEXT)}, "i");
  var isFinal = function (el) {
    if (!el || !el.matches) return false;
    if (el.name === "submit_button") return true;
    if (!el.matches("button, input[type=submit], input[type=button], [role=button]")) return false;
    return TEXT.test((el.textContent || el.value || "").trim());
  };
  var block = function (e) {
    if (window.__gfGuardOff) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    console.warn("gradfinder: final submit blocked. You submit the form yourself, by hand.");
  };
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("button, input, [role=button]") : null;
    if (isFinal(t)) block(e);
  }, true);
  document.addEventListener("submit", function (e) {
    if (window.__gfGuardOff) return;
    if (isFinal(e.submitter) || (e.target && e.target.querySelector && e.target.querySelector("[name=submit_button]") && !e.submitter)) block(e);
  }, true);
  ["submit", "requestSubmit"].forEach(function (fn) {
    var orig = HTMLFormElement.prototype[fn];
    HTMLFormElement.prototype[fn] = function () {
      if (!window.__gfGuardOff && this.querySelector("[name=submit_button]")) { console.warn("gradfinder: final submit blocked."); return; }
      return orig.apply(this, arguments);
    };
  });
})();
`;
}
