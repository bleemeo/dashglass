import type { PanelSpecEditorProps } from "@dashglass/runtime";

import {
  SelectField,
  UNIT_OPTIONS,
  withSpecValue,
} from "../editor/controls";
import { parseSpec } from "../spec";
import { barSpecSchema } from "./options";

export function BarEditor({ spec: rawSpec, onChange }: PanelSpecEditorProps) {
  const spec = parseSpec(barSpecSchema, rawSpec);

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
      <SelectField
        label="Orientation"
        value={spec.orientation ?? ""}
        options={[
          ["", "horizontal (default)"],
          ["vertical", "vertical"],
        ]}
        onChange={(orientation) =>
          onChange(withSpecValue(rawSpec, "orientation", orientation))
        }
      />
      <SelectField
        label="Sort"
        value={spec.sort ?? ""}
        options={[
          ["", "descending (default)"],
          ["asc", "ascending"],
          ["none", "query order"],
        ]}
        onChange={(sort) => onChange(withSpecValue(rawSpec, "sort", sort))}
      />
    </div>
  );
}
