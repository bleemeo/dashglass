import { useEffect } from "react";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/** Cmd-S / Ctrl-S. Fires everywhere on the page, including inside inputs. */
export function useSaveShortcut(onSave: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSave]);
}

/**
 * Cmd-Z / Ctrl-Z and Shift-Cmd-Z / Ctrl-Y. Ignored while typing, so text
 * fields keep their native undo.
 */
export function useUndoRedoShortcuts(
  onUndo: () => void,
  onRedo: () => void,
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || isTypingTarget(event.target)) {
        return;
      }
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        (event.shiftKey ? onRedo : onUndo)();
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        onRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onUndo, onRedo]);
}

/**
 * A single bare key (e.g. "e"), ignored while typing or with modifiers.
 */
export function useKeyShortcut(key: string, onTrigger: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === key &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault();
        onTrigger();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, onTrigger]);
}

/**
 * Warns before the tab closes while there are unsaved changes. In-app
 * navigation (sidebar links, browser back/forward) is guarded by
 * `UnsavedChangesGuard`; this covers close/reload, where the native
 * prompt is the only mechanism browsers allow.
 */
export function useUnsavedChangesWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
