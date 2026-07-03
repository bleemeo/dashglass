import { useMemo, useState } from "react";

import { Box, Button, Flex, Heading } from "@chakra-ui/react";

import type { Panel, Duration } from "@polarisui/model";
import {
  PanelChrome,
  TimeRangeProvider,
  VariablesProvider,
} from "@polarisui/runtime";

import { AddToDashboardDialog } from "../components/AddToDashboardDialog";
import { LazyPromQLEditor } from "../components/LazyPromQLEditor";
import { usePageTitle } from "../hooks/usePageTitle";
import { TimeRangeControls } from "../components/TimeRangeControls";
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
 * Free PromQL + graph, to iterate on a query before putting it in a
 * panel. Reuses the panel chrome so loading/error handling and the
 * orchestrator path are exactly what a dashboard uses.
 */
export function ExplorePage() {
  usePageTitle("Explore");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<Duration | "off">(
    "off",
  );
  const [adding, setAdding] = useState(false);
  const panel = useMemo(() => (query ? explorePanel(query) : null), [query]);
  const run = () => setQuery(draft.trim() || null);

  return (
    <TimeRangeProvider
      refreshInterval={refreshInterval === "off" ? undefined : refreshInterval}
    >
      <VariablesProvider variables={[]}>
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
