import {
  Badge,
  Button,
  Flex,
  Heading,
  Link as ChakraLink,
  Table,
  Text,
} from "@chakra-ui/react";
import { Link, useNavigate } from "react-router";

import {
  useCapabilities,
  useDashboards,
  useDeleteDashboard,
  useSaveDashboard,
} from "../api/hooks";

const STARTER = (name: string) => `apiVersion: v1
kind: Dashboard
metadata:
  name: ${name}
spec:
  display:
    name: ${name}
  panels:
    example:
      kind: Panel
      spec:
        display:
          name: Example
        plugin:
          kind: TimeSeriesChart
        queries:
          - kind: TimeSeriesQuery
            spec:
              plugin:
                kind: PrometheusTimeSeriesQuery
                spec:
                  query: up
  layouts:
    - kind: Grid
      spec:
        items:
          - x: 0
            y: 0
            width: 12
            height: 8
            content:
              $ref: "#/spec/panels/example"
  duration: 1h
`;

function NewDashboardButton() {
  const navigate = useNavigate();
  // The mutation name is picked at click time, so the hook targets a
  // placeholder and the click handler calls the API directly through it.
  const save = useSaveDashboard("");

  const create = () => {
    const name = window
      .prompt("Dashboard name (letters, digits, '-', '_'):")
      ?.trim();
    if (!name) {
      return;
    }
    fetch(`/api/dashboards/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/yaml" },
      body: STARTER(name),
    }).then((response) => {
      if (response.ok) {
        save.reset();
        navigate(`/d/${encodeURIComponent(name)}`);
      } else {
        void response
          .json()
          .then((body: { error?: string; issues?: string[] }) =>
            window.alert(
              [body.error, ...(body.issues ?? [])].filter(Boolean).join("\n"),
            ),
          );
      }
    });
  };

  return (
    <Button size="sm" onClick={create}>
      New dashboard
    </Button>
  );
}

export function DashboardsPage() {
  const dashboards = useDashboards();
  const capabilities = useCapabilities();
  const remove = useDeleteDashboard();
  const readonly = capabilities.data?.readonly ?? false;

  return (
    <Flex direction="column" gap={4}>
      <Flex justifyContent="space-between" alignItems="center">
        <Heading size="lg">Dashboards</Heading>
        {readonly ? null : <NewDashboardButton />}
      </Flex>

      {dashboards.isLoading ? <Text>Loading…</Text> : null}
      {dashboards.error ? (
        <Text color="fg.error">{String(dashboards.error)}</Text>
      ) : null}
      {dashboards.data?.length === 0 ? (
        <Text color="fg.muted">
          No dashboards yet. Create one, or drop a file in the dashboards
          directory.
        </Text>
      ) : null}

      {dashboards.data?.length ? (
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Description</Table.ColumnHeader>
              <Table.ColumnHeader>Format</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="right"></Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {dashboards.data.map((dashboard) => (
              <Table.Row key={dashboard.name}>
                <Table.Cell>
                  <ChakraLink asChild fontWeight="medium">
                    <Link to={`/d/${encodeURIComponent(dashboard.name)}`}>
                      {dashboard.displayName || dashboard.name}
                    </Link>
                  </ChakraLink>
                  {dashboard.invalid ? (
                    <Badge colorPalette="red" marginLeft={2}>
                      invalid
                    </Badge>
                  ) : null}
                </Table.Cell>
                <Table.Cell color="fg.muted">
                  {dashboard.description ?? ""}
                </Table.Cell>
                <Table.Cell>
                  <Badge>{dashboard.format}</Badge>
                </Table.Cell>
                <Table.Cell textAlign="right">
                  {readonly ? null : (
                    <Button
                      size="xs"
                      variant="ghost"
                      colorPalette="red"
                      onClick={() => {
                        if (
                          window.confirm(`Delete dashboard "${dashboard.name}"?`)
                        ) {
                          remove.mutate(dashboard.name);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      ) : null}
    </Flex>
  );
}
