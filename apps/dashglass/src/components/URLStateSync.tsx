import { useEffect } from "react";

import { useSearchParams } from "react-router";

import {
  isRelativeTimeRange,
  useTimeRange,
  useVariables,
  type TimeRange,
  type VariableValues,
} from "@dashglass/runtime";

/**
 * Grafana-style shareable URLs: `?from=now-1h` or `?from=<ms>&to=<ms>`,
 * plus `var-<name>=<value>` (repeated for multi-values).
 */

export function rangeFromParams(params: URLSearchParams): TimeRange | null {
  const from = params.get("from");
  if (!from) {
    return null;
  }
  const relative = from.match(/^now-((\d+(ms|s|m|h|d|w|y))+)$/);
  if (relative) {
    return { pastDuration: relative[1]! };
  }
  const start = Number(from);
  const end = Number(params.get("to"));
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return { start: new Date(start), end: new Date(end) };
  }
  return null;
}

/** Writes a time range as `from`/`to` params (relative or absolute). */
export function rangeToParams(params: URLSearchParams, range: TimeRange): void {
  if (isRelativeTimeRange(range)) {
    params.set("from", `now-${range.pastDuration}`);
    params.delete("to");
  } else {
    params.set("from", String(range.start.getTime()));
    params.set("to", String(range.end.getTime()));
  }
}

/**
 * Link to an Explore session on one expression, carrying the time range
 * the panel was showing — the same params ExplorePage reads at mount.
 */
export function exploreHref(expr: string, range: TimeRange): string {
  const params = new URLSearchParams();
  params.set("expr", expr);
  rangeToParams(params, range);
  return `/explore?${params.toString()}`;
}

export function variablesFromParams(params: URLSearchParams): VariableValues {
  const values: VariableValues = {};
  for (const key of new Set(params.keys())) {
    if (!key.startsWith("var-")) {
      continue;
    }
    const all = params.getAll(key);
    values[key.slice(4)] = all.length > 1 ? all : (all[0] ?? "");
  }
  return values;
}

/**
 * Mirrors the current time range and variable values into the URL query
 * string (replace, not push), so any dashboard state is a shareable link.
 * Mount inside <TimeRangeProvider> and <VariablesProvider>.
 */
export function URLStateSync() {
  const { range } = useTimeRange();
  const { values } = useVariables();
  const [, setSearchParams] = useSearchParams();

  useEffect(() => {
    setSearchParams(
      (params) => {
        rangeToParams(params, range);
        for (const key of [...new Set(params.keys())]) {
          if (key.startsWith("var-")) {
            params.delete(key);
          }
        }
        for (const [name, value] of Object.entries(values)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              params.append(`var-${name}`, item);
            }
          } else {
            params.set(`var-${name}`, value);
          }
        }
        return params;
      },
      { replace: true },
    );
  }, [range, values, setSearchParams]);

  return null;
}
