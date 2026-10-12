/** Kit page parsers and writers: questions.md items (+ answering and undo), letter slots and pieces, cards, PDF pages. */
import { describe, expect, it } from "vitest";
import { USER } from "@/config/user";
import { letterSlots, parseCards, parseGaps, parsePieces, pdfPages, splitGap, withAnswer, withoutAnswer } from "@/lib/kit";

const QUESTIONS = [
  "## Open questions", "**Forms**", "why: Forms ask these.", "",
  "- [ ] Middle names: how should they appear?", "  - why: Forms want your legal name.", "  - do: Type them as on your passport.",
  "- [x] Done one",
  "- [ ] Religion: an answer?", "  - options: Prefer not to say | No religion",
  "### Drafts", "- [ ] Acme \\[ASK\\] `ideaflow`", "  - link: /jobs/2131",
  "**All settled**", "- [x] Gone",
].join("\n");

describe("parseGaps", () => {
  it("groups open items with their why / do / link / options, counts the settled ones, drops empty groups", () => {
    const g = parseGaps(QUESTIONS);
    expect(g.map((x) => [x.heading, x.why, x.items.length, x.done])).toEqual([["Forms", "Forms ask these.", 2, 1], ["Drafts", undefined, 1, 0]]);
    expect(g[0].items[0]).toEqual({ raw: "Middle names: how should they appear?", title: "Middle names", detail: "how should they appear?",
      why: "Forms want your legal name.", todo: "Type them as on your passport." });
    expect(g[0].items[1].options).toEqual(["Prefer not to say", "No religion"]);
    expect(g[1].items[0]).toMatchObject({ raw: "Acme \\[ASK\\] `ideaflow`", title: "Acme [ASK] ideaflow", link: "/jobs/2131" });
  });
});

describe("withAnswer / withoutAnswer", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  it("ticks the item, puts the answer after its sub-bullets, and undo restores the file exactly", () => {
    const md = withAnswer(QUESTIONS, "Middle names: how should they appear?", "Sam\nLee", now);
    const lines = md.split("\n");
    const i = lines.indexOf("- [x] Middle names: how should they appear?");
    expect(i).toBeGreaterThan(0);
    expect(lines[i + 3]).toBe(`  - answer [CONFIRMED] (${USER.name} via Kit, 2026-10-07): Sam / Lee`);
    expect(parseGaps(md)[0].items.map((x) => x.title)).toEqual(["Religion"]);
    expect(withoutAnswer(md, "Middle names: how should they appear?", "Sam\nLee")).toBe(QUESTIONS);
  });
  it("refuses an item that has changed", () => {
    expect(() => withAnswer(QUESTIONS, "Not there", "x", now)).toThrow(/changed/);
  });
  it("keeps CRLF files CRLF", () => {
    const crlf = QUESTIONS.replace(/\n/g, "\r\n");
    expect(withAnswer(crlf, "Religion: an answer?", "Prefer not to say", now)).toContain("\r\n  - answer [CONFIRMED]");
  });
});

describe("parsePieces", () => {
  it("reads reason and evidence bullets, drops source notes and the self-check", () => {
    const md = ["## His reason (paragraph 3 opener, pick one)", "", "- **R1, problem first:** Slow work by hand.", "  More text.",
      "", "Source: motivation.md.", "", "## Evidence blocks (paragraph 4, pick one)", "",
      "- **B1, leadership** (default, above). stories.md S3 [CONFIRMED].",
      "- **B2, pressure:** Six contracts before midnight. (S1 [CONFIRMED]; never a deal value.)", "",
      "## Self-check (2026-10-07)", "", "No em dashes."].join("\n");
    expect(parsePieces(md)).toEqual([
      { heading: "Your reason", hint: "paragraph 3 opener, pick one", items: [{ code: "R1", label: "problem first", text: "Slow work by hand. More text.", isDefault: false }] },
      { heading: "Evidence blocks", hint: "paragraph 4, pick one", items: [
        { code: "B1", label: "leadership", text: "", isDefault: true },
        { code: "B2", label: "pressure", text: "Six contracts before midnight.", isDefault: false },
      ] },
    ]);
  });
});

describe("parseCards", () => {
  it("reads question blocks and skips the header", () => {
    const md = ["# Interview cards", "intro", "## Tell me about yourself", "Type: Opener", "Source: S2", "- One", "- Two",
      "Note: Start with your name.", "## A time you failed", "Type: Competency", "Status: gap", "- Nothing yet"].join("\n");
    expect(parseCards(md)).toEqual([
      { question: "Tell me about yourself", type: "Opener", status: null, source: "S2", story: "", bullets: ["One", "Two"], notes: ["Start with your name."], cues: [] },
      { question: "A time you failed", type: "Competency", status: "gap", source: "", story: "", bullets: ["Nothing yet"], notes: [], cues: [] },
    ]);
  });

  it("reads S/T/A/R cue lines, the hint after a pipe being optional", () => {
    const md = ["## A team", "Type: Competency", "Source: S7", "Story: Quarter ends with Harry", "S: Harry | same role", "T: Who takes what?", "- Detail"].join("\n");
    expect(parseCards(md)[0].story).toBe("Quarter ends with Harry");
    expect(parseCards(md)[0].cues).toEqual([{ step: "S", word: "Harry", hint: "same role" }, { step: "T", word: "Who takes what?", hint: "" }]);
  });
});

describe("letterSlots", () => {
  it("splits fixed text from nested [slots]", () => {
    expect(letterSlots('Dear [name if known, else "[Firm] graduate team"],')).toEqual([
      { text: "Dear ", slot: false }, { text: 'name if known, else "[Firm] graduate team"', slot: true }, { text: ",", slot: false },
    ]);
    expect(letterSlots("[R1 or R2 below, then:] [ROLE-SPECIFIC: a fact.]").map((s) => s.slot)).toEqual([true, true]);
  });
});

describe("splitGap", () => {
  it("splits on an early colon, else after the first question", () => {
    expect(splitGap("Middle names: how should they appear on forms?")).toEqual({ title: "Middle names", detail: "how should they appear on forms?" });
    expect(splitGap("Which NYE version is right? If the chat version, reuse it?")).toEqual({ title: "Which NYE version is right?", detail: "If the chat version, reuse it?" });
    expect(splitGap("Comfortable stating the ball-boy figure as your own?")).toEqual({ title: "Comfortable stating the ball-boy figure as your own?", detail: "" });
  });
});

describe("pdfPages", () => {
  it("counts page objects, not the page tree", () => {
    const pdf = Buffer.from("<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type/Page/Parent 1 0 R >>", "latin1");
    expect(pdfPages(pdf)).toBe(2);
  });
});
