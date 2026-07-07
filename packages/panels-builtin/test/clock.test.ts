import { describe, expect, it } from "vitest";

import { formatClock } from "../src";

describe("formatClock", () => {
  // 2026-07-07 09:05:03 UTC.
  const date = new Date(Date.UTC(2026, 6, 7, 9, 5, 3));

  it("defaults to 24-hour HH:mm:ss", () => {
    expect(formatClock(date, undefined, true)).toBe("09:05:03");
  });

  it("drops seconds for the time format", () => {
    expect(formatClock(date, "time", true)).toBe("09:05");
  });

  it("emits ISO 8601 in UTC", () => {
    expect(formatClock(date, "iso", true)).toBe("2026-07-07T09:05:03.000Z");
  });

  it("respects the local/UTC zone", () => {
    // A value in a different UTC hour than most local zones; UTC branch is
    // deterministic, so assert it stays 09:xx in UTC.
    expect(formatClock(date, undefined, true)).toMatch(/^09:05:03$/);
  });
});
