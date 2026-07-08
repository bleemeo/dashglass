import { useState } from "react";

import {
  Box,
  Button,
  Drawer,
  Flex,
  Portal,
  Spinner,
  Text,
} from "@chakra-ui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getHistoryDiff,
  getHistoryVersion,
  putDashboard,
  type HistoryCommit,
} from "../api/client";
import { useDashboardHistory, usePermissions } from "../api/hooks";
import { classifyDiffLine, type DiffLineKind } from "../lib/diff";
import { relativeTime } from "../lib/relativeTime";
import { toaster } from "./toaster";

const DIFF_STYLES: Record<DiffLineKind, { color: string; background?: string }> =
  {
    add: { color: "green.fg", background: "green.subtle" },
    del: { color: "red.fg", background: "red.subtle" },
    hunk: { color: "fg.info" },
    meta: { color: "fg.muted" },
    context: { color: "fg" },
  };

/** Colored unified-diff view (git output rendered line by line). */
function DiffView({ diff }: { diff: string }) {
  if (diff.trim() === "") {
    return (
      <Text fontSize="sm" color="fg.muted" paddingY={2}>
        No changes — the file matches this version.
      </Text>
    );
  }
  return (
    <Box
      as="pre"
      fontSize="xs"
      fontFamily="mono"
      overflowX="auto"
      borderWidth="1px"
      borderColor="border"
      borderRadius="sm"
      paddingY={1}
    >
      {diff.replace(/\n$/, "").split("\n").map((line, index) => {
        const kind = classifyDiffLine(line);
        const style = DIFF_STYLES[kind];
        return (
          <Box
            key={index}
            paddingX={2}
            color={style.color}
            backgroundColor={style.background}
            whiteSpace="pre"
          >
            {line || " "}
          </Box>
        );
      })}
    </Box>
  );
}

function CommitEntry({
  name,
  commit,
  isLatest,
  canEdit,
  onRestored,
}: {
  name: string;
  commit: HistoryCommit;
  isLatest: boolean;
  canEdit: boolean;
  onRestored: () => void;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Diff from this commit to the current file: "what changed since".
  const diff = useQuery({
    queryKey: ["dashboards", name, "history", commit.hash, "diff"],
    queryFn: () => getHistoryDiff(name, commit.hash),
    enabled: expanded,
  });

  // Restore = fetch the old content, PUT it as the current file. Git
  // stays untouched: committing the restore is the user's (or the GitOps
  // pipeline's) call, like any other edit.
  const restore = async () => {
    setRestoring(true);
    try {
      const version = await getHistoryVersion(name, commit.hash);
      await putDashboard(name, version.content, version.format, {
        commitMessage: `Restore dashboard ${name} to ${commit.hash.slice(0, 7)}`,
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      toaster.create({
        type: "success",
        description: `Restored the version from ${commit.hash.slice(0, 7)} (uncommitted — review and commit it in git).`,
      });
      onRestored();
    } catch (error) {
      toaster.create({
        type: "error",
        description: error instanceof Error ? error.message : String(error),
        closable: true,
        duration: Number.POSITIVE_INFINITY,
      });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Box borderBottomWidth="1px" borderColor="border" paddingY={2}>
      <Flex
        as="button"
        width="100%"
        textAlign="left"
        gap={3}
        alignItems="baseline"
        onClick={() => setExpanded((current) => !current)}
        cursor="pointer"
      >
        <Text fontFamily="mono" fontSize="xs" color="fg.muted">
          {commit.hash.slice(0, 7)}
        </Text>
        <Box flex={1} minWidth={0}>
          <Text fontSize="sm" fontWeight="medium" lineClamp={1}>
            {commit.subject}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {commit.author} · {relativeTime(commit.date)}
            {isLatest ? " · latest" : ""}
          </Text>
        </Box>
      </Flex>
      {expanded ? (
        <Flex direction="column" gap={2} marginTop={2}>
          {diff.isPending ? (
            <Spinner size="sm" />
          ) : diff.isError ? (
            <Text fontSize="sm" color="fg.error">
              {diff.error instanceof Error
                ? diff.error.message
                : String(diff.error)}
            </Text>
          ) : (
            <>
              <Text fontSize="xs" color="fg.muted">
                Changes from this version to the current file:
              </Text>
              <DiffView diff={diff.data} />
            </>
          )}
          {canEdit && !(diff.isSuccess && diff.data.trim() === "") ? (
            <Button
              size="xs"
              variant="outline"
              colorPalette="brand"
              alignSelf="flex-start"
              loading={restoring}
              onClick={() => void restore()}
            >
              Restore this version
            </Button>
          ) : null}
        </Flex>
      ) : null}
    </Box>
  );
}

/**
 * The dashboard's git history: commits touching the file, each expandable
 * into a diff against the current file, with one-click restore (a regular
 * save — git itself is never written to).
 */
export function HistoryDrawer({
  name,
  open,
  onClose,
}: {
  name: string;
  open: boolean;
  onClose: () => void;
}) {
  const { canEdit } = usePermissions();
  const history = useDashboardHistory(name, open);

  return (
    <Drawer.Root
      open={open}
      size="md"
      onOpenChange={(event) => {
        if (!event.open) {
          onClose();
        }
      }}
    >
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content>
            <Drawer.Header>
              <Drawer.Title>History</Drawer.Title>
            </Drawer.Header>
            <Drawer.Body>
              {history.isPending ? (
                <Spinner size="sm" />
              ) : history.isError ? (
                <Text fontSize="sm" color="fg.error">
                  {history.error instanceof Error
                    ? history.error.message
                    : String(history.error)}
                </Text>
              ) : history.data.length === 0 ? (
                <Text fontSize="sm" color="fg.muted">
                  No commits touch this file yet. Commit it in the
                  dashboards repository to start its history.
                </Text>
              ) : (
                <Flex direction="column">
                  {history.data.map((commit, index) => (
                    <CommitEntry
                      key={commit.hash}
                      name={name}
                      commit={commit}
                      isLatest={index === 0}
                      canEdit={canEdit}
                      onRestored={onClose}
                    />
                  ))}
                </Flex>
              )}
            </Drawer.Body>
            <Drawer.CloseTrigger />
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}
