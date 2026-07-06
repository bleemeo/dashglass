import { useState } from "react";

import {
  Box,
  Button,
  CloseButton,
  Drawer,
  Field,
  Flex,
  Input,
  NativeSelect,
  Portal,
  Text,
  Textarea,
} from "@chakra-ui/react";

import type { Panel, Query } from "@polarisui/model";
import { PROMETHEUS_QUERY_KIND, useRuntime } from "@polarisui/runtime";

import { LazyPromQLEditor } from "../LazyPromQLEditor";

function emptyQuery(): Query {
  return {
    kind: "TimeSeriesQuery",
    spec: { plugin: { kind: PROMETHEUS_QUERY_KIND, spec: { query: "" } } },
  };
}

/** Raw-JSON fallback for plugin kinds that ship no options form. */
function RawSpecEditor({
  spec,
  onChange,
}: {
  spec: Record<string, unknown>;
  onChange: (spec: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(spec, null, 2));
  const [invalid, setInvalid] = useState(false);

  return (
    <Field.Root invalid={invalid}>
      <Field.Label>Options (JSON)</Field.Label>
      <Textarea
        fontFamily="mono"
        fontSize="xs"
        rows={8}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          try {
            onChange(
              JSON.parse(event.target.value) as Record<string, unknown>,
            );
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
      />
      {invalid ? <Field.ErrorText>Invalid JSON.</Field.ErrorText> : null}
    </Field.Root>
  );
}

function QueryEditor({
  query,
  index,
  onChange,
  onRemove,
}: {
  query: Query;
  index: number;
  onChange: (query: Query) => void;
  onRemove: () => void;
}) {
  const plugin = query.spec.plugin;
  const promql =
    typeof plugin.spec?.["query"] === "string"
      ? (plugin.spec["query"] as string)
      : "";
  const seriesNameFormat =
    typeof plugin.spec?.["seriesNameFormat"] === "string"
      ? (plugin.spec["seriesNameFormat"] as string)
      : "";

  const updateSpec = (updates: Record<string, unknown>) => {
    const spec = { ...plugin.spec, ...updates };
    // Omitted keys keep saved files minimal (defaults-omitted rule).
    for (const [key, value] of Object.entries(updates)) {
      if (value === "" || value === undefined) {
        delete spec[key];
      }
    }
    onChange({
      ...query,
      spec: { ...query.spec, plugin: { ...plugin, spec } },
    });
  };

  if (plugin.kind !== PROMETHEUS_QUERY_KIND) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Query {index + 1} uses the unsupported kind “{plugin.kind}”.
      </Text>
    );
  }

  return (
    <Box borderWidth="1px" borderRadius="md" padding={2}>
      <Flex justifyContent="space-between" alignItems="center" marginBottom={1}>
        <Text fontSize="xs" fontWeight="medium" color="fg.muted">
          Query {index + 1}
        </Text>
        <Button size="2xs" variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </Flex>
      <LazyPromQLEditor
        value={promql}
        onChange={(value) => updateSpec({ query: value })}
        completeURL=""
        placeholder="PromQL expression"
      />
      <Field.Root marginTop={2}>
        <Field.Label fontSize="xs">Legend format</Field.Label>
        <Input
          size="xs"
          placeholder="{{instance}} — {{mountpoint}}"
          value={seriesNameFormat}
          onChange={(event) =>
            updateSpec({ seriesNameFormat: event.target.value })
          }
        />
      </Field.Root>
    </Box>
  );
}

export interface PanelEditorDrawerProps {
  panelKey: string;
  panel: Panel;
  onChange: (panel: Panel) => void;
  onClose: () => void;
}

/**
 * The panel form: display, kind (through the panel registry), kind-specific
 * options (the plugin's own editor component, DESIGN.md §7) and queries.
 * Edits apply to the page's draft immediately — the grid behind is the
 * live preview; the page's Discard still cancels everything.
 */
export function PanelEditorDrawer({
  panelKey,
  panel,
  onChange,
  onClose,
}: PanelEditorDrawerProps) {
  const { registries } = useRuntime();
  const kinds = registries.panels.list();
  const plugin = registries.panels.get(panel.spec.plugin.kind);
  const SpecEditor = plugin?.editor;

  const updateSpec = (updates: Partial<Panel["spec"]>) =>
    onChange({ ...panel, spec: { ...panel.spec, ...updates } });

  const setDisplay = (name: string, description: string) => {
    const display: { name?: string; description?: string } = {};
    if (name !== "") {
      display.name = name;
    }
    if (description !== "") {
      display.description = description;
    }
    updateSpec({
      display: Object.keys(display).length > 0 ? display : undefined,
    });
  };

  const queries = panel.spec.queries ?? [];

  return (
    // Non-modal on purpose: the grid behind is the live preview, so it
    // must stay visible (no backdrop) and interactive (hover tooltips,
    // scroll to the edited panel) while the form is open.
    <Drawer.Root
      open
      size="md"
      modal={false}
      closeOnInteractOutside={false}
      onOpenChange={(event) => {
        if (!event.open) {
          onClose();
        }
      }}
    >
      <Portal>
        <Drawer.Positioner pointerEvents="none">
          <Drawer.Content pointerEvents="auto">
            <Drawer.Header>
              <Drawer.Title>
                Panel “{panel.spec.display?.name ?? panelKey}”
              </Drawer.Title>
            </Drawer.Header>
            <Drawer.Body>
              <Flex direction="column" gap={4}>
                <Field.Root>
                  <Field.Label>Title</Field.Label>
                  <Input
                    size="sm"
                    value={panel.spec.display?.name ?? ""}
                    onChange={(event) =>
                      setDisplay(
                        event.target.value,
                        panel.spec.display?.description ?? "",
                      )
                    }
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Description</Field.Label>
                  <Input
                    size="sm"
                    value={panel.spec.display?.description ?? ""}
                    onChange={(event) =>
                      setDisplay(
                        panel.spec.display?.name ?? "",
                        event.target.value,
                      )
                    }
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Type</Field.Label>
                  <NativeSelect.Root size="sm">
                    <NativeSelect.Field
                      value={panel.spec.plugin.kind}
                      onChange={(event) => {
                        const kind = event.target.value;
                        updateSpec({
                          plugin: {
                            kind,
                            spec:
                              (registries.panels.get(kind)
                                ?.defaultSpec as Record<string, unknown>) ??
                              {},
                          },
                        });
                      }}
                    >
                      {!plugin ? (
                        <option value={panel.spec.plugin.kind}>
                          {panel.spec.plugin.kind} (unregistered)
                        </option>
                      ) : null}
                      {kinds.map((definition) => (
                        <option key={definition.kind} value={definition.kind}>
                          {definition.displayName ?? definition.kind}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Field.Root>

                {SpecEditor ? (
                  <SpecEditor
                    spec={panel.spec.plugin.spec ?? {}}
                    onChange={(spec) =>
                      updateSpec({
                        plugin: { ...panel.spec.plugin, spec },
                      })
                    }
                  />
                ) : (
                  <RawSpecEditor
                    key={panel.spec.plugin.kind}
                    spec={panel.spec.plugin.spec ?? {}}
                    onChange={(spec) =>
                      updateSpec({
                        plugin: { ...panel.spec.plugin, spec },
                      })
                    }
                  />
                )}

                <Flex direction="column" gap={2}>
                  <Text fontSize="sm" fontWeight="medium">
                    Queries
                  </Text>
                  {queries.map((query, index) => (
                    <QueryEditor
                      key={index}
                      query={query}
                      index={index}
                      onChange={(next) =>
                        updateSpec({
                          queries: queries.map((q, i) =>
                            i === index ? next : q,
                          ),
                        })
                      }
                      onRemove={() => {
                        const next = queries.filter((_, i) => i !== index);
                        updateSpec({
                          queries: next.length > 0 ? next : undefined,
                        });
                      }}
                    />
                  ))}
                  <Button
                    size="xs"
                    variant="outline"
                    alignSelf="flex-start"
                    onClick={() =>
                      updateSpec({ queries: [...queries, emptyQuery()] })
                    }
                  >
                    Add query
                  </Button>
                </Flex>
              </Flex>
            </Drawer.Body>
            <Drawer.Footer>
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </Drawer.Footer>
            <Drawer.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Drawer.CloseTrigger>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}
