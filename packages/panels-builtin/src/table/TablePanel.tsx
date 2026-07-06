import { useMemo, useState } from "react";
import { z } from "zod";

import type { PanelProps, TimeSeries } from "@polarisui/runtime";

import { NoData } from "../NoData";
import { parseSpec } from "../spec";
import { useChartTheme } from "../theme";
import { formatValue, unitSchema } from "../units";
import { calculate } from "../stat/calculations";

export const tableSpecSchema = z.object({
  unit: unitSchema.optional(),
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

export interface TableRow {
  labels: Record<string, string>;
  value: number | null;
}

/**
 * Rows sorted by a label column, or by the value column when `column` is
 * null (a name can't collide with a label that way). Null values sort as
 * smallest. Exported for tests.
 */
export function sortTableRows<Row extends TableRow>(
  rows: Row[],
  column: string | null,
  direction: 1 | -1,
): Row[] {
  return [...rows].sort((a, b) => {
    if (column === null) {
      const left = a.value ?? Number.NEGATIVE_INFINITY;
      const right = b.value ?? Number.NEGATIVE_INFINITY;
      return (left - right) * direction;
    }
    return (
      (a.labels[column] ?? "").localeCompare(b.labels[column] ?? "") * direction
    );
  });
}

interface Sort {
  /** null sorts the value column. */
  column: string | null;
  direction: 1 | -1;
}

function SortableHeader({
  label,
  column,
  sort,
  onSort,
  align,
  style,
}: {
  label: string;
  column: string | null;
  sort: Sort | null;
  onSort: (column: string | null) => void;
  align: "left" | "right";
  style: React.CSSProperties;
}) {
  const active = sort !== null && sort.column === column;
  return (
    <th
      style={{ ...style, textAlign: align }}
      aria-sort={
        active ? (sort.direction === 1 ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        style={{
          font: "inherit",
          color: "inherit",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        {label}
        {active ? (sort.direction === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
}

/** Last value of each series, one row per series; click a header to sort. */
export function TablePanel({ spec, data }: PanelProps) {
  const theme = useChartTheme();
  const parsed = useMemo(() => parseSpec(tableSpecSchema, spec), [spec]);
  const columns = useMemo(() => tableColumns(data.series), [data.series]);
  const [sort, setSort] = useState<Sort | null>(null);

  const rows = useMemo(() => {
    const unsorted = data.series.map((series) => ({
      labels: series.labels,
      value: calculate(series.points, "last"),
      key: series.name,
    }));
    return sort
      ? sortTableRows(unsorted, sort.column, sort.direction)
      : unsorted;
  }, [data.series, sort]);

  if (data.state === "ready" && data.series.length === 0) {
    return <NoData />;
  }

  const toggleSort = (column: string | null) =>
    setSort((current) =>
      current && current.column === column
        ? { column, direction: current.direction === 1 ? -1 : 1 }
        : { column, direction: 1 },
    );

  const cellStyle = {
    padding: "4px 8px",
    borderBottom: `1px solid ${theme.gridline}`,
    textAlign: "left" as const,
  };
  // Sticky needs its own background (rows scroll beneath) and a separate
  // border model — collapsed borders don't stick with the header.
  const headerStyle: React.CSSProperties = {
    ...cellStyle,
    color: theme.ink.secondary,
    position: "sticky",
    top: 0,
    backgroundColor: theme.surface,
  };

  return (
    <div style={{ overflow: "auto", height: "100%" }}>
      <table
        className="polaris-table"
        style={{
          width: "100%",
          borderCollapse: "separate",
          borderSpacing: 0,
          fontSize: 12,
          color: theme.ink.primary,
        }}
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <SortableHeader
                key={column}
                label={column}
                column={column}
                sort={sort}
                onSort={toggleSort}
                align="left"
                style={headerStyle}
              />
            ))}
            <SortableHeader
              label="value"
              column={null}
              sort={sort}
              onSort={toggleSort}
              align="right"
              style={headerStyle}
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.key}-${index}`}>
              {columns.map((column) => (
                <td key={column} style={cellStyle}>
                  {row.labels[column] ?? ""}
                </td>
              ))}
              <td
                style={{
                  ...cellStyle,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatValue(row.value, parsed.unit ?? "none")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
