import { useEffect, useMemo, useState } from "react";

import { Box, Button, Flex, Heading } from "@chakra-ui/react";
import { useSearchParams } from "react-router";

import type { Panel, Duration } from "@polarisui/model";
import {
  PanelChrome,
  TimeRangeProvider,
  VariablesProvider,
  useTimeRange,
} from "@polarisui/runtime";

import { AddToDashboardDialog } from "../components/AddToDashboardDialog";
import { LazyPromQLEditor } from "../components/LazyPromQLEditor";
import { usePageTitle } from "../hooks/usePageTitle";
import { TimeRangeControls } from "../components/TimeRangeControls";
import { rangeFromParams, rangeToParams } from "../components/URLStateSync";
import { PlusIcon } from "../components/icons";

function explorePanel(query: string): Panel {
  return {
    kind: "Panel",
    spec: {
      display: { name: query },
      plugin: { kind: "TimeSeriesChart" },
      queries: [
        {
          kind: "TimeSeriesQuery",
          spec: {
            plugin: {
              kind: "PrometheusTimeSeriesQuery",
              spec: { query },
            },
          },
        },
      ],
    },
  };
}

/**
 * Mirrors the executed expression and time range into the URL (replace,
 * not push): an Explore session survives F5 and is a shareable link,
 * like dashboards. Mount inside <TimeRangeProvider>.
 */
function ExploreURLSync({ query }: { query: string | null }) {
  const { range } = useTimeRange();
  const [, setSearchParams] = useSearchParams();
  useEffect(() => {
    setSearchParams(
      (params) => {
        rangeToParams(params, range);
        if (query) {
          params.set("expr", query);
        } else {
          params.delete("expr");
        }
        return params;
      },
      { replace: true },
    );
  }, [range, query, setSearchParams]);
  return null;
}

/**
 * Free PromQL + graph, to iterate on a query before putting it in a
 * panel. Reuses the panel chrome so loading/error handling and the
 * orchestrator path are exactly what a dashboard uses.
 */
export function ExplorePage() {
  usePageTitle("Explore");
  const [searchParams] = useSearchParams();
  // Read once at mount: a shared /explore?expr=…&from=… link restores
  // (and runs) the session.
  const [initial] = useState(() => ({
    expr: (searchParams.get("expr") ?? "").trim(),
    range: rangeFromParams(searchParams),
  }));
  const [draft, setDraft] = useState(initial.expr);
  const [query, setQuery] = useState<string | null>(initial.expr || null);
  const [refreshInterval, setRefreshInterval] = useState<Duration | "off">(
    "off",
  );
  const [adding, setAdding] = useState(false);
  const panel = useMemo(() => (query ? explorePanel(query) : null), [query]);
  const run = () => setQuery(draft.trim() || null);

  return (
    <TimeRangeProvider
      initialRange={initial.range ?? undefined}
      refreshInterval={refreshInterval === "off" ? undefined : refreshInterval}
    >
      <VariablesProvider variables={[]}>
        <ExploreURLSync query={query} />
        <Flex direction="column" gap={4} height="100%">
          <Flex justifyContent="space-between" alignItems="center">
            <Heading size="lg">Explore</Heading>
            <TimeRangeControls
              refreshInterval={refreshInterval}
              onRefreshIntervalChange={setRefreshInterval}
            />
          </Flex>

          <Flex gap={2} alignItems="flex-start">
            <Box flex={1} fontSize="sm">
              <LazyPromQLEditor
                value={draft}
                onChange={setDraft}
                onExecute={run}
                completeURL=""
                placeholder="PromQL expression — Ctrl/Cmd-Enter to run"
              />
            </Box>
            <Button size="sm" onClick={run}>
              Run
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!query}
              onClick={() => setAdding(true)}
            >
              <PlusIcon /> Add to dashboard
            </Button>
          </Flex>

          {adding && query ? (
            <AddToDashboardDialog
              query={query}
              onClose={() => setAdding(false)}
            />
          ) : null}
          {panel ? (
            <Box height="400px" borderWidth="1px" borderRadius="md" padding={2}>
              <PanelChrome panelKey="explore" panel={panel} />
            </Box>
          ) : null}
        </Flex>
      </VariablesProvider>
    </TimeRangeProvider>
  );
}
