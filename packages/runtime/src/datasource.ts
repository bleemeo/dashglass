import { parseDuration, type Duration } from "@dashglass/model";

/**
 * The cornerstone of backend interchangeability (DESIGN.md §7.1): one
 * interface shaped after the Prometheus HTTP API. The OSS implementation
 * targets the Go backend's native-path proxy; a SaaS implementation adapts
 * its own metrics endpoints to the same shape.
 */
export interface PrometheusDataSource {
  rangeQuery(params: RangeQueryParams): Promise<PromResponse>;
  instantQuery(params: InstantQueryParams): Promise<PromResponse>;
  labelNames(params?: LabelQueryParams): Promise<string[]>;
  labelValues(label: string, params?: LabelQueryParams): Promise<string[]>;
}

export interface RangeQueryParams {
  query: string;
  start: Date;
  end: Date;
  /** Resolution step, in seconds. */
  step: number;
  signal?: AbortSignal;
}

export interface InstantQueryParams {
  query: string;
  time?: Date;
  signal?: AbortSignal;
}

export interface LabelQueryParams {
  match?: string[];
  start?: Date;
  end?: Date;
  signal?: AbortSignal;
}

/** [unix seconds, value as string] — the Prometheus wire format. */
export type PromValue = [number, string];
export type PromMetric = Record<string, string>;

export type PromData =
  | { resultType: "matrix"; result: { metric: PromMetric; values: PromValue[] }[] }
  | { resultType: "vector"; result: { metric: PromMetric; value: PromValue }[] }
  | { resultType: "scalar"; result: PromValue }
  | { resultType: "string"; result: PromValue };

export interface PromResponse {
  status: "success" | "error";
  data?: PromData;
  errorType?: string;
  error?: string;
  warnings?: string[];
}

// --- Time ranges ---------------------------------------------------------

export interface AbsoluteTimeRange {
  start: Date;
  end: Date;
}

/** A sliding window ending now, e.g. { pastDuration: "1h" }. */
export interface RelativeTimeRange {
  pastDuration: Duration;
}

export type TimeRange = AbsoluteTimeRange | RelativeTimeRange;

export function isRelativeTimeRange(range: TimeRange): range is RelativeTimeRange {
  return "pastDuration" in range;
}

export function resolveTimeRange(
  range: TimeRange,
  now: Date = new Date(),
): AbsoluteTimeRange {
  if (isRelativeTimeRange(range)) {
    return {
      start: new Date(now.getTime() - parseDuration(range.pastDuration)),
      end: now,
    };
  }
  return range;
}

// --- Step selection ------------------------------------------------------

/** Candidate steps, in seconds, from 1s to 1d. */
const STEPS = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200,
  86400,
];

/**
 * Picks a query resolution: the smallest "nice" step that keeps the series
 * under maxDataPoints. Aligning on shared steps (instead of computing an
 * exact one) also makes identical panel queries cacheable across panels.
 */
export function stepForRange(
  range: AbsoluteTimeRange,
  maxDataPoints = 250,
  minStep = 15,
): number {
  const seconds = (range.end.getTime() - range.start.getTime()) / 1000;
  const target = Math.max(seconds / maxDataPoints, minStep);
  return STEPS.find((step) => step >= target) ?? STEPS[STEPS.length - 1]!;
}

// --- Series --------------------------------------------------------------

/** A render-ready time series: millisecond timestamps, numeric values. */
export interface TimeSeries {
  name: string;
  labels: PromMetric;
  /** [ms timestamp, value]; null marks gaps (NaN from Prometheus). */
  points: [number, number | null][];
}

/**
 * Formats a series name from labels: "{{label}}" templating (legend
 * templates), defaulting to the PromQL-style `metric{label="value"}`.
 */
export function formatSeriesName(
  format: string | undefined,
  metric: PromMetric,
): string {
  if (format) {
    const formatted = format.replace(
      /\{\{\s*([^}\s]+)\s*\}\}/g,
      (_, label: string) => metric[label] ?? "",
    );
    // A template whose labels are all absent can render empty; fall back
    // to the default name instead of an unlabeled legend entry.
    if (formatted.trim() !== "") {
      return formatted;
    }
  }
  const { __name__: metricName = "", ...labels } = metric;
  const pairs = Object.entries(labels)
    .map(([key, value]) => `${key}="${value}"`)
    .join(", ");
  return pairs ? `${metricName}{${pairs}}` : metricName || "{}";
}

function toPoint(value: PromValue): [number, number | null] {
  const numeric = Number.parseFloat(value[1]);
  return [value[0] * 1000, Number.isNaN(numeric) ? null : numeric];
}

/** Converts a Prometheus response into render-ready series. */
export function toTimeSeries(
  response: PromResponse,
  seriesNameFormat?: string,
): TimeSeries[] {
  const data = response.data;
  if (!data) {
    return [];
  }
  switch (data.resultType) {
    case "matrix":
      return data.result.map((series) => ({
        name: formatSeriesName(seriesNameFormat, series.metric),
        labels: series.metric,
        points: series.values.map(toPoint),
      }));
    case "vector":
      return data.result.map((sample) => ({
        name: formatSeriesName(seriesNameFormat, sample.metric),
        labels: sample.metric,
        points: [toPoint(sample.value)],
      }));
    case "scalar":
      return [{ name: "scalar", labels: {}, points: [toPoint(data.result)] }];
    case "string":
      return [];
  }
}
