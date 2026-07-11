import { useMemo, useRef, useState } from "react";

import { Box, Button, chakra, Flex, Input, Text } from "@chakra-ui/react";
import { GridLayout, useContainerWidth } from "react-grid-layout";
import { Link, useNavigate, useParams } from "react-router";
import "react-grid-layout/css/styles.css";

import {
  addLayout,
  addPanel,
  parseDashboard,
  panelKeyFromRef,
  removePanelAt,
  setLayoutTitle,
  setVariables,
  stringifyDashboard,
  uniquePanelKey,
  updateLayoutItems,
  updatePanel,
  type Dashboard,
  type DashboardFormat,
  type GridItem,
  type GridLayout as GridLayoutModel,
  type Panel,
} from "@dashglass/model";
import {
  GRID_COLUMNS,
  GRID_GAP,
  GRID_ROW_HEIGHT,
  PanelChrome,
  TimeRangeProvider,
  VariablesProvider,
  defaultTimeRange,
} from "@dashglass/runtime";

import { APIError, isNotFound } from "../api/client";
import { DashboardNotFound } from "../components/DashboardNotFound";
import {
  useCapabilities,
  useDashboardFile,
  usePermissions,
  useSaveDashboard,
} from "../api/hooks";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TimeRangeControls } from "../components/TimeRangeControls";
import { TopBar } from "../components/TopBar";
import { UnsavedChangesGuard } from "../components/UnsavedChangesGuard";
import { VariablesToolbar } from "../components/VariablesToolbar";
import { PanelEditorDrawer } from "../components/editor/PanelEditorDrawer";
import { VariablesEditorDialog } from "../components/editor/VariablesEditorDialog";
import { CodeIcon, PlusIcon } from "../components/icons";
import { toaster } from "../components/toaster";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  useSaveShortcut,
  useUndoRedoShortcuts,
  useUnsavedChangesWarning,
} from "../hooks/useShortcuts";

function newTimeSeriesPanel(): Panel {
  return {
    kind: "Panel",
    spec: {
      plugin: { kind: "TimeSeriesChart", spec: {} },
    },
  };
}

function SectionEditor({
  layout,
  dashboard,
  onItemsChange,
  onTitleChange,
  onEditPanel,
  onRemovePanel,
  onAddPanel,
}: {
  layout: GridLayoutModel;
  dashboard: Dashboard;
  onItemsChange: (items: GridItem[]) => void;
  onTitleChange: (title: string) => void;
  onEditPanel: (panelKey: string) => void;
  onRemovePanel: (itemIndex: number) => void;
  onAddPanel: () => void;
}) {
  const { width, containerRef, mounted } = useContainerWidth();

  const rglLayout = layout.spec.items.map((item, index) => ({
    i: String(index),
    x: item.x,
    y: item.y,
    w: item.width,
    h: item.height,
  }));

  return (
    <Box as="section">
      <Flex alignItems="center" gap={2} marginBottom={2}>
        <Input
          size="sm"
          variant="flushed"
          fontWeight="semibold"
          placeholder="Section title (optional)"
          maxWidth="360px"
          value={layout.spec.display?.title ?? ""}
          onChange={(event) => onTitleChange(event.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          colorPalette="brand"
          onClick={onAddPanel}
        >
          <PlusIcon /> Add panel
        </Button>
      </Flex>
      <Box ref={containerRef}>
        {layout.spec.items.length === 0 ? (
          <chakra.button
            type="button"
            onClick={onAddPanel}
            display="flex"
            alignItems="center"
            justifyContent="center"
            gap={2}
            width="full"
            minHeight="120px"
            borderWidth="1px"
            borderStyle="dashed"
            borderColor="border"
            borderRadius="lg"
            color="fg.muted"
            transition="border-color 0.15s, color 0.15s"
            _hover={{ borderColor: "brand.emphasized", color: "fg" }}
          >
            <PlusIcon /> Add a panel
          </chakra.button>
        ) : mounted ? (
          <GridLayout
            width={width}
            layout={rglLayout}
            gridConfig={{
              cols: GRID_COLUMNS,
              rowHeight: GRID_ROW_HEIGHT,
              margin: [GRID_GAP, GRID_GAP],
              containerPadding: [0, 0],
            }}
            dragConfig={{ handle: ".dashglass-panel-header" }}
            onLayoutChange={(next) => {
              const items = layout.spec.items.map((item, index) => {
                const moved = next.find((l) => l.i === String(index));
                return moved
                  ? {
                      ...item,
                      x: moved.x,
                      y: moved.y,
                      width: moved.w,
                      height: moved.h,
                    }
                  : item;
              });
              // RGL reports a layout on mount too; only propagate real moves
              // so an untouched dashboard does not become a dirty draft.
              const unchanged = items.every((item, index) => {
                const previous = layout.spec.items[index]!;
                return (
                  item.x === previous.x &&
                  item.y === previous.y &&
                  item.width === previous.width &&
                  item.height === previous.height
                );
              });
              if (!unchanged) {
                onItemsChange(items);
              }
            }}
          >
            {layout.spec.items.map((item, index) => {
              const panelKey = panelKeyFromRef(item.content.$ref);
              const panel = dashboard.spec.panels[panelKey];
              if (!panel) {
                return null;
              }
              return (
                <div key={String(index)} className="dashglass-editor-item">
                  <PanelChrome panelKey={panelKey} panel={panel} />
                  <Flex
                    className="dashglass-editor-actions"
                    position="absolute"
                    top={1}
                    right={1}
                    gap={1}
                  >
                    <Button
                      size="2xs"
                      variant="subtle"
                      onClick={() => onEditPanel(panelKey)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="2xs"
                      variant="subtle"
                      colorPalette="red"
                      onClick={() => onRemovePanel(index)}
                    >
                      ✕
                    </Button>
                  </Flex>
                </div>
              );
            })}
          </GridLayout>
        ) : null}
      </Box>
    </Box>
  );
}

function EditorView({
  name,
  initial,
  format,
}: {
  name: string;
  initial: Dashboard;
  format: DashboardFormat;
}) {
  const navigate = useNavigate();
  const save = useSaveDashboard(name);
  const capabilities = useCapabilities();
  const provisioned = capabilities.data?.readonly ?? false;
  // Also covers the viewer role: a deep link into the editor must not
  // offer work that Save will refuse with a 403.
  const { canEdit, loading: permissionsLoading } = usePermissions();
  const readonly = !permissionsLoading && !canEdit;

  const [draft, setDraft] = useState<Dashboard>(initial);
  usePageTitle(`${initial.spec.display?.name ?? name} · edit`);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingVariables, setEditingVariables] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = draft !== initial;
  // Lets the post-save navigation through the guard (the draft still
  // differs from `initial` until the refetch lands).
  const justSaved = useRef(false);

  // Undo/redo: dashboards are immutable (edit.ts), so history is just a
  // stack of references. Same-key edits coalesce (typing in the drawer
  // stays one step per field, not one per keystroke).
  const past = useRef<Dashboard[]>([]);
  const future = useRef<Dashboard[]>([]);
  const lastEditKey = useRef<string | null>(null);
  const applyEdit = (next: Dashboard, coalesceKey?: string) => {
    if (next === draft) {
      return;
    }
    if (coalesceKey === undefined || coalesceKey !== lastEditKey.current) {
      past.current.push(draft);
      future.current = [];
    }
    lastEditKey.current = coalesceKey ?? null;
    setDraft(next);
  };
  const undo = () => {
    const previous = past.current.pop();
    if (previous) {
      future.current.push(draft);
      lastEditKey.current = null;
      setDraft(previous);
    }
  };
  const redo = () => {
    const next = future.current.pop();
    if (next) {
      past.current.push(draft);
      lastEditKey.current = null;
      setDraft(next);
    }
  };
  useUndoRedoShortcuts(undo, redo);

  const editingPanel = editing ? draft.spec.panels[editing] : undefined;
  const issues = save.error instanceof APIError ? save.error.issues : [];

  const doSave = () => {
    if (readonly || !dirty || save.isPending) {
      return;
    }
    save.mutate(
      { content: stringifyDashboard(draft, format), format },
      {
        onSuccess: () => {
          toaster.create({ title: "Dashboard saved", type: "success" });
          justSaved.current = true;
          void navigate(`/d/${encodeURIComponent(name)}`);
        },
      },
    );
  };
  useSaveShortcut(doSave);
  useUnsavedChangesWarning(dirty);

  return (
    <TimeRangeProvider initialRange={defaultTimeRange(initial)}>
      {/* Keyed on the draft's variables so saving the variables dialog
          reflects immediately in the preview toolbar and panels. */}
      <VariablesProvider variables={draft.spec.variables}>
        <Flex direction="column" gap={3} height="100%">
          <TopBar
            crumbs={[
              { label: "Dashboards", to: "/" },
              {
                label: draft.spec.display?.name ?? name,
                to: `/d/${encodeURIComponent(name)}`,
              },
              { label: "Edit" },
            ]}
            actions={
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={past.current.length === 0}
                  title="⌘Z"
                  onClick={undo}
                >
                  Undo
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={future.current.length === 0}
                  title="⇧⌘Z"
                  onClick={redo}
                >
                  Redo
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void navigate(`/d/${encodeURIComponent(name)}/code`)
                  }
                >
                  <CodeIcon /> Edit as code
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (dirty) {
                      setConfirmDiscard(true);
                    } else {
                      void navigate(`/d/${encodeURIComponent(name)}`);
                    }
                  }}
                >
                  {dirty ? "Discard" : "Back"}
                </Button>
                <Button
                  size="sm"
                  colorPalette="brand"
                  disabled={readonly || !dirty}
                  loading={save.isPending}
                  title="⌘S"
                  onClick={doSave}
                >
                  Save
                </Button>
              </>
            }
          />

          {/* Preview controls: the grid below is the live preview, so the
              range and variable values must be steerable while editing. */}
          <Flex gap={3} alignItems="center" wrap="wrap">
            <VariablesToolbar variables={draft.spec.variables ?? []} />
            <Button
              size="xs"
              variant="outline"
              onClick={() => setEditingVariables(true)}
            >
              Variables…
            </Button>
            <TimeRangeControls
              refreshInterval="off"
              onRefreshIntervalChange={() => {}}
              hideRefreshInterval
            />
          </Flex>

          {readonly ? (
            <Text fontSize="sm" color="fg.muted">
              {provisioned
                ? "Dashboards are provisioned read-only on this instance — edit the file in git instead."
                : "Your role does not allow editing dashboards — changes cannot be saved."}
            </Text>
          ) : null}
          {save.error ? (
            <Flex direction="column" gap={1}>
              <Text color="fg.error" fontSize="sm">
                {save.error instanceof APIError
                  ? save.error.message
                  : String(save.error)}
              </Text>
              {issues.map((issue) => (
                <Text
                  key={issue}
                  color="fg.error"
                  fontSize="xs"
                  fontFamily="mono"
                >
                  {issue}
                </Text>
              ))}
            </Flex>
          ) : null}

          <Flex direction="column" gap={6} flex={1} minHeight={0}>
            {draft.spec.layouts.map((layout, layoutIndex) => (
              <SectionEditor
                key={layoutIndex}
                layout={layout}
                dashboard={draft}
                onItemsChange={(items) =>
                  applyEdit(updateLayoutItems(draft, layoutIndex, items))
                }
                onTitleChange={(title) =>
                  applyEdit(
                    setLayoutTitle(draft, layoutIndex, title),
                    `section-title:${layoutIndex}`,
                  )
                }
                onEditPanel={setEditing}
                onRemovePanel={(itemIndex) =>
                  applyEdit(removePanelAt(draft, layoutIndex, itemIndex))
                }
                onAddPanel={() => {
                  const key = uniquePanelKey(draft);
                  applyEdit(
                    addPanel(draft, key, newTimeSeriesPanel(), layoutIndex),
                  );
                  setEditing(key);
                }}
              />
            ))}
            <Button
              size="sm"
              variant="outline"
              colorPalette="brand"
              alignSelf="flex-start"
              onClick={() => applyEdit(addLayout(draft))}
            >
              <PlusIcon /> Add section
            </Button>
          </Flex>

          {editingVariables ? (
            <VariablesEditorDialog
              variables={draft.spec.variables ?? []}
              onSave={(variables) => applyEdit(setVariables(draft, variables))}
              onClose={() => setEditingVariables(false)}
            />
          ) : null}
          {editing && editingPanel ? (
            <PanelEditorDrawer
              panelKey={editing}
              panel={editingPanel}
              variableNames={(draft.spec.variables ?? []).map(
                (variable) => variable.spec.name,
              )}
              onChange={(panel) =>
                applyEdit(updatePanel(draft, editing, panel), `panel:${editing}`)
              }
              onClose={() => setEditing(null)}
            />
          ) : null}
          {confirmDiscard ? (
            <ConfirmDialog
              title="Unsaved changes"
              message="This dashboard has unsaved changes. Discard them?"
              confirmLabel="Discard"
              onConfirm={() => {
                setConfirmDiscard(false);
                past.current = [];
                future.current = [];
                lastEditKey.current = null;
                setDraft(initial);
              }}
              onClose={() => setConfirmDiscard(false)}
            />
          ) : null}
          <UnsavedChangesGuard when={dirty} bypass={justSaved} />
        </Flex>
      </VariablesProvider>
    </TimeRangeProvider>
  );
}

/**
 * Form-based dashboard editing: drag & resize on the grid, panel forms in
 * a drawer. The draft only becomes a file on Save, through the
 * deterministic serializer, so the resulting git diff stays minimal.
 */
export function DashboardEditorPage() {
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
        <Text color="fg.error">
          This dashboard file is invalid — fix it as code first:
        </Text>
        <Text as="pre" fontSize="xs" whiteSpace="pre-wrap">
          {parsed.error}
        </Text>
        <Button size="sm" alignSelf="flex-start" asChild>
          <Link to={`/d/${encodeURIComponent(name)}/code`}>Edit the file</Link>
        </Button>
      </Flex>
    );
  }
  if (!parsed || !file.data) {
    return null;
  }
  // Key by name so navigating to another dashboard resets the draft.
  return (
    <EditorView
      key={name}
      name={name}
      initial={parsed.dashboard}
      format={file.data.format}
    />
  );
}
