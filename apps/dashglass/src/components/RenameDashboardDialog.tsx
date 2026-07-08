import { useState } from "react";

import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Input,
  Portal,
} from "@chakra-ui/react";
import { useQueryClient } from "@tanstack/react-query";

import { parseDashboard, stringifyDashboard } from "@dashglass/model";

import {
  deleteDashboard,
  getDashboardFile,
  putDashboard,
} from "../api/client";
import { useDashboards } from "../api/hooks";
import { toaster } from "./toaster";

/** Slug per path segment: one "/" is allowed (folder/name). */
function slugifyName(text: string): string {
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

/**
 * Renames a dashboard file: read → create-only PUT under the new name
 * (with metadata.name rewritten to match) → delete the old file. The
 * content goes through the canonical serializer, so hand-written files
 * come out normalized — which is what saving from the UI does anyway.
 */
export function RenameDashboardDialog({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}) {
  const dashboards = useDashboards();
  const queryClient = useQueryClient();
  const [input, setInput] = useState(name);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = slugifyName(input);
  const taken =
    target !== name &&
    (dashboards.data?.some((info) => info.name === target) ?? false);

  const rename = async () => {
    if (target === "" || target === name || taken) {
      return;
    }
    setRenaming(true);
    setError(null);
    try {
      const file = await getDashboardFile(name);
      const dashboard = parseDashboard(file.content, file.format);
      const renamed = {
        ...dashboard,
        // With a folder ("infra/db"), metadata.name stays the base name.
        metadata: { ...dashboard.metadata, name: target.split("/").at(-1)! },
      };
      await putDashboard(
        target,
        stringifyDashboard(renamed, file.format),
        file.format,
        { createOnly: true },
      );
      await deleteDashboard(name);
      void queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      toaster.create({
        title: `Renamed to "${target}"`,
        type: "success",
      });
      onClose();
    } catch (renameError) {
      setError(String(renameError));
      setRenaming(false);
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
              <Dialog.Title>Rename "{name}"</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void rename();
                }}
              >
                <Field.Root invalid={taken || error !== null}>
                  <Field.Label>New file name</Field.Label>
                  <Input
                    size="sm"
                    fontFamily="mono"
                    autoFocus
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                  />
                  {taken ? (
                    <Field.ErrorText>
                      A dashboard named "{target}" already exists.
                    </Field.ErrorText>
                  ) : error ? (
                    <Field.ErrorText>{error}</Field.ErrorText>
                  ) : (
                    <Field.HelperText>
                      {target !== "" && target !== input
                        ? `Will be saved as "${target}". `
                        : ""}
                      Links and bookmarks using the old name will break.
                    </Field.HelperText>
                  )}
                </Field.Root>
              </form>
            </Dialog.Body>
            <Dialog.Footer>
              <Button size="sm" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                colorPalette="brand"
                loading={renaming}
                disabled={target === "" || target === name || taken}
                onClick={() => void rename()}
              >
                Rename
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
