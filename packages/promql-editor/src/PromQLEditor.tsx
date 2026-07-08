import { useMemo } from "react";

import { Prec } from "@codemirror/state";
import { keymap, EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";

import { buildPromQLExtension } from "./extension";

export interface PromQLEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Called on Mod-Enter (run the query). */
  onExecute?: () => void;
  /** Base URL for live autocompletion; see buildPromQLExtension. */
  completeURL?: string;
  fetchFn?: typeof fetch;
  readOnly?: boolean;
  placeholder?: string;
  /** Editor color theme; pass the host's resolved color mode. */
  theme?: "light" | "dark";
}

export function PromQLEditor({
  value,
  onChange,
  onExecute,
  completeURL,
  fetchFn,
  readOnly,
  placeholder,
  theme,
}: PromQLEditorProps) {
  const extensions = useMemo(() => {
    const list = [
      buildPromQLExtension({ completeURL, fetchFn }),
      EditorView.lineWrapping,
    ];
    if (onExecute) {
      list.push(
        // High precedence so Mod-Enter beats the default newline binding.
        Prec.highest(
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                onExecute();
                return true;
              },
            },
          ]),
        ),
      );
    }
    return list;
  }, [completeURL, fetchFn, onExecute]);

  return (
    <CodeMirror
      className="dashglass-promql-editor"
      value={value}
      onChange={onChange}
      theme={theme ?? "light"}
      extensions={extensions}
      readOnly={readOnly ?? false}
      placeholder={placeholder ?? "PromQL expression"}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
    />
  );
}
