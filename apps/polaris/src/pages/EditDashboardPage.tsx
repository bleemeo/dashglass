import { useEffect, useRef, useState } from "react";

import { Button, Flex, Heading, Text, Textarea } from "@chakra-ui/react";
import { useNavigate, useParams } from "react-router";

import { APIError, isNotFound } from "../api/client";
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
  const readonly = capabilities.data?.readonly ?? false;

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
      <Flex justifyContent="space-between" alignItems="center">
        <Heading size="lg">
          {name}{" "}
          <Text as="span" fontSize="sm" color="fg.muted">
            ({file.data?.format})
          </Text>
        </Heading>
        <Flex gap={2}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigate(`/d/${encodeURIComponent(name)}`)}
          >
            Back
          </Button>
          <Button
            size="sm"
            disabled={readonly || content === null || !dirty}
            loading={save.isPending}
            title="⌘S"
            onClick={doSave}
          >
            Save
          </Button>
        </Flex>
      </Flex>
      <UnsavedChangesGuard when={dirty} bypass={justSaved} />

      {readonly ? (
        <Text fontSize="sm" color="fg.muted">
          Dashboards are provisioned read-only on this instance — edit the
          file in git instead.
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

      <Textarea
        value={content ?? ""}
        onChange={(event) => setContent(event.target.value)}
        fontFamily="mono"
        fontSize="xs"
        flex={1}
        minHeight="60vh"
        spellCheck={false}
      />
    </Flex>
  );
}
