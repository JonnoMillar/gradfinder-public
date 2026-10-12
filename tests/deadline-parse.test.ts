import { describe, expect, it } from "vitest";
import { deadlineFromDescription, parseDeadlineText } from "@/lib/pipeline/parse/deadline";

describe("parseDeadlineText", () => {
  it("reads the formats the sources actually use (2026-09-29 audit)", () => {
    expect(parseDeadlineText("29th Sep 2026")).toBe("2026-09-29");
    expect(parseDeadlineText("Wednesday 30th September 2026")).toBe("2026-09-30");
    expect(parseDeadlineText("Friday 30 October 2026")).toBe("2026-10-30");
    expect(parseDeadlineText("25th October 2026, 23:55")).toBe("2026-10-25");
    expect(parseDeadlineText("1 November 2026")).toBe("2026-11-01");
    expect(parseDeadlineText("2026-10-02")).toBe("2026-10-02");
    expect(parseDeadlineText("Applications close at 18:00 PM on 27 September 2026 but apply early")).toBe("2026-09-27");
    expect(parseDeadlineText("September 30, 2026")).toBe("2026-09-30");
    expect(parseDeadlineText("30/09/2026")).toBe("2026-09-30");
  });
  it("never invents a day or a year", () => {
    expect(parseDeadlineText("Ongoing")).toBeNull();
    expect(parseDeadlineText("Applications are reviewed on a rolling basis")).toBeNull();
    expect(parseDeadlineText("Application deadline: October 2027 - Exact date to be confirmed")).toBeNull();
    expect(parseDeadlineText("2nd January")).toBeNull();
    expect(parseDeadlineText("31st September 2026")).toBeNull();
    expect(parseDeadlineText("Ongoing Start Date:September 2026")).toBeNull();
    expect(parseDeadlineText("No deadline or start date given. Posted on Ashby 28 Aug 2026")).toBeNull();
  });
  it("ignores Bright Network's 28 Feb 2027 placeholder", () => {
    expect(parseDeadlineText("28th Feb 2027")).toBeNull();
  });
  it("does not read a start date or other number as a month", () => {
    expect(parseDeadlineText("12 positions 2026")).toBeNull();
  });
});

describe("deadlineFromDescription", () => {
  it("takes the date after a closing-date phrase only", () => {
    expect(deadlineFromDescription("Start Date: 1st September 2027. Closing date: 27th September 2026. Assessment centre 3 November 2026"))
      .toBe("2026-09-27");
    expect(deadlineFromDescription("Start date 1st September 2027. Assessment centre 3 November 2026")).toBeNull();
  });
});
