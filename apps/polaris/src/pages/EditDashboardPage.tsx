import { useEffect, useState } from "react";

import { Button, Flex, Heading, Text, Textarea } from "@chakra-ui/react";
import { Link, useNavigate, useParams } from "react-router";

import { APIError } from "../api/client";
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

  if (file.isLoading) {
    return <Text>Loading…</Text>;
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
          <Button size="sm" variant="outline" asChild>
            <Link to={`/d/${encodeURIComponent(name)}`}>Back</Link>
          </Button>
          <Button
            size="sm"
            disabled={readonly || content === null}
            loading={save.isPending}
            onClick={() => {
              if (content !== null && file.data) {
                save.mutate(
                  { content, format: file.data.format },
                  {
                    onSuccess: () =>
                      navigate(`/d/${encodeURIComponent(name)}`),
                  },
                );
              }
            }}
          >
            Save
          </Button>
        </Flex>
      </Flex>

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
