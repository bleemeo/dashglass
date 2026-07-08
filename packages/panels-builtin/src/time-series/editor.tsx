import type { PanelSpecEditorProps } from "@dashglass/runtime";

import {
  CheckboxField,
  NumberField,
  SelectField,
  UNIT_OPTIONS,
  withSpecValue,
} from "../editor/controls";
import { parseSpec } from "../spec";
import { timeSeriesSpecSchema } from "./options";

export function TimeSeriesEditor({
  spec: rawSpec,
  onChange,
}: PanelSpecEditorProps) {
  const spec = parseSpec(timeSeriesSpecSchema, rawSpec);

  return (
    <div className="dashglass-fields">
      <SelectField
        label="Unit"
        value={spec.unit ?? ""}
        options={UNIT_OPTIONS}
        onChange={(unit) => onChange(withSpecValue(rawSpec, "unit", unit))}
      />
      <SelectField
        label="Legend"
        value={spec.legend?.position ?? ""}
        options={[
          ["", "bottom (default)"],
          ["right", "right"],
          ["hidden", "hidden"],
        ]}
        onChange={(position) =>
          onChange(
            withSpecValue(
              rawSpec,
              "legend",
              position === "" ? undefined : { position },
            ),
          )
        }
      />
      <CheckboxField
        label="Stack series"
        checked={spec.stack ?? false}
        onChange={(stack) => onChange(withSpecValue(rawSpec, "stack", stack))}
      />
      <CheckboxField
        label="Fill area"
        checked={spec.area ?? false}
        onChange={(area) => onChange(withSpecValue(rawSpec, "area", area))}
      />
      <NumberField
        label="Y min"
        value={spec.min}
        onChange={(min) => onChange(withSpecValue(rawSpec, "min", min))}
      />
      <NumberField
        label="Y max"
        value={spec.max}
        onChange={(max) => onChange(withSpecValue(rawSpec, "max", max))}
      />
    </div>
  );
}
