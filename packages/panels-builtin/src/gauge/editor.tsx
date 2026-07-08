import type { PanelSpecEditorProps } from "@dashglass/runtime";

import {
  NumberField,
  SelectField,
  UNIT_OPTIONS,
  withSpecValue,
} from "../editor/controls";
import { ThresholdsEditor } from "../editor/ThresholdsEditor";
import { parseSpec } from "../spec";
import { gaugeSpecSchema } from "./options";

export function GaugeEditor({ spec: rawSpec, onChange }: PanelSpecEditorProps) {
  const spec = parseSpec(gaugeSpecSchema, rawSpec);

  return (
    <div className="dashglass-fields">
      <SelectField
        label="Unit"
        value={spec.unit ?? ""}
        options={UNIT_OPTIONS}
        onChange={(unit) => onChange(withSpecValue(rawSpec, "unit", unit))}
      />
      <NumberField
        label="Min"
        value={spec.min}
        onChange={(min) => onChange(withSpecValue(rawSpec, "min", min))}
      />
      <NumberField
        label="Max"
        value={spec.max}
        onChange={(max) => onChange(withSpecValue(rawSpec, "max", max))}
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
