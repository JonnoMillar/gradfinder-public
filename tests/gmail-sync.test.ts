/** The Gmail check's gate: what it searches and what counts as new (lib/tracker/gmail.ts). */
import { describe, expect, it } from "vitest";
import { buildQueries, newIds, plainBody, pruneSeen, searchAfter } from "@/lib/tracker/gmail";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const b64 = (s: string) => Buffer.from(s).toString("base64url");

describe("searchAfter", () => {
  it("starts 2 days before the later of the last check and the newest email", () => {
    expect(searchAfter({ lastCheckedAt: "2026-10-14T19:00:00Z", seen: {} }, "2026-10-08T14:00:30Z", NOW)).toBe("2026/10/12");
    expect(searchAfter({ lastCheckedAt: null, seen: {} }, "2026-10-08T14:00:30Z", NOW)).toBe("2026/10/06");
  });
  it("falls back to 14 days on the first run", () => {
    expect(searchAfter({ lastCheckedAt: null, seen: {} }, null, NOW)).toBe("2026/10/01");
  });
});

describe("buildQueries", () => {
  it("one query for all companies, legal suffixes dropped, digests excluded", () => {
    const qs = buildQueries(["Acme & Co UK LTD", "Globex", "Globex", 'Odd "Name"'], "2026/10/12");
    expect(qs).toHaveLength(3);
    expect(qs.every((q) => q.startsWith("after:2026/10/12 -from:(brightnetwork"))).toBe(true);
    expect(qs[2]).toContain('{"Acme & Co" "Globex" "Odd Name"}');
  });
  it("no company query when nothing is tracked", () => {
    expect(buildQueries([], "2026/10/12")).toHaveLength(2);
  });
});

describe("newIds", () => {
  it("drops recorded and already-seen ids, and duplicates across queries", () => {
    const state = { lastCheckedAt: null, seen: { s1: "2026-10-14T00:00:00Z" } };
    expect(newIds(["a", "r1", "s1", "a", "b"], new Set(["r1"]), state)).toEqual(["a", "b"]);
  });
});

describe("pruneSeen", () => {
  it("forgets ids older than 60 days", () => {
    const s = pruneSeen({ lastCheckedAt: null, seen: { old: "2026-07-01T00:00:00Z", recent: "2026-10-01T00:00:00Z" } }, NOW);
    expect(Object.keys(s.seen)).toEqual(["recent"]);
  });
});

describe("plainBody", () => {
  it("prefers text/plain inside multipart", () => {
    const payload = { mimeType: "multipart/alternative", parts: [
      { mimeType: "text/html", body: { data: b64("<p>html</p>") } },
      { mimeType: "text/plain", body: { data: b64("Dear Jonno,\n\n  Please complete   the test.") } },
    ] };
    expect(plainBody(payload)).toBe("Dear Jonno,\nPlease complete the test.");
  });
  it("falls back to HTML text, and caps length", () => {
    const payload = { mimeType: "text/html", body: { data: b64("<div>Invitation <b>to interview</b></div>") } };
    expect(plainBody(payload)).toBe("Invitation to interview");
    expect(plainBody(payload, 10)).toBe("Invitation");
  });
});
