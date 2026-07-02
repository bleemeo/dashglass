/** Value units supported by the built-in panels. */
export type Unit =
  | "none"
  | "short"
  | "percent"
  | "percentunit"
  | "bytes"
  | "bytesps"
  | "seconds"
  | "milliseconds";

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
      return `${toFixed(value, decimals)}%`;
    case "percentunit":
      return `${toFixed(value * 100, decimals)}%`;
    case "bytes":
      return scaled(value, 1024, BYTE_SUFFIXES, decimals);
    case "bytesps":
      return `${scaled(value, 1024, BYTE_SUFFIXES, decimals)}/s`;
    case "seconds":
      return formatSeconds(value, decimals);
    case "milliseconds":
      return formatSeconds(value / 1000, decimals);
    case "none":
      return toFixed(value, decimals);
  }
}
