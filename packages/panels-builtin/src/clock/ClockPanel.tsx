import { useEffect, useMemo, useState } from "react";

import type { PanelProps } from "@dashglass/runtime";

import { parseSpec } from "../spec";
import { clockSpecSchema, formatClock } from "./options";

/** Live current-time panel; ticks every second. No queries. */
export function ClockPanel({ spec }: PanelProps) {
  const parsed = useMemo(() => parseSpec(clockSpecSchema, spec), [spec]);
  const [now, setNow] = useState(() => new Date());

  const showsSeconds = parsed.format === undefined || parsed.format === "datetime";
  useEffect(() => {
    // A minute cadence is enough when seconds aren't shown.
    const period = showsSeconds ? 1000 : 30_000;
    const id = setInterval(() => setNow(new Date()), period);
    return () => clearInterval(id);
  }, [showsSeconds]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        containerType: "size",
        textAlign: "center",
      }}
    >
      <div
        style={{
          // Fixed size when set, otherwise fit the panel.
          fontSize: parsed.fontSize
            ? `${parsed.fontSize}px`
            : "clamp(18px, 14cqmin, 56px)",
          fontWeight: 600,
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatClock(now, parsed.format, parsed.utc ?? false)}
      </div>
      {parsed.utc ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>UTC</div>
      ) : null}
    </div>
  );
}
