import { useMemo } from "react";
import ReactMarkdown from "react-markdown";

import type { PanelProps } from "@dashglass/runtime";

import { parseSpec } from "../spec";
import { markdownSpecSchema } from "./options";

/**
 * A documentation panel: section intros, runbooks, links. No queries — the
 * panel ignores the data prop entirely.
 */
export function MarkdownPanel({ spec }: PanelProps) {
  const parsed = useMemo(() => parseSpec(markdownSpecSchema, spec), [spec]);

  return (
    <div className="dashglass-markdown">
      <ReactMarkdown>{parsed.content ?? ""}</ReactMarkdown>
    </div>
  );
}
