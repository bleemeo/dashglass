import { useMemo, useState } from "react";

import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Flex,
  Input,
  Portal,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { useNavigate } from "react-router";

import { importGrafanaDashboard } from "@polarisui/grafana-import";
import { stringifyDashboard, type Dashboard } from "@polarisui/model";

import { APIError, putDashboard } from "../api/client";

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
 * Best-effort Grafana import: paste (or pick) the dashboard JSON, review
 * what will be approximated, save through the regular validating API and
 * land in the visual editor to fix up the rest.
 */
export function ImportGrafanaDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [json, setJson] = useState("");
  const [name, setName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const preview = useMemo(() => convert(json), [json]);
  const effectiveName =
    name.trim() !== ""
      ? name.trim()
      : preview.state === "ready"
        ? preview.dashboard.metadata.name
        : "";

  const importNow = async () => {
    if (preview.state !== "ready" || effectiveName === "") {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const dashboard: Dashboard = {
        ...preview.dashboard,
        metadata: { name: effectiveName },
      };
      await putDashboard(
        effectiveName,
        stringifyDashboard(dashboard, "yaml"),
        "yaml",
      );
      onClose();
      void navigate(`/d/${encodeURIComponent(effectiveName)}`);
    } catch (error) {
      setSaveError(
        error instanceof APIError
          ? [error.message, ...error.issues].join("\n")
          : String(error),
      );
    } finally {
      setSaving(false);
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
              <Dialog.Title>Import a Grafana dashboard</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Flex direction="column" gap={3}>
                <Field.Root>
                  <Field.Label>
                    Dashboard JSON (Share → Export in Grafana)
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
                    rows={8}
                    placeholder='{"title": "...", "panels": [...] }'
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
                    <Field.Root>
                      <Field.Label>Save as</Field.Label>
                      <Input
                        size="sm"
                        value={effectiveName}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </Field.Root>
                    <Text fontSize="sm">
                      {Object.keys(preview.dashboard.spec.panels).length}{" "}
                      panels, {preview.dashboard.spec.layouts.length} sections,{" "}
                      {preview.dashboard.spec.variables?.length ?? 0} variables.
                    </Text>
                    {preview.warnings.length > 0 ? (
                      <Flex
                        direction="column"
                        gap={1}
                        maxHeight="150px"
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
                  </>
                ) : null}

                {saveError ? (
                  <Text fontSize="sm" color="fg.error" whiteSpace="pre-wrap">
                    {saveError}
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
                disabled={preview.state !== "ready" || effectiveName === ""}
                loading={saving}
                onClick={() => void importNow()}
              >
                Import
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
