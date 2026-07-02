import { describe, expect, it } from "vitest";

import { formatValue } from "../src";

describe("formatValue", () => {
  it("formats plain numbers with automatic decimals", () => {
    expect(formatValue(1234.5678)).toBe("1235");
    expect(formatValue(42.123)).toBe("42.1");
    expect(formatValue(0.1234)).toBe("0.12");
    expect(formatValue(3)).toBe("3");
  });

  it("formats SI short values", () => {
    expect(formatValue(1500, "short")).toBe("1.50 k");
    expect(formatValue(2_500_000, "short")).toBe("2.50 M");
    expect(formatValue(-1500, "short")).toBe("-1.50 k");
    expect(formatValue(950, "short")).toBe("950");
  });

  it("formats bytes in IEC units", () => {
    expect(formatValue(1024, "bytes")).toBe("1 KiB");
    expect(formatValue(1536, "bytes")).toBe("1.50 KiB");
    expect(formatValue(3 * 1024 ** 3, "bytes")).toBe("3 GiB");
    expect(formatValue(1024, "bytesps")).toBe("1 KiB/s");
  });

  it("formats percentages", () => {
    expect(formatValue(42.5, "percent")).toBe("42.5%");
    expect(formatValue(0.425, "percentunit")).toBe("42.5%");
  });

  it("formats durations picking a readable unit", () => {
    expect(formatValue(0.25, "seconds")).toBe("250 ms");
    expect(formatValue(42, "seconds")).toBe("42 s");
    expect(formatValue(90, "seconds")).toBe("1.50 m");
    expect(formatValue(7200, "seconds")).toBe("2 h");
    expect(formatValue(172800, "seconds")).toBe("2 d");
    expect(formatValue(250, "milliseconds")).toBe("250 ms");
  });

  it("renders missing values as a dash", () => {
    expect(formatValue(null)).toBe("-");
    expect(formatValue(Number.NaN)).toBe("-");
  });
});
