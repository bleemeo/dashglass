import { useState } from "react";

import {
  Badge,
  Button,
  Flex,
  Heading,
  Link as ChakraLink,
  Table,
  Text,
} from "@chakra-ui/react";
import { Link } from "react-router";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { NewDashboardDialog } from "../components/NewDashboardDialog";
import { DashboardsIcon, PlusIcon } from "../components/icons";
import { usePageTitle } from "../hooks/usePageTitle";

import {
  useCapabilities,
  useDashboards,
  useDeleteDashboard,
} from "../api/hooks";

export function DashboardsPage() {
  const dashboards = useDashboards();
  const capabilities = useCapabilities();
  const remove = useDeleteDashboard();
  const readonly = capabilities.data?.readonly ?? false;
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  usePageTitle("Dashboards");

  return (
    <Flex direction="column" gap={4}>
      <Flex justifyContent="space-between" alignItems="center">
        <Heading size="lg">Dashboards</Heading>
        {readonly ? null : (
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon /> New dashboard
          </Button>
        )}
      </Flex>
      {creating ? (
        <NewDashboardDialog onClose={() => setCreating(false)} />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete dashboard"
          message={`"${deleting}" will be removed from the dashboards directory. If it is under git, it can be restored from history.`}
          loading={remove.isPending}
          onConfirm={() => {
            remove.mutate(deleting, { onSettled: () => setDeleting(null) });
          }}
          onClose={() => setDeleting(null)}
        />
      ) : null}

      {dashboards.isLoading ? <Text>Loading…</Text> : null}
      {dashboards.error ? (
        <Text color="fg.error">{String(dashboards.error)}</Text>
      ) : null}
      {dashboards.data?.length === 0 ? (
        <Flex
          direction="column"
          alignItems="center"
          gap={3}
          paddingY={16}
          color="fg.muted"
        >
          <DashboardsIcon />
          <Text>No dashboards yet.</Text>
          {readonly ? (
            <Text fontSize="sm">
              Drop a file in the dashboards directory to get started.
            </Text>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreating(true)}
            >
              <PlusIcon /> Create your first dashboard
            </Button>
          )}
        </Flex>
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
                      onClick={() => setDeleting(dashboard.name)}
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
