import { Suspense, lazy, useMemo } from "react";

import { Text } from "@chakra-ui/react";

import { useColorMode } from "@dashglass/ui";

import type { DashboardFile } from "../api/client";

/**
 * Code-split dashboard file editor (CodeMirror): syntax highlighting,
 * line numbers and sane Tab behavior for the as-code page. The chunk
 * only loads when the page is opened.
 */
const Editor = lazy(async () => {
  const [{ default: CodeMirror }, { indentWithTab }, { keymap, EditorView }] =
    await Promise.all([
      import("@uiw/react-codemirror"),
      import("@codemirror/commands"),
      import("@codemirror/view"),
    ]);

  async function languageFor(format: DashboardFile["format"]) {
    if (format === "json") {
      const { json } = await import("@codemirror/lang-json");
      return json();
    }
    if (format === "toml") {
      const [{ StreamLanguage }, { toml }] = await Promise.all([
        import("@codemirror/language"),
        import("@codemirror/legacy-modes/mode/toml"),
      ]);
      return StreamLanguage.define(toml);
    }
    const { yaml } = await import("@codemirror/lang-yaml");
    return yaml();
  }

  // Languages are tiny compared to CodeMirror itself: load all three up
  // front so the component stays synchronous per render.
  const [yamlLang, jsonLang, tomlLang] = await Promise.all([
    languageFor("yaml"),
    languageFor("json"),
    languageFor("toml"),
  ]);
  const languages = { yaml: yamlLang, json: jsonLang, toml: tomlLang };

  function DashboardCodeMirror({
    value,
    onChange,
    format,
    theme,
  }: {
    value: string;
    onChange: (value: string) => void;
    format: DashboardFile["format"];
    theme: "light" | "dark";
  }) {
    const extensions = useMemo(
      () => [
        languages[format],
        keymap.of([indentWithTab]),
        EditorView.lineWrapping,
      ],
      [format],
    );
    return (
      <CodeMirror
        className="dashglass-code-editor"
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={theme}
        height="100%"
        style={{ flex: 1, minHeight: 0, fontSize: "12px" }}
      />
    );
  }
  return { default: DashboardCodeMirror };
});

export function DashboardCodeEditor(props: {
  value: string;
  onChange: (value: string) => void;
  format: DashboardFile["format"];
}) {
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
