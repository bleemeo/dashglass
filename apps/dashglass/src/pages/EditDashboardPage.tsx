import { useEffect, useRef, useState } from "react";

import { Button, Flex, Text } from "@chakra-ui/react";
import { useNavigate, useParams } from "react-router";

import { APIError, isNotFound } from "../api/client";
import { DashboardCodeEditor } from "../components/DashboardCodeEditor";
import { TopBar } from "../components/TopBar";
import { DashboardNotFound } from "../components/DashboardNotFound";
import { UnsavedChangesGuard } from "../components/UnsavedChangesGuard";
import { toaster } from "../components/toaster";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  useSaveShortcut,
  useUnsavedChangesWarning,
} from "../hooks/useShortcuts";
import {
  useCapabilities,
  useDashboardFile,
  usePermissions,
  useSaveDashboard,
} from "../api/hooks";

/**
 * Dashboards-as-code editing: the raw file, saved through the validating
 * API. The form-based panel editor comes later; this already gives full
 * control and shows exactly what lands in git.
 */
export function EditDashboardPage() {
  const { name = "" } = useParams();
  usePageTitle(name ? `${name} · code` : undefined);
  const navigate = useNavigate();
  const file = useDashboardFile(name);
  const save = useSaveDashboard(name);
  const capabilities = useCapabilities();
  const provisioned = capabilities.data?.readonly ?? false;
  // Also covers the viewer role: a deep link into the editor must not
  // offer work that Save will refuse with a 403.
  const { canEdit, loading: permissionsLoading } = usePermissions();
  const readonly = !permissionsLoading && !canEdit;

  const [content, setContent] = useState<string | null>(null);
  useEffect(() => {
    if (file.data && content === null) {
      setContent(file.data.content);
    }
  }, [file.data, content]);

  const dirty = content !== null && content !== (file.data?.content ?? null);
  // Lets the post-save navigation through the guard (`content` still
  // differs from the cached file until the refetch lands).
  const justSaved = useRef(false);
  const doSave = () => {
    if (readonly || content === null || !file.data || save.isPending) {
      return;
    }
    save.mutate(
      { content, format: file.data.format },
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

  if (file.isLoading) {
    return <Text>Loading…</Text>;
  }
  if (isNotFound(file.error)) {
    return <DashboardNotFound name={name} />;
  }
  if (file.error) {
    return <Text color="fg.error">{String(file.error)}</Text>;
  }

  const issues =
    save.error instanceof APIError ? save.error.issues : [];

  return (
    <Flex direction="column" gap={3} height="100%">
      <TopBar
        crumbs={[
          { label: "Dashboards", to: "/" },
          { label: name, to: `/d/${encodeURIComponent(name)}` },
          { label: `Code (${file.data?.format})` },
        ]}
        actions={
          <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigate(`/d/${encodeURIComponent(name)}`)}
          >
            Back
          </Button>
          <Button
            size="sm"
            colorPalette="brand"
            disabled={readonly || content === null || !dirty}
            loading={save.isPending}
            title="⌘S"
            onClick={doSave}
          >
            Save
          </Button>
          </>
        }
      />
      <UnsavedChangesGuard when={dirty} bypass={justSaved} />

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
            <Text key={issue} color="fg.error" fontSize="xs" fontFamily="mono">
              {issue}
            </Text>
          ))}
        </Flex>
      ) : null}

      <Flex direction="column" flex={1} minHeight="60vh">
        <DashboardCodeEditor
          value={content ?? ""}
          onChange={setContent}
          format={file.data?.format ?? "yaml"}
        />
      </Flex>
    </Flex>
  );
}
