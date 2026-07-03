import type { PanelSpecEditorProps } from "@polarisui/runtime";

import { SelectField, UNIT_OPTIONS, withSpecValue } from "../editor/controls";
import { parseSpec } from "../spec";
import { tableSpecSchema } from "./TablePanel";

export function TableEditor({ spec: rawSpec, onChange }: PanelSpecEditorProps) {
  const spec = parseSpec(tableSpecSchema, rawSpec);

  return (
    <div className="polaris-fields">
      <SelectField
        label="Unit"
        value={spec.unit ?? ""}
        options={UNIT_OPTIONS}
        onChange={(unit) => onChange(withSpecValue(rawSpec, "unit", unit))}
      />
    </div>
  );
}
