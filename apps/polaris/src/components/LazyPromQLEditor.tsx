import { Suspense, lazy } from "react";

import { Text } from "@chakra-ui/react";

import type { PromQLEditorProps } from "@polarisui/promql-editor";

/**
 * Code-split PromQL editor: CodeMirror and the PromQL language support
 * only load when a page actually shows an editor.
 */
const Editor = lazy(() =>
  import("@polarisui/promql-editor").then((module) => ({
    default: module.PromQLEditor,
  })),
);

export function LazyPromQLEditor(props: PromQLEditorProps) {
  return (
    <Suspense
      fallback={
        <Text fontSize="sm" color="fg.muted">
          Loading editor…
        </Text>
      }
    >
      <Editor {...props} />
    </Suspense>
  );
}
