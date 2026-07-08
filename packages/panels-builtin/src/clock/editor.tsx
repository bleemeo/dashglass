import type { PanelSpecEditorProps } from "@dashglass/runtime";

import {
  CheckboxField,
  NumberField,
  SelectField,
  withSpecValue,
} from "../editor/controls";
import { parseSpec } from "../spec";
import { clockSpecSchema } from "./options";

export function ClockEditor({ spec: rawSpec, onChange }: PanelSpecEditorProps) {
  const spec = parseSpec(clockSpecSchema, rawSpec);
  return (
    <div className="dashglass-fields">
      <SelectField
        label="Format"
        value={spec.format ?? ""}
        options={[
          ["", "Time — HH:mm:ss (default)"],
          ["time", "Time — HH:mm"],
          ["datetime", "Date & time"],
          ["date", "Date — short"],
          ["date-long", "Date — long"],
          ["iso", "ISO 8601 (UTC)"],
        ]}
        onChange={(format) => onChange(withSpecValue(rawSpec, "format", format))}
      />
      <NumberField
        label="Font size (px, auto if empty)"
        value={spec.fontSize}
        step={1}
        onChange={(fontSize) =>
          onChange(withSpecValue(rawSpec, "fontSize", fontSize))
        }
      />
      <CheckboxField
        label="Use UTC"
        checked={spec.utc ?? false}
        onChange={(utc) => onChange(withSpecValue(rawSpec, "utc", utc))}
      />
    </div>
  );
}
