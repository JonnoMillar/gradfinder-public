/** The hosted demo ships posting excerpts, never an employer's whole page (scripts/demo-export.ts). */
import { describe, expect, it } from "vitest";
import { excerpt } from "../scripts/demo-export";

describe("posting excerpt", () => {
  it("keeps whole opening paragraphs up to the limit and says where the rest is", () => {
    const text = ["First para.", "Second para here.", "x".repeat(500)].join("\n\n");
    expect(excerpt(text, 40)).toBe("First para.\n\nSecond para here.…\n\nExcerpt only: the full posting is on the employer's site (Open posting).");
  });
  it("cuts one long paragraph at a word, never mid-word", () => {
    const out = excerpt("word ".repeat(200), 50)!;
    expect(out.split("…")[0]).toMatch(/^(word ?)+$/);
    expect(out.split("…")[0].length).toBeLessThanOrEqual(50);
  });
  it("leaves a missing description missing", () => {
    expect(excerpt(null)).toBeNull();
  });
});
