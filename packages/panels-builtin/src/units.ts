import { z } from "zod";

/** Value units supported by the built-in panels. */
export const UNITS = [
  "none",
  "short",
  "percent",
  "percentunit",
  "bytes",
  "bytesps",
  "bitsps",
  "ops",
  "seconds",
  "milliseconds",
  "hertz",
  "celsius",
] as const;

/** The shared `unit` field of the built-in panel spec schemas. */
export const unitSchema = z.enum(UNITS);

export type Unit = (typeof UNITS)[number];

function autoDecimals(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude >= 100 || Number.isInteger(value)) {
    return 0;
  }
  return magnitude >= 10 ? 1 : 2;
}

function toFixed(value: number, decimals: number | undefined): string {
  return value.toFixed(decimals ?? autoDecimals(value));
}

/**
 * toFixed, but abbreviated past 10000 (12345678 → "12.3 M"): full digit
 * strings overflow stat tiles and gauge overlays. Used by the unit-less
 * and fixed-suffix formats; a huge "percent" is a mis-scaled query, but
 * it must still render bounded.
 */
function fixedOrScaled(value: number, decimals: number | undefined): string {
  if (Math.abs(value) >= 10000) {
    return scaled(value, 1000, SI_SUFFIXES, decimals);
  }
  return toFixed(value, decimals);
}

function scaled(
  value: number,
  base: number,
  suffixes: string[],
  decimals: number | undefined,
): string {
  let scaledValue = Math.abs(value);
  let index = 0;
  while (scaledValue >= base && index < suffixes.length - 1) {
    scaledValue /= base;
    index += 1;
  }
  const sign = value < 0 ? "-" : "";
  const suffix = suffixes[index]!;
  return `${sign}${toFixed(scaledValue, decimals)}${suffix ? ` ${suffix}` : ""}`;
}

const SI_SUFFIXES = ["", "k", "M", "G", "T", "P"];
const BYTE_SUFFIXES = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
const BIT_SUFFIXES = ["b", "kb", "Mb", "Gb", "Tb", "Pb"];
const HERTZ_SUFFIXES = ["Hz", "kHz", "MHz", "GHz", "THz"];

function formatSeconds(seconds: number, decimals: number | undefined): string {
  const magnitude = Math.abs(seconds);
  if (magnitude < 1) {
    return `${toFixed(seconds * 1000, decimals)} ms`;
  }
  if (magnitude < 60) {
    return `${toFixed(seconds, decimals)} s`;
  }
  if (magnitude < 3600) {
    return `${toFixed(seconds / 60, decimals)} m`;
  }
  if (magnitude < 86400) {
    return `${toFixed(seconds / 3600, decimals)} h`;
  }
  return `${toFixed(seconds / 86400, decimals)} d`;
}

/** Formats a value for display (axis ticks, tooltips, stat/table cells). */
export function formatValue(
  value: number | null | undefined,
  unit: Unit = "none",
  decimals?: number,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  switch (unit) {
    case "short":
      return scaled(value, 1000, SI_SUFFIXES, decimals);
    case "percent":
      return `${fixedOrScaled(value, decimals)}%`;
    case "percentunit":
      return `${fixedOrScaled(value * 100, decimals)}%`;
    case "bytes":
      return scaled(value, 1024, BYTE_SUFFIXES, decimals);
    case "bytesps":
      return `${scaled(value, 1024, BYTE_SUFFIXES, decimals)}/s`;
    case "bitsps":
      return `${scaled(value, 1000, BIT_SUFFIXES, decimals)}/s`;
    case "ops":
      // Generic per-second rate (operations, packets, requests, events…).
      return `${scaled(value, 1000, SI_SUFFIXES, decimals)}/s`;
    case "seconds":
      return formatSeconds(value, decimals);
    case "milliseconds":
      return formatSeconds(value / 1000, decimals);
    case "hertz":
      return scaled(value, 1000, HERTZ_SUFFIXES, decimals);
    case "celsius":
      return `${fixedOrScaled(value, decimals)} °C`;
    case "none":
      return fixedOrScaled(value, decimals);
  }
}

/**
 * Splits a formatted value into its numeric part and unit suffix, so a
 * KPI can render the number large and the unit small (e.g. "6.29" + "d",
 * "65.9" + "%"). The suffix is empty for unit-less values.
 */
export function formatValueParts(
  value: number | null | undefined,
  unit: Unit = "none",
  decimals?: number,
): { value: string; suffix: string } {
  const formatted = formatValue(value, unit, decimals);
  const match = /^(-?[\d.]+)\s*(.*)$/.exec(formatted);
  if (!match) {
    return { value: formatted, suffix: "" };
  }
  return { value: match[1]!, suffix: match[2]! };
}
