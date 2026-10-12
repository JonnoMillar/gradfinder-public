/*
 * Form-fill kit for tal.net (Oleeo) application forms. Injected into every page by the runner (Playwright MCP
 * --init-script), so `window.__gf` survives navigation. Plain ES2019: it runs inside the employer's page.
 *
 * Why it exists (2026-09-30): answering one field revealed follow-up fields, the follow-ups revealed more,
 * and clicking Continue after the first answer saved a half-filled page. So `settle` re-reads the page after every
 * change until nothing new needs an answer, and `next` refuses to Continue while a required field is unanswered.
 *
 *   __gf.dump()                        visible fields: [{name,label,type,value,required,options}]
 *   __gf.select(name, text, {prefix})  choose an option BY INDEX (several countries share the +44 dial code value)
 *   __gf.text(name, value)             set a text field or textarea
 *   __gf.check(name, on)               tick or untick a checkbox
 *   __gf.settle(rules)                 answer everything the rules cover, repeat until stable. Returns
 *                                      {applied, unresolved, passes}. `rules` = [{match: "regex source", value, prefix?}]
 *   __gf.next()                        click Continue only if nothing required is unresolved
 *
 * Every rule value comes from profile/facts.yaml or Jonno's answer to a run question. The kit never invents a value.
 */
(function () {
  if (window.__gf) return;

  var visible = function (e) {
    if (window.__gfVisible) return window.__gfVisible(e);
    var r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !e.closest("[aria-hidden=true]");
  };
  // tal.net keeps the real <select> off-screen behind a styled button, so a select counts as visible when its
  // wrapper is.
  var shown = function (e) {
    if (e.tagName === "SELECT") {
      var w = e.closest(".form-group, .field, div") || e.parentElement;
      return !!w && (window.__gfVisible ? window.__gfVisible(w) : w.getBoundingClientRect().height > 0);
    }
    return visible(e);
  };
  var clean = function (s) { return (s || "").replace(/\s+/g, " ").trim(); };
  var labelOf = function (e) {
    var l = e.id && document.querySelector('label[for="' + e.id + '"]');
    if (!l) { var w = e.closest(".form-group, .field, fieldset, div"); l = w && w.querySelector("label, legend"); }
    return clean(l ? l.textContent : "");
  };
  var fields = function () {
    return Array.prototype.slice.call(document.querySelectorAll("input:not([type=hidden]):not([type=search]), select, textarea"))
      .filter(function (e) { return e.name && shown(e); });
  };
  var valueOf = function (e) {
    if (e.tagName === "SELECT") { var o = e.selectedOptions[0]; return o && e.selectedIndex > 0 ? o.textContent.trim() : ""; }
    if (e.type === "checkbox" || e.type === "radio") return e.checked ? "checked" : "";
    return e.value;
  };
  var fire = function (e) {
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  };

  var dump = function () {
    return fields().map(function (e) {
      var label = labelOf(e);
      return {
        name: e.name, label: label, type: e.tagName === "SELECT" ? "select" : e.type, value: valueOf(e),
        required: /\*\s*$/.test(label) || e.required,
        options: e.tagName === "SELECT" ? Array.prototype.map.call(e.options, function (o) { return o.textContent.trim(); }) : undefined,
      };
    });
  };

  var select = function (name, text, opts) {
    var s = document.querySelector('select[name="' + name + '"]');
    if (!s) return "missing " + name;
    var want = String(text).trim();
    var i = Array.prototype.findIndex.call(s.options, function (o) {
      var t = o.textContent.trim();
      return opts && opts.prefix ? t.indexOf(want) === 0 : t === want;
    });
    if (i < 0) return "no option '" + want + "' in " + name;
    s.selectedIndex = i;
    fire(s);
    return "ok";
  };
  var text = function (name, value) {
    var e = document.querySelector('[name="' + name + '"]');
    if (!e) return "missing " + name;
    e.value = value;
    fire(e);
    return "ok";
  };
  var check = function (name, on) {
    var e = document.querySelector('input[name="' + name + '"]');
    if (!e) return "missing " + name;
    if (e.checked !== !!on) e.click();
    return "ok";
  };

  var settle = function (rules, maxPasses) {
    var applied = [];
    var passes = 0;
    var res = (rules || []).map(function (r) { return { re: new RegExp(r.match, "i"), value: r.value, prefix: !!r.prefix }; });
    for (; passes < (maxPasses || 8); passes++) {
      var changed = false;
      dump().forEach(function (f) {
        if (f.value !== "" || f.type === "checkbox" || f.type === "radio") return;
        for (var k = 0; k < res.length; k++) {
          if (!res[k].re.test(f.label)) continue;
          var out = f.type === "select" ? select(f.name, res[k].value, { prefix: res[k].prefix }) : text(f.name, res[k].value);
          applied.push({ name: f.name, label: f.label.slice(0, 80), value: res[k].value, result: out });
          if (out === "ok") changed = true;
          return;
        }
      });
      if (!changed) break;
    }
    var unresolved = dump().filter(function (f) { return f.required && f.value === "" && f.type !== "checkbox"; })
      .map(function (f) { return { name: f.name, label: f.label.slice(0, 160), type: f.type, options: f.options }; });
    return { applied: applied, unresolved: unresolved, passes: passes + 1 };
  };

  var next = function () {
    var left = settle([], 1).unresolved;
    if (left.length) return { clicked: false, unresolved: left };
    var b = document.querySelector('[name="continue_button"], #continue_button');
    if (!b) return { clicked: false, unresolved: [], error: "no Continue button on this page" };
    setTimeout(function () { b.click(); }, 50);
    return { clicked: true };
  };

  window.__gf = { dump: dump, select: select, text: text, check: check, settle: settle, next: next };
})();
