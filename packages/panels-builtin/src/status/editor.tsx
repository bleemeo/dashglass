import type { PanelSpecEditorProps } from "@dashglass/runtime";

import { NumberField, SelectField, TextField, withSpecValue } from "../editor/controls";
import { parseSpec } from "../spec";
import { STATUS_PRESETS, statusSpecSchema } from "./options";

/** Name of the preset matching the current mappings, or "" (custom). */
function currentPreset(mappings: unknown): string {
  const json = JSON.stringify(mappings);
  for (const [name, preset] of Object.entries(STATUS_PRESETS)) {
    if (JSON.stringify(preset) === json) {
      return name;
    }
  }
  return "";
}

export function StatusEditor({ spec: rawSpec, onChange }: PanelSpecEditorProps) {
  const spec = parseSpec(statusSpecSchema, rawSpec);

  return (
    <div className="dashglass-fields">
      <SelectField
        label="Value mapping"
        value={currentPreset(spec.valueMappings)}
        options={[
          ["", "Custom (edit as code)"],
          ["nagios", "Status codes — 0=OK (Nagios, Glouton _status)"],
          ["boolean", "Boolean up/down — 1=up"],
        ]}
        onChange={(preset) =>
          preset
            ? onChange(withSpecValue(rawSpec, "valueMappings", STATUS_PRESETS[preset]))
            : undefined
        }
      />
      <SelectField
        label="Reduce each series by"
        value={spec.calculation ?? ""}
        options={[
          ["", "last (default)"],
          ["min", "min"],
          ["max", "max"],
          ["mean", "mean"],
        ]}
        onChange={(calculation) =>
          onChange(withSpecValue(rawSpec, "calculation", calculation))
        }
      />
      <TextField
        label="Name label"
        value={spec.nameLabel ?? ""}
        placeholder="instance, service…"
        onChange={(nameLabel) =>
          onChange(withSpecValue(rawSpec, "nameLabel", nameLabel))
        }
      />
      <SelectField
        label="Tile order"
        value={spec.sort ?? ""}
        options={[
          ["", "Worst first (default)"],
          ["none", "Query order"],
        ]}
        onChange={(sort) => onChange(withSpecValue(rawSpec, "sort", sort))}
      />
      <NumberField
        label="Tiles per row"
        value={spec.columns}
        step={1}
        onChange={(columns) =>
          onChange(withSpecValue(rawSpec, "columns", columns))
        }
      />
      <NumberField
        label="Max tiles (empty = all)"
        value={spec.maxTiles}
        step={1}
        onChange={(maxTiles) =>
          onChange(withSpecValue(rawSpec, "maxTiles", maxTiles))
        }
      />
    </div>
  );
}
