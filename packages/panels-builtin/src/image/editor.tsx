import type { PanelSpecEditorProps } from "@dashglass/runtime";

import { SelectField, TextField, withSpecValue } from "../editor/controls";
import { parseSpec } from "../spec";
import { imageSpecSchema } from "./options";

export function ImageEditor({ spec: rawSpec, onChange }: PanelSpecEditorProps) {
  const spec = parseSpec(imageSpecSchema, rawSpec);
  return (
    <div className="dashglass-fields">
      <TextField
        label="Image URL"
        value={spec.url ?? ""}
        placeholder="https://example.com/logo.svg"
        onChange={(url) => onChange(withSpecValue(rawSpec, "url", url))}
      />
      <TextField
        label="Alt text"
        value={spec.alt ?? ""}
        onChange={(alt) => onChange(withSpecValue(rawSpec, "alt", alt))}
      />
      <SelectField
        label="Fit"
        value={spec.fit ?? ""}
        options={[
          ["", "contain (default)"],
          ["cover", "cover (crop)"],
          ["fill", "fill (stretch)"],
        ]}
        onChange={(fit) => onChange(withSpecValue(rawSpec, "fit", fit))}
      />
    </div>
  );
}
