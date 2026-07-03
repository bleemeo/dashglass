import { useMemo, useState } from "react";

import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Flex,
  Input,
  Portal,
  Tabs,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { useNavigate } from "react-router";

import { importGrafanaDashboard } from "@polarisui/grafana-import";
import {
  dashboardSchema,
  stringifyDashboard,
  type Dashboard,
} from "@polarisui/model";

import {
  APIError,
  fetchGrafanaComDashboard,
  putDashboard,
} from "../api/client";
import { useCapabilities } from "../api/hooks";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Extracts the dashboard id from a grafana.com URL, or a plain id. */
function parseGrafanaComID(input: string): string | null {
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

interface DisplayFieldsProps {
  title: string;
  description: string;
  name: string;
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onName: (value: string) => void;
}

function DisplayFields({
  title,
  description,
  name,
  onTitle,
  onDescription,
  onName,
}: DisplayFieldsProps) {
  return (
    <>
      <Field.Root required>
        <Field.Label>
          Title <Field.RequiredIndicator />
        </Field.Label>
        <Input
          size="sm"
          placeholder="Node overview"
          value={title}
          onChange={(event) => onTitle(event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Description</Field.Label>
        <Input
          size="sm"
          value={description}
          onChange={(event) => onDescription(event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>File name</Field.Label>
        <Input
          size="sm"
          fontFamily="mono"
          value={name}
          onChange={(event) => onName(event.target.value)}
        />
        <Field.HelperText>
          The dashboard's identifier in the dashboards directory.
        </Field.HelperText>
      </Field.Root>
    </>
  );
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
 * Dashboard creation: start blank, or import from Grafana (marketplace id
 * or URL through the backend proxy, a JSON export file, or pasted JSON).
 * Title/description/file-name are editable in both paths before saving.
 */
export function NewDashboardDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const capabilities = useCapabilities();
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

  // Import path: prefill display fields from the conversion unless the
  // user already touched them.
  const imported = preview.state === "ready" ? preview.dashboard : null;
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
      if (!displayEdited) {
        if (result.name) {
          setTitle(result.name);
        }
        if (result.description) {
          setDescription(result.description.trim().split("\n")[0] ?? "");
        }
        setDisplayEdited(true);
      }
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
      );
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

  const createBlank = () => {
    if (effectiveTitle.trim() === "" || effectiveName === "") {
      setError("A title is required.");
      return;
    }
    try {
      const dashboard = blankDashboard(
        effectiveName,
        effectiveTitle.trim(),
        effectiveDescription.trim(),
      );
      void save(dashboard, `/d/${encodeURIComponent(effectiveName)}/edit`);
    } catch (buildError) {
      setError(String(buildError));
    }
  };

  const importGrafana = () => {
    if (!imported || effectiveName === "") {
      return;
    }
    const dashboard: Dashboard = {
      ...imported,
      metadata: { name: effectiveName },
      spec: {
        ...imported.spec,
        display: {
          ...(effectiveTitle.trim() !== "" ? { name: effectiveTitle.trim() } : {}),
          ...(effectiveDescription.trim() !== ""
            ? { description: effectiveDescription.trim() }
            : {}),
        },
      },
    };
    void save(dashboard, `/d/${encodeURIComponent(effectiveName)}`);
  };

  const pickFile = (file: File | undefined) => {
    if (!file) {
      return;
    }
    void file.text().then(setJson);
  };

  const displayFields = (
    <DisplayFields
      title={effectiveTitle}
      description={effectiveDescription}
      name={effectiveName}
      onTitle={(value) => {
        setTitle(value);
        setDisplayEdited(true);
      }}
      onDescription={(value) => {
        setDescription(value);
        setDisplayEdited(true);
      }}
      onName={(value) => {
        setName(slugify(value) === value ? value : slugify(value));
        setNameEdited(true);
      }}
    />
  );

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
              <Tabs.Root defaultValue="blank" size="sm">
                <Tabs.List marginBottom={4}>
                  <Tabs.Trigger value="blank">Blank</Tabs.Trigger>
                  <Tabs.Trigger value="grafana">
                    Import from Grafana
                  </Tabs.Trigger>
                </Tabs.List>

                <Tabs.Content value="blank">
                  <Flex direction="column" gap={3}>
                    {displayFields}
                    <Button
                      size="sm"
                      alignSelf="flex-end"
                      loading={saving}
                      disabled={effectiveTitle.trim() === ""}
                      onClick={createBlank}
                    >
                      Create and edit
                    </Button>
                  </Flex>
                </Tabs.Content>

                <Tabs.Content value="grafana">
                  <Flex direction="column" gap={3}>
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
                        onChange={(event) => pickFile(event.target.files?.[0])}
                      />
                      <Textarea
                        fontFamily="mono"
                        fontSize="xs"
                        rows={5}
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
                              <Text key={index} fontSize="xs" color="fg.muted">
                                • {warning}
                              </Text>
                            ))}
                          </Flex>
                        ) : null}
                        {displayFields}
                        <Button
                          size="sm"
                          alignSelf="flex-end"
                          loading={saving}
                          disabled={effectiveName === ""}
                          onClick={importGrafana}
                        >
                          Import
                        </Button>
                      </>
                    ) : null}
                  </Flex>
                </Tabs.Content>
              </Tabs.Root>

              {error ? (
                <Text
                  fontSize="sm"
                  color="fg.error"
                  whiteSpace="pre-wrap"
                  marginTop={3}
                >
                  {error}
                </Text>
              ) : null}
            </Dialog.Body>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
