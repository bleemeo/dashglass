import { useMemo } from "react";
import { z } from "zod";

import type { PanelProps, TimeSeries } from "@polarisui/runtime";

import { NoData } from "../NoData";
import { parseSpec } from "../spec";
import { useChartTheme } from "../theme";
import { formatValue } from "../units";
import { calculate } from "../stat/calculations";

export const tableSpecSchema = z.object({
  unit: z
    .enum([
      "none",
      "short",
      "percent",
      "percentunit",
      "bytes",
      "bytesps",
      "seconds",
      "milliseconds",
    ])
    .optional(),
});

export type TableSpec = z.infer<typeof tableSpecSchema>;

/** Label columns: the union of label names across series, minus __name__. */
export function tableColumns(series: TimeSeries[]): string[] {
  const columns = new Set<string>();
  for (const oneSeries of series) {
    for (const label of Object.keys(oneSeries.labels)) {
      if (label !== "__name__") {
        columns.add(label);
      }
    }
  }
  return [...columns].sort();
}

/** Last value of each series, one row per series. */
export function TablePanel({ spec, data }: PanelProps) {
  const theme = useChartTheme();
  const parsed = useMemo(() => parseSpec(tableSpecSchema, spec), [spec]);
  const columns = useMemo(() => tableColumns(data.series), [data.series]);

  if (data.state === "ready" && data.series.length === 0) {
    return <NoData />;
  }

  const cellStyle = {
    padding: "4px 8px",
    borderBottom: `1px solid ${theme.gridline}`,
    textAlign: "left" as const,
  };

  return (
    <div style={{ overflow: "auto", height: "100%" }}>
      <table
        className="polaris-table"
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
          color: theme.ink.primary,
        }}
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                style={{ ...cellStyle, color: theme.ink.secondary }}
              >
                {column}
              </th>
            ))}
            <th
              style={{
                ...cellStyle,
                color: theme.ink.secondary,
                textAlign: "right",
              }}
            >
              value
            </th>
          </tr>
        </thead>
        <tbody>
          {data.series.map((series, index) => (
            <tr key={`${series.name}-${index}`}>
              {columns.map((column) => (
                <td key={column} style={cellStyle}>
                  {series.labels[column] ?? ""}
                </td>
              ))}
              <td
                style={{
                  ...cellStyle,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatValue(
                  calculate(series.points, "last"),
                  parsed.unit ?? "none",
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
