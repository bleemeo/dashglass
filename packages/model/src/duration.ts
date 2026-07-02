import { durationSchema, type Duration } from "./schema/common";

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  y: 31_536_000_000,
};

/** Parses a Prometheus-style duration ("30s", "1h30m") to milliseconds. */
export function parseDuration(duration: Duration): number {
  durationSchema.parse(duration);
  let total = 0;
  for (const [, amount, unit] of duration.matchAll(/(\d+)(ms|s|m|h|d|w|y)/g)) {
    total += Number(amount) * UNIT_MS[unit!]!;
  }
  return total;
}
