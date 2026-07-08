import type { PanelSpecEditorProps } from "@dashglass/runtime";

import { Field, withSpecValue } from "../editor/controls";
import { parseSpec } from "../spec";
import { markdownSpecSchema } from "./options";

export function MarkdownEditor({
  spec: rawSpec,
  onChange,
}: PanelSpecEditorProps) {
  const spec = parseSpec(markdownSpecSchema, rawSpec);

  return (
    <div className="dashglass-fields">
      <Field label="Content (Markdown)">
        {(id) => (
          <textarea
            id={id}
            className="dashglass-field-input"
            rows={10}
            value={spec.content ?? ""}
            onChange={(event) =>
              onChange(withSpecValue(rawSpec, "content", event.target.value))
            }
          />
        )}
      </Field>
    </div>
  );
}
