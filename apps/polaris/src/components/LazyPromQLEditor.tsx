import { Suspense, lazy } from "react";

import { Text } from "@chakra-ui/react";

import type { PromQLEditorProps } from "@polarisui/promql-editor";
import { useColorMode } from "@polarisui/ui";

/**
 * Code-split PromQL editor: CodeMirror and the PromQL language support
 * only load when a page actually shows an editor. The app's resolved
 * color mode drives the CodeMirror theme.
 */
const Editor = lazy(() =>
  import("@polarisui/promql-editor").then((module) => ({
    default: module.PromQLEditor,
  })),
);

export function LazyPromQLEditor(props: Omit<PromQLEditorProps, "theme">) {
  const { resolved } = useColorMode();
  return (
    <Suspense
      fallback={
        <Text fontSize="sm" color="fg.muted">
          Loading editor…
        </Text>
      }
    >
      <Editor {...props} theme={resolved} />
    </Suspense>
  );
}
