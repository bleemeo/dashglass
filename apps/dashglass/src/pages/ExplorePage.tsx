import { useEffect, useMemo, useState } from "react";

import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { useSearchParams } from "react-router";

import type { Panel, Duration } from "@dashglass/model";
import {
  PanelChrome,
  TimeRangeProvider,
  VariablesProvider,
  useTimeRange,
} from "@dashglass/runtime";

import { usePermissions } from "../api/hooks";
import { AddToDashboardDialog } from "../components/AddToDashboardDialog";
import { LazyPromQLEditor } from "../components/LazyPromQLEditor";
import { TopBar } from "../components/TopBar";
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

// Starter queries shown on the empty Explore page.
const EXAMPLE_QUERIES = [
  "up",
  "rate(node_cpu_seconds_total[5m])",
  "node_memory_MemAvailable_bytes",
  "sum by (job) (up)",
  "topk(5, node_load1)",
];

const RECENT_KEY = "dashglass-explore-recent";
const RECENT_MAX = 8;

function loadRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // Not persisting recent queries is fine.
  }
}

/** A clickable PromQL query chip (examples / recent). */
function QueryChip({ query, onRun }: { query: string; onRun: (q: string) => void }) {
  return (
    <Button
      size="xs"
      variant="outline"
      fontFamily="mono"
      fontWeight="normal"
      maxWidth="100%"
      title={query}
      onClick={() => onRun(query)}
    >
      <Box as="span" truncate>
        {query}
      </Box>
    </Button>
  );
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
  const [recent, setRecent] = useState<string[]>(loadRecent);
  // Viewers (and provisioned readonly) can explore but not write.
  const { canEdit } = usePermissions();
  const panel = useMemo(() => (query ? explorePanel(query) : null), [query]);

  const runQuery = (expr: string) => {
    const trimmed = expr.trim();
    if (trimmed === "") {
      setQuery(null);
      return;
    }
    setDraft(trimmed);
    setQuery(trimmed);
    setRecent((current) => {
      const next = [trimmed, ...current.filter((q) => q !== trimmed)].slice(
        0,
        RECENT_MAX,
      );
      saveRecent(next);
      return next;
    });
  };
  const run = () => runQuery(draft);

  return (
    <TimeRangeProvider
      initialRange={initial.range ?? undefined}
      refreshInterval={refreshInterval === "off" ? undefined : refreshInterval}
    >
      <VariablesProvider variables={[]}>
        <ExploreURLSync query={query} />
        <Flex direction="column" gap={4} height="100%">
          <TopBar
            crumbs={[{ label: "Explore" }]}
            actions={
              <TimeRangeControls
                refreshInterval={refreshInterval}
                onRefreshIntervalChange={setRefreshInterval}
              />
            }
          />

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
            <Button size="sm" colorPalette="brand" onClick={run}>
              Run
            </Button>
            {canEdit ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!query}
                onClick={() => setAdding(true)}
              >
                <PlusIcon /> Add to dashboard
              </Button>
            ) : null}
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
          ) : (
            <Flex direction="column" gap={5} paddingTop={2} maxWidth="720px">
              <Box>
                <Text fontSize="sm" fontWeight="medium" marginBottom={2}>
                  Examples
                </Text>
                <Flex wrap="wrap" gap={2}>
                  {EXAMPLE_QUERIES.map((q) => (
                    <QueryChip key={q} query={q} onRun={runQuery} />
                  ))}
                </Flex>
              </Box>
              {recent.length > 0 ? (
                <Box>
                  <Flex
                    alignItems="center"
                    justifyContent="space-between"
                    marginBottom={2}
                  >
                    <Text fontSize="sm" fontWeight="medium">
                      Recent
                    </Text>
                    <Button
                      size="2xs"
                      variant="ghost"
                      color="fg.muted"
                      onClick={() => {
                        setRecent([]);
                        saveRecent([]);
                      }}
                    >
                      Clear
                    </Button>
                  </Flex>
                  <Flex wrap="wrap" gap={2}>
                    {recent.map((q) => (
                      <QueryChip key={q} query={q} onRun={runQuery} />
                    ))}
                  </Flex>
                </Box>
              ) : null}
            </Flex>
          )}
        </Flex>
      </VariablesProvider>
    </TimeRangeProvider>
  );
}
