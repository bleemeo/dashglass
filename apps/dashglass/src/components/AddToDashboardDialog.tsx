import { useState } from "react";

import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Flex,
  Input,
  NativeSelect,
  Portal,
  Text,
} from "@chakra-ui/react";
import { useNavigate } from "react-router";

import {
  addLayout,
  addPanel,
  parseDashboard,
  stringifyDashboard,
  uniquePanelKey,
  type Panel,
} from "@dashglass/model";
import { PROMETHEUS_QUERY_KIND } from "@dashglass/runtime";

import { APIError, getDashboardFile, putDashboard } from "../api/client";
import { useDashboards } from "../api/hooks";
import { toaster } from "./toaster";

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug === "" ? "panel" : slug;
}

export interface AddToDashboardDialogProps {
  /** The PromQL expression to save as a panel. */
  query: string;
  onClose: () => void;
}

/** Explore → dashboard bridge: saves the current query as a new panel. */
export function AddToDashboardDialog({
  query,
  onClose,
}: AddToDashboardDialogProps) {
  const navigate = useNavigate();
  const dashboards = useDashboards();
  const targets = (dashboards.data ?? []).filter(
    (dashboard) => !dashboard.invalid,
  );

  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effectiveTarget = target || (targets[0]?.name ?? "");

  const add = async () => {
    if (effectiveTarget === "") {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const file = await getDashboardFile(effectiveTarget);
      let dashboard = parseDashboard(file.content, file.format);
      if (dashboard.spec.layouts.length === 0) {
        dashboard = addLayout(dashboard);
      }
      const panel: Panel = {
        kind: "Panel",
        spec: {
          ...(title.trim() !== ""
            ? { display: { name: title.trim() } }
            : {}),
          plugin: { kind: "TimeSeriesChart", spec: {} },
          queries: [
            {
              kind: "TimeSeriesQuery",
              spec: {
                plugin: { kind: PROMETHEUS_QUERY_KIND, spec: { query } },
              },
            },
          ],
        },
      };
      const key = uniquePanelKey(dashboard, slugify(title));
      dashboard = addPanel(
        dashboard,
        key,
        panel,
        dashboard.spec.layouts.length - 1,
      );
      await putDashboard(
        effectiveTarget,
        stringifyDashboard(dashboard, file.format),
        file.format,
      );
      toaster.create({
        title: `Panel added to "${effectiveTarget}"`,
        type: "success",
        action: {
          label: "Open",
          onClick: () =>
            void navigate(`/d/${encodeURIComponent(effectiveTarget)}`),
        },
      });
      onClose();
    } catch (addError) {
      setError(
        addError instanceof APIError
          ? [addError.message, ...addError.issues].join("\n")
          : String(addError),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root
      open
      size="sm"
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
              <Dialog.Title>Add to dashboard</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Flex direction="column" gap={3}>
                <Text
                  fontSize="xs"
                  fontFamily="mono"
                  color="fg.muted"
                  lineClamp={2}
                >
                  {query}
                </Text>
                <Field.Root>
                  <Field.Label>Dashboard</Field.Label>
                  <NativeSelect.Root size="sm">
                    <NativeSelect.Field
                      value={effectiveTarget}
                      onChange={(event) => setTarget(event.target.value)}
                    >
                      {targets.map((dashboard) => (
                        <option key={dashboard.name} value={dashboard.name}>
                          {dashboard.displayName || dashboard.name}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                  {targets.length === 0 ? (
                    <Field.HelperText>
                      No dashboard yet — create one first.
                    </Field.HelperText>
                  ) : null}
                </Field.Root>
                <Field.Root>
                  <Field.Label>Panel title</Field.Label>
                  <Input
                    size="sm"
                    placeholder="New panel"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </Field.Root>
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
                disabled={effectiveTarget === ""}
                loading={saving}
                onClick={() => void add()}
              >
                Add panel
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
