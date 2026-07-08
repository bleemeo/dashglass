import { useMemo, useState } from "react";

import {
  Button,
  CloseButton,
  Collapsible,
  Dialog,
  Field,
  Flex,
  Input,
  Portal,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { useNavigate } from "react-router";

import { importGrafanaDashboard } from "@dashglass/grafana-import";
import {
  dashboardSchema,
  stringifyDashboard,
  type Dashboard,
} from "@dashglass/model";

import {
  APIError,
  fetchGrafanaComDashboard,
  putDashboard,
} from "../api/client";
import { useCapabilities, useDashboards } from "../api/hooks";
import { toaster } from "./toaster";

/** Slug per path segment: one "/" is allowed (folder/name). */
function slugify(text: string): string {
  return text
    .split("/")
    .slice(0, 2)
    .map((segment) =>
      segment
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60),
    )
    .filter((segment) => segment !== "")
    .join("/");
}

/** Extracts the dashboard id from a grafana.com URL, or a plain id. */
export function parseGrafanaComID(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/grafana\.com\/(?:grafana\/)?dashboards\/(\d+)/);
  return match?.[1] ?? null;
}

/** A blank starter: one empty section, built through the model so the
 * saved file is canonical from its first byte. */
function blankDashboard(name: string, title: string, description: string): Dashboard {
  return dashboardSchema.parse({
    apiVersion: "v1",
    kind: "Dashboard",
    metadata: { name },
    spec: {
      display: {
        name: title,
        ...(description !== "" ? { description } : {}),
      },
      panels: {},
      layouts: [{ kind: "Grid", spec: { items: [] } }],
      duration: "1h",
    },
  });
}

type Preview =
  | { state: "empty" }
  | { state: "error"; message: string }
  | { state: "ready"; dashboard: Dashboard; warnings: string[] };

function convert(json: string): Preview {
  if (json.trim() === "") {
    return { state: "empty" };
  }
  try {
    const { dashboard, warnings } = importGrafanaDashboard(
      JSON.parse(json) as unknown,
    );
    return { state: "ready", dashboard, warnings };
  } catch (error) {
    return { state: "error", message: String(error) };
  }
}

/**
 * Dashboard creation: one form (title, description, file name) with an
 * optional fold-out "Import from Grafana" section. When the section holds
 * a converted dashboard the primary action imports it (with the form's
 * display fields applied); otherwise it creates a blank dashboard and
 * lands in the visual editor.
 */
export function NewDashboardDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const capabilities = useCapabilities();
  const dashboards = useDashboards();
  const grafanaCom = capabilities.data?.features?.grafanaCom ?? false;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [displayEdited, setDisplayEdited] = useState(false);

  const [json, setJson] = useState("");
  const [marketplaceRef, setMarketplaceRef] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => convert(json), [json]);
  const imported = preview.state === "ready" ? preview.dashboard : null;

  // The import prefills the display fields until the user touches them.
  const effectiveTitle =
    displayEdited || !imported
      ? title
      : (imported.spec.display?.name ?? imported.metadata.name);
  const effectiveDescription =
    displayEdited || !imported
      ? description
      : (imported.spec.display?.description ?? "");
  const effectiveName = nameEdited
    ? name
    : slugify(effectiveTitle) || (imported?.metadata.name ?? "");
  // Live collision check against the cached list; the backend enforces it
  // too (create-only PUT), this is just instant feedback.
  const nameTaken =
    effectiveName !== "" &&
    (dashboards.data?.some((info) => info.name === effectiveName) ?? false);

  const loadFromMarketplace = async () => {
    const id = parseGrafanaComID(marketplaceRef);
    if (!id) {
      setError("Expected a grafana.com dashboard URL or a numeric id.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchGrafanaComDashboard(id);
      setJson(JSON.stringify(result.dashboard));
    } catch (fetchError) {
      setError(String(fetchError));
    } finally {
      setLoading(false);
    }
  };

  const save = async (dashboard: Dashboard, destination: string) => {
    setSaving(true);
    setError(null);
    try {
      await putDashboard(
        effectiveName,
        stringifyDashboard(dashboard, "yaml"),
        "yaml",
        { createOnly: true },
      );
      toaster.create({
        title: imported ? "Dashboard imported" : "Dashboard created",
        type: "success",
      });
      onClose();
      void navigate(destination);
    } catch (saveError) {
      setError(
        saveError instanceof APIError
          ? [saveError.message, ...saveError.issues].join("\n")
          : String(saveError),
      );
    } finally {
      setSaving(false);
    }
  };

  const create = () => {
    if (effectiveTitle.trim() === "" || effectiveName === "") {
      setError("A title is required.");
      return;
    }
    // With a folder ("infra/db"), metadata.name stays the base name.
    const metadataName = effectiveName.split("/").at(-1)!;
    if (imported) {
      const dashboard: Dashboard = {
        ...imported,
        metadata: { name: metadataName },
        spec: {
          ...imported.spec,
          display: {
            name: effectiveTitle.trim(),
            ...(effectiveDescription.trim() !== ""
              ? { description: effectiveDescription.trim() }
              : {}),
          },
        },
      };
      void save(dashboard, `/d/${encodeURIComponent(effectiveName)}`);
      return;
    }
    try {
      const dashboard = blankDashboard(
        metadataName,
        effectiveTitle.trim(),
        effectiveDescription.trim(),
      );
      void save(dashboard, `/d/${encodeURIComponent(effectiveName)}/edit`);
    } catch (buildError) {
      setError(String(buildError));
    }
  };

  const pickFile = (file: File | undefined) => {
    if (!file) {
      return;
    }
    void file.text().then(setJson);
  };

  return (
    <Dialog.Root
      open
      size="lg"
      onOpenChange={(event) => {
        if (!event.open) {
          onClose();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>New dashboard</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Flex direction="column" gap={3}>
                <Field.Root required>
                  <Field.Label>
                    Title <Field.RequiredIndicator />
                  </Field.Label>
                  <Input
                    size="sm"
                    placeholder="Node overview"
                    value={effectiveTitle}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setDisplayEdited(true);
                    }}
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Description</Field.Label>
                  <Input
                    size="sm"
                    value={effectiveDescription}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setDisplayEdited(true);
                    }}
                  />
                </Field.Root>
                <Field.Root invalid={nameTaken}>
                  <Field.Label>File name</Field.Label>
                  <Input
                    size="sm"
                    fontFamily="mono"
                    value={effectiveName}
                    onChange={(event) => {
                      setName(slugify(event.target.value));
                      setNameEdited(true);
                    }}
                  />
                  {nameTaken ? (
                    <Field.ErrorText>
                      A dashboard named "{effectiveName}" already exists —
                      pick another file name.
                    </Field.ErrorText>
                  ) : (
                    <Field.HelperText>
                      The dashboard's identifier in the dashboards directory.
                    </Field.HelperText>
                  )}
                </Field.Root>

                <Collapsible.Root>
                  <Collapsible.Trigger asChild>
                    <Button size="xs" variant="ghost" alignSelf="flex-start">
                      ▸ Import from Grafana (optional)
                    </Button>
                  </Collapsible.Trigger>
                  <Collapsible.Content>
                    <Flex
                      direction="column"
                      gap={3}
                      marginTop={2}
                      padding={3}
                      borderWidth="1px"
                      borderRadius="md"
                    >
                      {grafanaCom ? (
                        <Field.Root>
                          <Field.Label>From grafana.com</Field.Label>
                          <Flex gap={2} width="100%">
                            <Input
                              size="sm"
                              placeholder="https://grafana.com/grafana/dashboards/1860… or 1860"
                              value={marketplaceRef}
                              onChange={(event) =>
                                setMarketplaceRef(event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  void loadFromMarketplace();
                                }
                              }}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              loading={loading}
                              onClick={() => void loadFromMarketplace()}
                            >
                              Load
                            </Button>
                          </Flex>
                        </Field.Root>
                      ) : null}
                      <Field.Root>
                        <Field.Label>
                          …or a JSON export (Share → Export in Grafana)
                        </Field.Label>
                        <Input
                          type="file"
                          accept=".json,application/json"
                          size="sm"
                          paddingTop={1}
                          onChange={(event) =>
                            pickFile(event.target.files?.[0])
                          }
                        />
                        <Textarea
                          fontFamily="mono"
                          fontSize="xs"
                          rows={4}
                          placeholder='…or paste it: {"title": "...", "panels": [...]}'
                          value={json}
                          onChange={(event) => setJson(event.target.value)}
                        />
                      </Field.Root>

                      {preview.state === "error" ? (
                        <Text fontSize="sm" color="fg.error">
                          {preview.message}
                        </Text>
                      ) : null}
                      {preview.state === "ready" ? (
                        <>
                          <Text fontSize="sm">
                            Ready to import:{" "}
                            {Object.keys(preview.dashboard.spec.panels).length}{" "}
                            panels, {preview.dashboard.spec.layouts.length}{" "}
                            sections,{" "}
                            {preview.dashboard.spec.variables?.length ?? 0}{" "}
                            variables.
                          </Text>
                          {preview.warnings.length > 0 ? (
                            <Flex
                              direction="column"
                              gap={1}
                              maxHeight="120px"
                              overflowY="auto"
                              borderWidth="1px"
                              borderRadius="md"
                              padding={2}
                            >
                              <Text fontSize="xs" fontWeight="medium">
                                Imported with approximations:
                              </Text>
                              {preview.warnings.map((warning, index) => (
                                <Text
                                  key={index}
                                  fontSize="xs"
                                  color="fg.muted"
                                >
                                  • {warning}
                                </Text>
                              ))}
                            </Flex>
                          ) : null}
                        </>
                      ) : null}
                    </Flex>
                  </Collapsible.Content>
                </Collapsible.Root>

                {error ? (
                  <Text fontSize="sm" color="fg.error" whiteSpace="pre-wrap">
                    {error}
                  </Text>
                ) : null}
              </Flex>
            </Dialog.Body>
            <Dialog.Footer>
              <Button size="sm" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                colorPalette="brand"
                loading={saving}
                disabled={effectiveTitle.trim() === "" || nameTaken}
                onClick={create}
              >
                {imported ? "Import" : "Create and edit"}
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
