import type { PanelSpecEditorProps } from "@dashglass/runtime";

import {
  CheckboxField,
  NumberField,
  SelectField,
  UNIT_OPTIONS,
  withSpecValue,
} from "../editor/controls";
import { ThresholdsEditor } from "../editor/ThresholdsEditor";
import { parseSpec } from "../spec";
import { statSpecSchema } from "./StatChart";

export function StatEditor({ spec: rawSpec, onChange }: PanelSpecEditorProps) {
  const spec = parseSpec(statSpecSchema, rawSpec);

  return (
    <div className="dashglass-fields">
      <SelectField
        label="Unit"
        value={spec.unit ?? ""}
        options={UNIT_OPTIONS}
        onChange={(unit) => onChange(withSpecValue(rawSpec, "unit", unit))}
      />
      <SelectField
        label="Calculation"
        value={spec.calculation ?? ""}
        options={[
          ["", "last (default)"],
          ["mean", "mean"],
          ["min", "min"],
          ["max", "max"],
          ["sum", "sum"],
        ]}
        onChange={(calculation) =>
          onChange(withSpecValue(rawSpec, "calculation", calculation))
        }
      />
      <NumberField
        label="Decimals"
        value={spec.decimals}
        step={1}
        onChange={(decimals) =>
          onChange(withSpecValue(rawSpec, "decimals", decimals))
        }
      />
      <CheckboxField
        label="Sparkline"
        checked={spec.sparkline ?? false}
        onChange={(sparkline) =>
          onChange(withSpecValue(rawSpec, "sparkline", sparkline))
        }
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
