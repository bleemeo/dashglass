import type { PanelSpecEditorProps } from "@dashglass/runtime";

import { SelectField, UNIT_OPTIONS, withSpecValue } from "../editor/controls";
import { parseSpec } from "../spec";
import { heatmapSpecSchema } from "./options";

export function HeatmapEditor({
  spec: rawSpec,
  onChange,
}: PanelSpecEditorProps) {
  const spec = parseSpec(heatmapSpecSchema, rawSpec);

  return (
    <div className="dashglass-fields">
      <SelectField
        label="Bucket unit"
        value={spec.unit ?? ""}
        options={UNIT_OPTIONS}
        onChange={(unit) => onChange(withSpecValue(rawSpec, "unit", unit))}
      />
    </div>
  );
}
