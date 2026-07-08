import { useState } from "react";

import {
  CloseButton,
  Dialog,
  Flex,
  Kbd,
  Portal,
  Text,
} from "@chakra-ui/react";

import { useKeyShortcut } from "../hooks/useShortcuts";

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["?"], label: "Show this help" },
  { keys: ["e"], label: "Edit the dashboard" },
  { keys: ["/"], label: "Focus the dashboards filter" },
  { keys: ["Esc"], label: "Close a fullscreen panel, then exit kiosk" },
  { keys: ["⌘", "S"], label: "Save (in the editors)" },
  { keys: ["⌘", "Z"], label: "Undo (visual editor)" },
  { keys: ["⇧", "⌘", "Z"], label: "Redo (visual editor)" },
  { keys: ["⌘", "⏎"], label: "Run the query (Explore, panel editor)" },
];

/** `?` opens a modal listing the app's keyboard shortcuts. */
export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  useKeyShortcut("?", () => setOpen(true));

  if (!open) {
    return null;
  }
  return (
    <Dialog.Root
      open
      size="sm"
      onOpenChange={(event) => {
        if (!event.open) {
          setOpen(false);
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Keyboard shortcuts</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Flex direction="column" gap={2}>
                {SHORTCUTS.map((shortcut) => (
                  <Flex
                    key={shortcut.label}
                    alignItems="center"
                    justifyContent="space-between"
                    gap={4}
                  >
                    <Text fontSize="sm">{shortcut.label}</Text>
                    <Flex gap={1} flexShrink={0}>
                      {shortcut.keys.map((key, index) => (
                        <Kbd key={index}>{key}</Kbd>
                      ))}
                    </Flex>
                  </Flex>
                ))}
              </Flex>
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
