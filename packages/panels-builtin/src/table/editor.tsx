import type { PanelSpecEditorProps } from "@dashglass/runtime";

import { SelectField, UNIT_OPTIONS, withSpecValue } from "../editor/controls";
import { ThresholdsEditor } from "../editor/ThresholdsEditor";
import { parseSpec } from "../spec";
import { tableSpecSchema } from "./TablePanel";

export function TableEditor({ spec: rawSpec, onChange }: PanelSpecEditorProps) {
  const spec = parseSpec(tableSpecSchema, rawSpec);

  return (
    <div className="dashglass-fields">
      <SelectField
        label="Unit"
        value={spec.unit ?? ""}
        options={UNIT_OPTIONS}
        onChange={(unit) => onChange(withSpecValue(rawSpec, "unit", unit))}
      />
      <ThresholdsEditor
        thresholds={spec.thresholds ?? []}
        onChange={(thresholds) =>
          onChange(withSpecValue(rawSpec, "thresholds", thresholds))
        }
      />
    </div>
  );
}
