import { useMemo, useState } from "react";

import { Button, Flex, Heading, Text } from "@chakra-ui/react";
import { Link, useParams } from "react-router";

import { parseDashboard, type Dashboard, type Duration } from "@polarisui/model";
import {
  DashboardGrid,
  TimeRangeProvider,
  VariablesProvider,
  defaultTimeRange,
} from "@polarisui/runtime";

import { useDashboardFile } from "../api/hooks";
import { TimeRangeControls } from "../components/TimeRangeControls";
import { VariablesToolbar } from "../components/VariablesToolbar";

function DashboardView({ dashboard, name }: { dashboard: Dashboard; name: string }) {
  const [refreshInterval, setRefreshInterval] = useState<Duration | "off">(
    dashboard.spec.refreshInterval ?? "off",
  );

  return (
    <TimeRangeProvider
      initialRange={defaultTimeRange(dashboard)}
      refreshInterval={refreshInterval === "off" ? undefined : refreshInterval}
    >
      <VariablesProvider variables={dashboard.spec.variables}>
        <Flex direction="column" gap={4} height="100%">
          <Flex justifyContent="space-between" alignItems="center" wrap="wrap" gap={2}>
            <Heading size="lg">
              {dashboard.spec.display?.name ?? dashboard.metadata.name}
            </Heading>
            <Flex gap={2} alignItems="center">
              <TimeRangeControls
                refreshInterval={refreshInterval}
                onRefreshIntervalChange={setRefreshInterval}
              />
              <Button size="xs" variant="outline" asChild>
                <Link to={`/d/${encodeURIComponent(name)}/edit`}>Edit</Link>
              </Button>
              <Button size="xs" variant="ghost" asChild>
                <Link to={`/d/${encodeURIComponent(name)}/code`}>Code</Link>
              </Button>
            </Flex>
          </Flex>
          <VariablesToolbar variables={dashboard.spec.variables ?? []} />
          <DashboardGrid dashboard={dashboard} />
        </Flex>
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
