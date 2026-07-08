import { Suspense, lazy } from "react";

import { Text } from "@chakra-ui/react";

import type { PromQLEditorProps } from "@dashglass/promql-editor";
import { useColorMode } from "@dashglass/ui";

/**
 * Code-split PromQL editor: CodeMirror and the PromQL language support
 * only load when a page actually shows an editor. The app's resolved
 * color mode drives the CodeMirror theme.
 */
const Editor = lazy(() =>
  import("@dashglass/promql-editor").then((module) => ({
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
