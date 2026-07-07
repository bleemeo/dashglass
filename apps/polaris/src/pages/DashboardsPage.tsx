import { useRef, useState } from "react";

import {
  Badge,
  Box,
  Button,
  CloseButton,
  Flex,
  IconButton,
  Input,
  InputGroup,
  Link as ChakraLink,
  SimpleGrid,
  Table,
  Text,
} from "@chakra-ui/react";
import { Link, useSearchParams } from "react-router";

import type { DashboardInfo } from "../api/client";
import { DashboardPreview } from "../components/DashboardPreview";
import { TopBar } from "../components/TopBar";

import { getDashboardFile, putDashboard } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { NewDashboardDialog } from "../components/NewDashboardDialog";
import { RenameDashboardDialog } from "../components/RenameDashboardDialog";
import { DashboardsIcon, PlusIcon } from "../components/icons";
import { toaster } from "../components/toaster";
import { usePageTitle } from "../hooks/usePageTitle";
import { useKeyShortcut } from "../hooks/useShortcuts";
import { filterDashboards } from "../lib/dashboardFilter";
import { relativeTime } from "../lib/relativeTime";

import {
  useDashboards,
  useDeleteDashboard,
  usePermissions,
} from "../api/hooks";

type DashboardView = "cards" | "table";
const VIEW_KEY = "polaris-dashboards-view";

function readView(): DashboardView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

function folderOf(name: string): string {
  return name.includes("/") ? name.split("/")[0]! : "";
}

/** Root dashboards first, then folders alphabetically, names within. */
function byFolderThenName(a: DashboardInfo, b: DashboardInfo): number {
  const fa = folderOf(a.name);
  const fb = folderOf(b.name);
  return fa === fb ? a.name.localeCompare(b.name) : fa.localeCompare(fb);
}

/** Contiguous folder groups (input must be pre-sorted by byFolderThenName). */
function groupByFolder(
  list: DashboardInfo[],
): { folder: string; items: DashboardInfo[] }[] {
  const groups: { folder: string; items: DashboardInfo[] }[] = [];
  for (const item of list) {
    const folder = folderOf(item.name);
    const last = groups.at(-1);
    if (last && last.folder === folder) {
      last.items.push(item);
    } else {
      groups.push({ folder, items: [item] });
    }
  }
  return groups;
}

function panelsLabel(count: number): string {
  return `${count} panel${count === 1 ? "" : "s"}`;
}

function GridViewIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}

function ListViewIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: DashboardView;
  onChange: (view: DashboardView) => void;
}) {
  return (
    <Flex borderWidth="1px" borderRadius="md" padding="1px" flexShrink={0}>
      <IconButton
        size="xs"
        variant={view === "cards" ? "subtle" : "ghost"}
        colorPalette={view === "cards" ? "brand" : undefined}
        color={view === "cards" ? undefined : "fg.muted"}
        aria-label="Card view"
        title="Card view"
        onClick={() => onChange("cards")}
      >
        <GridViewIcon />
      </IconButton>
      <IconButton
        size="xs"
        variant={view === "table" ? "subtle" : "ghost"}
        colorPalette={view === "table" ? "brand" : undefined}
        color={view === "table" ? undefined : "fg.muted"}
        aria-label="Table view"
        title="Table view"
        onClick={() => onChange("table")}
      >
        <ListViewIcon />
      </IconButton>
    </Flex>
  );
}

function DashboardCard({
  dashboard,
  readonly,
  onRename,
  onDelete,
}: {
  dashboard: DashboardInfo;
  readonly: boolean;
  onRename: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const title = dashboard.displayName || dashboard.name.split("/").at(-1);
  const panels = dashboard.panels ?? 0;
  return (
    <Flex
      direction="column"
      borderWidth="1px"
      borderRadius="lg"
      overflow="hidden"
      transition="border-color 0.15s, box-shadow 0.15s"
      _hover={{ borderColor: "brand.emphasized", boxShadow: "sm" }}
    >
      <ChakraLink
        asChild
        display="block"
        _hover={{ textDecoration: "none" }}
      >
        <Link to={`/d/${encodeURIComponent(dashboard.name)}`}>
          <Box height="128px" backgroundColor="bg.subtle" padding={2}>
            <DashboardPreview preview={dashboard.preview} />
          </Box>
          <Box
            paddingX={3}
            paddingTop={3}
            paddingBottom={1}
            borderTopWidth="1px"
          >
            <Flex alignItems="center" gap={2}>
              <Text fontWeight="medium" color="fg" truncate>
                {title}
              </Text>
              {dashboard.invalid ? (
                <Badge colorPalette="red" flexShrink={0}>
                  invalid
                </Badge>
              ) : null}
            </Flex>
            {dashboard.description ? (
              <Text
                fontSize="xs"
                color="fg.muted"
                lineClamp={2}
                marginTop={0.5}
              >
                {dashboard.description}
              </Text>
            ) : null}
          </Box>
        </Link>
      </ChakraLink>
      <Flex
        alignItems="center"
        justifyContent="space-between"
        paddingX={3}
        paddingBottom={2}
        marginTop="auto"
      >
        <Text fontSize="xs" color="fg.muted">
          {dashboard.invalid ? "invalid" : panelsLabel(panels)}
          {dashboard.modified ? ` · ${relativeTime(dashboard.modified)}` : ""}
        </Text>
        {readonly ? null : (
          <Flex>
            <Button
              size="2xs"
              variant="ghost"
              onClick={() => onRename(dashboard.name)}
            >
              Rename
            </Button>
            <Button
              size="2xs"
              variant="ghost"
              colorPalette="red"
              onClick={() => onDelete(dashboard.name)}
            >
              Delete
            </Button>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}

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

  const [view, setView] = useState<DashboardView>(readView);
  const chooseView = (next: DashboardView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Not persisting the view is fine.
    }
  };

  const visible = filterDashboards(dashboards.data ?? [], query);
  const groups = groupByFolder([...visible].sort(byFolderThenName));

  return (
    <Flex direction="column" gap={4}>
      <TopBar
        crumbs={[{ label: "Dashboards" }]}
        actions={
          readonly ? undefined : (
            <Button
              size="sm"
              colorPalette="brand"
              onClick={() => setCreating(true)}
            >
              <PlusIcon /> New dashboard
            </Button>
          )
        }
      />
      <Text fontSize="sm" color="fg.muted">
        {dashboards.data?.length
          ? `${dashboards.data.length} dashboard${dashboards.data.length > 1 ? "s" : ""} · stored as files, versioned in git`
          : "File-backed dashboards, versioned in git"}
      </Text>
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
        <Flex justifyContent="space-between" alignItems="center" gap={3}>
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
        <ViewToggle view={view} onChange={chooseView} />
        </Flex>
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

      {visible.length && view === "cards" ? (
        <Flex direction="column" gap={6}>
          {groups.map((group) => (
            <Box key={group.folder || "__root"}>
              {group.folder ? (
                <Text
                  fontSize="xs"
                  fontWeight="semibold"
                  textTransform="uppercase"
                  letterSpacing="wide"
                  color="fg.muted"
                  marginBottom={2}
                >
                  {group.folder}/
                </Text>
              ) : null}
              <SimpleGrid minChildWidth="260px" gap={4}>
                {group.items.map((dashboard) => (
                  <DashboardCard
                    key={dashboard.name}
                    dashboard={dashboard}
                    readonly={readonly}
                    onRename={setRenaming}
                    onDelete={setDeleting}
                  />
                ))}
              </SimpleGrid>
            </Box>
          ))}
        </Flex>
      ) : null}

      {visible.length && view === "table" ? (
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Description</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="right">Panels</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="right">Updated</Table.ColumnHeader>
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
                      <Table.Cell colSpan={5} paddingTop={4}>
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
                <Table.Cell
                  textAlign="right"
                  color="fg.muted"
                  fontVariantNumeric="tabular-nums"
                >
                  {dashboard.invalid ? "—" : (dashboard.panels ?? 0)}
                </Table.Cell>
                <Table.Cell
                  textAlign="right"
                  color="fg.muted"
                  whiteSpace="nowrap"
                  title={dashboard.modified ?? ""}
                >
                  {relativeTime(dashboard.modified)}
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
