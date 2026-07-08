import { useState } from "react";

import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Flex,
  IconButton,
  Input,
  NativeSelect,
  Portal,
} from "@chakra-ui/react";

import {
  isRelativeTimeRange,
  resolveTimeRange,
  useTimeRange,
  type TimeRange,
} from "@dashglass/runtime";
import type { Duration } from "@dashglass/model";

import { ClockIcon, RefreshIcon } from "./icons";

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

/** Local-time value for <input type="datetime-local">. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function CustomRangeDialog({
  initial,
  onApply,
  onClose,
}: {
  initial: { start: Date; end: Date };
  onApply: (start: Date, end: Date) => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(() => toLocalInput(initial.start));
  const [to, setTo] = useState(() => toLocalInput(initial.end));
  const start = new Date(from);
  const end = new Date(to);
  const valid =
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    start < end;

  return (
    <Dialog.Root
      open
      size="xs"
      onOpenChange={(event) => {
        if (!event.open) {
          onClose();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Custom time range</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Flex direction="column" gap={3}>
                <Field.Root>
                  <Field.Label>From</Field.Label>
                  <Input
                    size="sm"
                    type="datetime-local"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                </Field.Root>
                <Field.Root invalid={!valid}>
                  <Field.Label>To</Field.Label>
                  <Input
                    size="sm"
                    type="datetime-local"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                  />
                  {valid ? null : (
                    <Field.ErrorText>
                      "To" must be after "From".
                    </Field.ErrorText>
                  )}
                </Field.Root>
              </Flex>
            </Dialog.Body>
            <Dialog.Footer>
              <Button size="sm" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!valid}
                onClick={() => onApply(start, end)}
              >
                Apply
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

export interface TimeRangeControlsProps {
  refreshInterval: Duration | "off";
  onRefreshIntervalChange: (interval: Duration | "off") => void;
  /** Hides the auto-refresh selector (e.g. the editor preview, where a
   * ticking refresh has no purpose). */
  hideRefreshInterval?: boolean;
}

/** Time range picker + auto-refresh selector + manual refresh. */
export function TimeRangeControls({
  refreshInterval,
  onRefreshIntervalChange,
  hideRefreshInterval,
}: TimeRangeControlsProps) {
  const { range, setRange, refresh } = useTimeRange();
  const [picking, setPicking] = useState(false);

  const customLabel = isRelativeTimeRange(range)
    ? "Custom…"
    : `${toLocalInput(range.start).replace("T", " ")} → ${toLocalInput(
        range.end,
      ).replace("T", " ")}`;

  return (
    <Flex gap={2} alignItems="center">
      {picking ? (
        <CustomRangeDialog
          initial={resolveTimeRange(range)}
          onApply={(start, end) => {
            setRange({ start, end });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
      <NativeSelect.Root size="sm" width="auto">
        <NativeSelect.Field
          aria-label="Time range"
          fontWeight="medium"
          value={rangeValue(range)}
          onChange={(event) => {
            if (event.target.value === "custom") {
              setPicking(true);
            } else {
              setRange({ pastDuration: event.target.value });
            }
          }}
        >
          {RANGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {/* A relative range outside the presets (e.g. ?from=now-3h)
              still needs a matching option, or the select silently
              displays the first preset. */}
          {isRelativeTimeRange(range) &&
          !RANGES.some((option) => option.value === range.pastDuration) ? (
            <option value={range.pastDuration}>
              Last {range.pastDuration}
            </option>
          ) : null}
          <option value="custom">{customLabel}</option>
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      {isRelativeTimeRange(range) ? null : (
        <IconButton
          size="sm"
          variant="ghost"
          aria-label="Edit custom range"
          title="Edit custom range"
          onClick={() => setPicking(true)}
        >
          <ClockIcon />
        </IconButton>
      )}
      {hideRefreshInterval ? null : (
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
      )}
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
