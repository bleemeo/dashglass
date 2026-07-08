import { describe, expect, it } from "vitest";

import { relativeTime } from "./relativeTime";

describe("relativeTime", () => {
  const now = Date.parse("2026-07-07T12:00:00Z");
  const ago = (seconds: number) =>
    relativeTime(new Date(now - seconds * 1000).toISOString(), now);

  it("returns empty for missing or invalid input", () => {
    expect(relativeTime(undefined, now)).toBe("");
    expect(relativeTime("not-a-date", now)).toBe("");
  });

  it("collapses very recent times to 'just now'", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(30)).toBe("just now");
  });

  it("picks the largest crossed unit", () => {
    expect(ago(90)).toBe("1m ago");
    expect(ago(3 * 3600)).toBe("3h ago");
    expect(ago(2 * 86400)).toBe("2d ago");
    expect(ago(40 * 86400)).toBe("1mo ago");
    expect(ago(400 * 86400)).toBe("1y ago");
  });

  it("never shows a negative age for clock skew", () => {
    expect(relativeTime(new Date(now + 10_000).toISOString(), now)).toBe(
      "just now",
    );
  });
});
