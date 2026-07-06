import type { RefObject } from "react";

import { useBlocker } from "react-router";

import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Blocks in-app navigation (sidebar links, browser back/forward) while an
 * editor holds unsaved changes, with a confirm dialog to proceed. Tab
 * close/reload is covered separately by `useUnsavedChangesWarning`.
 */
export function UnsavedChangesGuard({
  when,
  bypass,
}: {
  when: boolean;
  /** Escape hatch for the editor's own post-save navigation: set
   * `bypass.current = true` right before `navigate()` — state updates
   * would not flush in time, a ref is read at block time. */
  bypass?: RefObject<boolean>;
}) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    return (
      when &&
      !(bypass?.current ?? false) &&
      currentLocation.pathname !== nextLocation.pathname
    );
  });

  if (blocker.state !== "blocked") {
    return null;
  }
  return (
    <ConfirmDialog
      title="Unsaved changes"
      message="This dashboard has unsaved changes. Leave and discard them?"
      confirmLabel="Discard"
      onConfirm={() => blocker.proceed()}
      onClose={() => blocker.reset()}
    />
  );
}
