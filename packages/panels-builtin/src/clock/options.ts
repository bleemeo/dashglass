import { z } from "zod";

export const CLOCK_FORMATS = [
  "time", // HH:mm
  "datetime", // date + HH:mm:ss
  "date", // short date
  "date-long", // long date
  "iso", // ISO 8601 (UTC)
] as const;

export const clockSpecSchema = z.object({
  /** Unset = time with seconds (HH:mm:ss). */
  format: z.enum(CLOCK_FORMATS).optional(),
  /** Render in UTC instead of the viewer's local zone. */
  utc: z.boolean().optional(),
  /** Fixed font size in px; unset = auto-fit to the panel. */
  fontSize: z.number().int().positive().optional(),
});

export type ClockSpec = z.infer<typeof clockSpecSchema>;
export type ClockFormat = (typeof CLOCK_FORMATS)[number];

/**
 * Formats a moment for the clock panel. 24-hour times (hour12:false) so
 * "HH:mm:ss" reads unambiguously; dates use locale styles. Exported for
 * tests. `iso` is always UTC.
 */
export function formatClock(
  date: Date,
  format: ClockFormat | undefined,
  utc: boolean,
): string {
  const zone = utc ? "UTC" : undefined;
  const time24 = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: zone,
  } as const;

  switch (format) {
    case "time":
      return new Intl.DateTimeFormat(undefined, time24).format(date);
    case "datetime":
      return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        ...time24,
        second: "2-digit",
      }).format(date);
    case "date":
      return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: zone,
      }).format(date);
    case "date-long":
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "long",
        timeZone: zone,
      }).format(date);
    case "iso":
      return date.toISOString();
    default:
      // HH:mm:ss
      return new Intl.DateTimeFormat(undefined, {
        ...time24,
        second: "2-digit",
      }).format(date);
  }
}
