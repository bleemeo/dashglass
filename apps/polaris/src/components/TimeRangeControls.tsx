import { Flex, IconButton, NativeSelect } from "@chakra-ui/react";

import {
  isRelativeTimeRange,
  useTimeRange,
  type TimeRange,
} from "@polarisui/runtime";
import type { Duration } from "@polarisui/model";

import { RefreshIcon } from "./icons";

const RANGES: { label: string; value: Duration }[] = [
  { label: "Last 5m", value: "5m" },
  { label: "Last 15m", value: "15m" },
  { label: "Last 1h", value: "1h" },
  { label: "Last 6h", value: "6h" },
  { label: "Last 24h", value: "24h" },
  { label: "Last 7d", value: "7d" },
];

function rangeValue(range: TimeRange): string {
  return isRelativeTimeRange(range) ? range.pastDuration : "custom";
}

export interface TimeRangeControlsProps {
  refreshInterval: Duration | "off";
  onRefreshIntervalChange: (interval: Duration | "off") => void;
}

/** Time range picker + auto-refresh selector + manual refresh. */
export function TimeRangeControls({
  refreshInterval,
  onRefreshIntervalChange,
}: TimeRangeControlsProps) {
  const { range, setRange, refresh } = useTimeRange();

  return (
    <Flex gap={2} alignItems="center">
      <NativeSelect.Root size="sm" width="auto">
        <NativeSelect.Field
          aria-label="Time range"
          fontWeight="medium"
          value={rangeValue(range)}
          onChange={(event) => setRange({ pastDuration: event.target.value })}
        >
          {RANGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {rangeValue(range) === "custom" ? (
            <option value="custom">Custom</option>
          ) : null}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      <NativeSelect.Root size="sm" width="auto">
        <NativeSelect.Field
          aria-label="Auto-refresh"
          color="fg.muted"
          value={refreshInterval}
          onChange={(event) =>
            onRefreshIntervalChange(event.target.value as Duration | "off")
          }
        >
          <option value="off">No refresh</option>
          <option value="10s">10s</option>
          <option value="30s">30s</option>
          <option value="1m">1m</option>
          <option value="5m">5m</option>
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      <IconButton
        size="sm"
        variant="outline"
        aria-label="Refresh now"
        title="Refresh now"
        onClick={refresh}
      >
        <RefreshIcon />
      </IconButton>
    </Flex>
  );
}
