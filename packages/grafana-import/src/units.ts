/** Grafana unit id → Polaris unit. Unmapped ids yield undefined + warning. */
const UNIT_MAP: Record<string, string> = {
  none: "none",
  short: "short",
  percent: "percent",
  percentunit: "percentunit",
  bytes: "bytes",
  decbytes: "bytes",
  binBps: "bytesps",
  Bps: "bytesps",
  s: "seconds",
  ms: "milliseconds",
};

export function mapUnit(
  grafanaUnit: string | undefined,
  warn: (message: string) => void,
  context: string,
): string | undefined {
  if (grafanaUnit === undefined || grafanaUnit === "") {
    return undefined;
  }
  const mapped = UNIT_MAP[grafanaUnit];
  if (mapped === undefined) {
    warn(`${context}: unit "${grafanaUnit}" has no equivalent, dropped`);
    return undefined;
  }
  return mapped === "none" ? undefined : mapped;
}
