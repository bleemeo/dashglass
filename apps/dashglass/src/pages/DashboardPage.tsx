import { useMemo, useState } from "react";

import { Box, Button, CloseButton, Flex, IconButton, Text } from "@chakra-ui/react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { parseDashboard, type Dashboard, type Duration } from "@dashglass/model";
import { ChartGroupProvider } from "@dashglass/panels-builtin";
import {
  DashboardGrid,
  PanelChrome,
  TimeRangeProvider,
  VariablesProvider,
  defaultTimeRange,
} from "@dashglass/runtime";

import { isNotFound } from "../api/client";
import {
  useCapabilities,
  useDashboardFile,
  usePermissions,
} from "../api/hooks";
import { DashboardNotFound } from "../components/DashboardNotFound";
import { HistoryDrawer } from "../components/HistoryDrawer";
import { PanelActionsMenu } from "../components/PanelActionsMenu";
import { usePageTitle } from "../hooks/usePageTitle";
import { useKeyShortcut } from "../hooks/useShortcuts";
import { TimeRangeControls } from "../components/TimeRangeControls";
import { TopBar } from "../components/TopBar";
import {
  URLStateSync,
  rangeFromParams,
  variablesFromParams,
} from "../components/URLStateSync";
import { VariablesToolbar } from "../components/VariablesToolbar";
import {
  CodeIcon,
  EditIcon,
  HistoryIcon,
  KioskIcon,
} from "../components/icons";

function DashboardView({ dashboard, name }: { dashboard: Dashboard; name: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshInterval, setRefreshInterval] = useState<Duration | "off">(
    dashboard.spec.refreshInterval ?? "off",
  );
  usePageTitle(dashboard.spec.display?.name ?? name);
  const { canEdit } = usePermissions();
  const capabilities = useCapabilities();
  const hasHistory = capabilities.data?.features?.history === true;
  const [historyOpen, setHistoryOpen] = useState(false);
  useKeyShortcut("e", () => {
    if (canEdit) {
      void navigate(`/d/${encodeURIComponent(name)}/edit`);
    }
  });

  // Read once at mount: afterwards URLStateSync mirrors state → URL.
  const [urlState] = useState(() => ({
    range: rangeFromParams(searchParams),
    variables: variablesFromParams(searchParams),
  }));

  const kiosk = searchParams.has("kiosk");
  const viewedKey = searchParams.get("viewPanel");
  const viewedPanel = viewedKey ? dashboard.spec.panels[viewedKey] : undefined;
  const setViewedPanel = (panelKey: string | null) => {
    setSearchParams(
      (params) => {
        if (panelKey === null) {
          params.delete("viewPanel");
        } else {
          params.set("viewPanel", panelKey);
        }
        return params;
      },
      { replace: true },
    );
  };
  // Esc leaves fullscreen first, then kiosk.
  useKeyShortcut("Escape", () => {
    if (viewedKey) {
      setViewedPanel(null);
    } else if (kiosk) {
      setSearchParams(
        (params) => {
          params.delete("kiosk");
          return params;
        },
        { replace: true },
      );
    }
  });

  return (
    <TimeRangeProvider
      initialRange={urlState.range ?? defaultTimeRange(dashboard)}
      refreshInterval={refreshInterval === "off" ? undefined : refreshInterval}
    >
      <VariablesProvider
        variables={dashboard.spec.variables}
        initialValues={urlState.variables}
      >
        <URLStateSync />
        <ChartGroupProvider value={`dashboard-${name}`}>
          <Flex direction="column" gap={4} height="100%">
            {kiosk ? null : (
              <TopBar
                crumbs={[
                  { label: "Dashboards", to: "/" },
                  {
                    label: dashboard.spec.display?.name ?? dashboard.metadata.name,
                    ...(viewedPanel
                      ? { onClick: () => setViewedPanel(null) }
                      : {}),
                  },
                  ...(viewedPanel
                    ? [{ label: viewedPanel.spec.display?.name ?? viewedKey! }]
                    : []),
                ]}
                actions={
                  <>
                    <TimeRangeControls
                      refreshInterval={refreshInterval}
                      onRefreshIntervalChange={setRefreshInterval}
                    />
                    {viewedPanel || !hasHistory ? null : (
                      <IconButton
                        size="sm"
                        variant="ghost"
                        color="fg.muted"
                        aria-label="History"
                        title="History — versions of this dashboard in git"
                        onClick={() => setHistoryOpen(true)}
                      >
                        <HistoryIcon />
                      </IconButton>
                    )}
                    {viewedPanel ? null : (
                      <IconButton
                        size="sm"
                        variant="ghost"
                        color="fg.muted"
                        aria-label="Kiosk mode"
                        title="Kiosk mode — chrome-less view for wall screens (Esc to exit)"
                        onClick={() =>
                          setSearchParams((params) => {
                            params.set("kiosk", "1");
                            return params;
                          })
                        }
                      >
                        <KioskIcon />
                      </IconButton>
                    )}
                    {viewedPanel ? (
                      <Button
                        size="sm"
                        variant="outline"
                        title="Esc"
                        onClick={() => setViewedPanel(null)}
                      >
                        Back to dashboard
                      </Button>
                    ) : canEdit ? (
                      <>
                        <Button size="sm" variant="outline" asChild>
                          <Link to={`/d/${encodeURIComponent(name)}/edit`}>
                            <EditIcon /> Edit
                          </Link>
                        </Button>
                        <Button size="sm" variant="ghost" asChild>
                          <Link to={`/d/${encodeURIComponent(name)}/code`}>
                            <CodeIcon /> Code
                          </Link>
                        </Button>
                      </>
                    ) : null}
                  </>
                }
              />
            )}
            {kiosk ? null : (
              <VariablesToolbar variables={dashboard.spec.variables ?? []} />
            )}
            {hasHistory ? (
              <HistoryDrawer
                name={name}
                open={historyOpen}
                onClose={() => setHistoryOpen(false)}
              />
            ) : null}
            {viewedKey && viewedPanel ? (
              <Box flex={1} minHeight={0}>
                {/* Close sits in the header action row rather than floating
                    over it: absolute positioning covered the ⋯ trigger. */}
                <PanelChrome
                  panelKey={viewedKey}
                  panel={viewedPanel}
                  actions={
                    <>
                      <PanelActionsMenu
                        panelKey={viewedKey}
                        panel={viewedPanel}
                      />
                      <CloseButton
                        size="2xs"
                        variant="ghost"
                        color="fg.muted"
                        aria-label="Close fullscreen"
                        title="Close fullscreen (Esc)"
                        onClick={() => setViewedPanel(null)}
                      />
                    </>
                  }
                />
              </Box>
            ) : (
              <DashboardGrid
                dashboard={dashboard}
                onPanelExpand={setViewedPanel}
                renderPanelActions={({ panelKey, panel }) => (
                  <PanelActionsMenu
                    panelKey={panelKey}
                    panel={panel}
                    onExpand={() => setViewedPanel(panelKey)}
                  />
                )}
              />
            )}
          </Flex>
        </ChartGroupProvider>
      </VariablesProvider>
    </TimeRangeProvider>
  );
}

export function DashboardPage() {
  const { name = "" } = useParams();
  const file = useDashboardFile(name);

  const parsed = useMemo(() => {
    if (!file.data) {
      return null;
    }
    try {
      return { dashboard: parseDashboard(file.data.content, file.data.format) };
    } catch (error) {
      return { error: String(error) };
    }
  }, [file.data]);

  if (file.isLoading) {
    return <Text>Loading…</Text>;
  }
  if (isNotFound(file.error)) {
    return <DashboardNotFound name={name} />;
  }
  if (file.error) {
    return <Text color="fg.error">{String(file.error)}</Text>;
  }
  if (parsed && "error" in parsed) {
    return (
      <Flex direction="column" gap={2}>
        <Text color="fg.error">This dashboard file is invalid:</Text>
        <Text as="pre" fontSize="xs" whiteSpace="pre-wrap">
          {parsed.error}
        </Text>
        <Button size="sm" alignSelf="flex-start" asChild>
          <Link to={`/d/${encodeURIComponent(name)}/code`}>Edit the file</Link>
        </Button>
      </Flex>
    );
  }
  if (!parsed) {
    return null;
  }
  // Key by name: a navigation to another dashboard resets range/variables.
  return <DashboardView key={name} dashboard={parsed.dashboard} name={name} />;
}
