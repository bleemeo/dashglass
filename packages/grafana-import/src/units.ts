/** Grafana unit id → Dashglass unit. Unmapped ids yield undefined + warning. */
const UNIT_MAP: Record<string, string> = {
  none: "none",
  short: "short",
  percent: "percent",
  percentunit: "percentunit",
  bytes: "bytes",
  decbytes: "bytes",
  binBps: "bytesps",
  Bps: "bytesps",
  bps: "bitsps",
  s: "seconds",
  ms: "milliseconds",
  hertz: "hertz",
  celsius: "celsius",
  // Grafana has one unit id per counted thing; Dashglass formats them all as
  // a generic per-second rate.
  ops: "ops",
  iops: "ops",
  pps: "ops",
  eps: "ops",
  rps: "ops",
  wps: "ops",
  reqps: "ops",
  cps: "ops",
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
