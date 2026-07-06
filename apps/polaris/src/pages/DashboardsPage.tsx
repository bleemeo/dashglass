import { useRef, useState } from "react";

import {
  Badge,
  Button,
  CloseButton,
  Flex,
  Heading,
  Input,
  InputGroup,
  Link as ChakraLink,
  Table,
  Text,
} from "@chakra-ui/react";
import { Link, useSearchParams } from "react-router";

import { getDashboardFile, putDashboard } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { NewDashboardDialog } from "../components/NewDashboardDialog";
import { RenameDashboardDialog } from "../components/RenameDashboardDialog";
import { DashboardsIcon, PlusIcon } from "../components/icons";
import { toaster } from "../components/toaster";
import { usePageTitle } from "../hooks/usePageTitle";
import { useKeyShortcut } from "../hooks/useShortcuts";
import { filterDashboards } from "../lib/dashboardFilter";

import {
  useDashboards,
  useDeleteDashboard,
  usePermissions,
} from "../api/hooks";

export function DashboardsPage() {
  const dashboards = useDashboards();
  const remove = useDeleteDashboard();
  // canEdit already folds in the provisioned readonly mode and the role.
  const { canEdit } = usePermissions();
  const readonly = !canEdit;
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  usePageTitle("Dashboards");

  // The filter lives in the URL (?q=) so a filtered list is shareable.
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const setQuery = (value: string) =>
    setSearchParams(value === "" ? {} : { q: value }, { replace: true });
  const filterRef = useRef<HTMLInputElement>(null);
  useKeyShortcut("/", () => filterRef.current?.focus());

  const visible = filterDashboards(dashboards.data ?? [], query);

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
      {renaming ? (
        <RenameDashboardDialog
          name={renaming}
          onClose={() => setRenaming(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete dashboard"
          message={`"${deleting}" will be removed from the dashboards directory.`}
          loading={remove.isPending}
          onConfirm={() => {
            const name = deleting;
            // Keep the content around so the toast can offer Undo.
            void getDashboardFile(name)
              .catch(() => null)
              .then((backup) =>
                remove.mutate(name, {
                  onSettled: () => setDeleting(null),
                  onSuccess: () => {
                    toaster.create({
                      title: `"${name}" deleted`,
                      type: "info",
                      duration: 8000,
                      ...(backup
                        ? {
                            action: {
                              label: "Undo",
                              onClick: () => {
                                void putDashboard(
                                  name,
                                  backup.content,
                                  backup.format,
                                ).catch((error: unknown) =>
                                  toaster.create({
                                    title: "Could not restore",
                                    description: String(error),
                                    type: "error",
                                  }),
                                );
                              },
                            },
                          }
                        : {}),
                    });
                  },
                }),
              );
          }}
          onClose={() => setDeleting(null)}
        />
      ) : null}

      {dashboards.data?.length ? (
        <InputGroup
          maxWidth="320px"
          endElement={
            query !== "" ? (
              <CloseButton
                size="2xs"
                aria-label="Clear filter"
                onClick={() => {
                  setQuery("");
                  filterRef.current?.focus();
                }}
              />
            ) : undefined
          }
        >
          <Input
            ref={filterRef}
            size="sm"
            placeholder="Filter dashboards…"
            title="Press / to focus"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
                event.currentTarget.blur();
              }
            }}
          />
        </InputGroup>
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

      {dashboards.data?.length && visible.length === 0 ? (
        <Flex
          direction="column"
          alignItems="center"
          gap={3}
          paddingY={16}
          color="fg.muted"
        >
          <Text>No dashboards match "{query}".</Text>
          <Button size="sm" variant="outline" onClick={() => setQuery("")}>
            Clear filter
          </Button>
        </Flex>
      ) : null}

      {visible.length ? (
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
            {[...visible]
              .sort((a, b) => {
                // Root dashboards first, then folders alphabetically.
                const folderA = a.name.includes("/") ? a.name.split("/")[0]! : "";
                const folderB = b.name.includes("/") ? b.name.split("/")[0]! : "";
                return folderA === folderB
                  ? a.name.localeCompare(b.name)
                  : folderA.localeCompare(folderB);
              })
              .flatMap((dashboard, index, sorted) => {
                const folder = dashboard.name.includes("/")
                  ? dashboard.name.split("/")[0]!
                  : "";
                const previous = index > 0 ? sorted[index - 1]! : null;
                const previousFolder = previous?.name.includes("/")
                  ? previous.name.split("/")[0]!
                  : "";
                const rows = [];
                if (folder !== "" && folder !== previousFolder) {
                  rows.push(
                    <Table.Row key={`folder-${folder}`}>
                      <Table.Cell colSpan={4} paddingTop={4}>
                        <Text
                          fontSize="xs"
                          fontWeight="semibold"
                          textTransform="uppercase"
                          letterSpacing="wide"
                          color="fg.muted"
                        >
                          {folder}/
                        </Text>
                      </Table.Cell>
                    </Table.Row>,
                  );
                }
                rows.push(
              <Table.Row key={dashboard.name}>
                <Table.Cell paddingLeft={folder !== "" ? 6 : undefined}>
                  <ChakraLink asChild fontWeight="medium">
                    <Link to={`/d/${encodeURIComponent(dashboard.name)}`}>
                      {dashboard.displayName ||
                        dashboard.name.split("/").at(-1)}
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
                    <>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setRenaming(dashboard.name)}
                      >
                        Rename
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorPalette="red"
                        onClick={() => setDeleting(dashboard.name)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </Table.Cell>
              </Table.Row>,
                );
                return rows;
              })}
          </Table.Body>
        </Table.Root>
      ) : null}
    </Flex>
  );
}
