import type { PanelSpecEditorProps } from "@polarisui/runtime";

import {
  Field,
  NumberField,
  SelectField,
  UNIT_OPTIONS,
  withSpecValue,
} from "../editor/controls";
import { parseSpec } from "../spec";
import { gaugeSpecSchema, type GaugeSpec } from "./options";

type Threshold = NonNullable<GaugeSpec["thresholds"]>[number];

function ThresholdsEditor({
  thresholds,
  onChange,
}: {
  thresholds: Threshold[];
  onChange: (thresholds: Threshold[] | undefined) => void;
}) {
  const update = (index: number, threshold: Threshold) =>
    onChange(thresholds.map((t, i) => (i === index ? threshold : t)));

  return (
    <Field label="Thresholds">
      {() => (
        <div className="polaris-threshold-rows">
          {thresholds.map((threshold, index) => (
            <div key={index} className="polaris-threshold-row">
              <input
                className="polaris-field-input"
                type="number"
                step="any"
                aria-label={`Threshold ${index + 1} value`}
                value={threshold.value}
                onChange={(event) =>
                  update(index, {
                    ...threshold,
                    value: Number(event.target.value),
                  })
                }
              />
              <select
                className="polaris-field-input"
                aria-label={`Threshold ${index + 1} status`}
                value={threshold.status}
                onChange={(event) =>
                  update(index, {
                    ...threshold,
                    status: event.target.value as Threshold["status"],
                  })
                }
              >
                <option value="warning">warning</option>
                <option value="serious">serious</option>
                <option value="critical">critical</option>
              </select>
              <button
                type="button"
                className="polaris-field-button"
                onClick={() => {
                  const next = thresholds.filter((_, i) => i !== index);
                  onChange(next.length > 0 ? next : undefined);
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="polaris-field-button"
            onClick={() =>
              onChange([
                ...thresholds,
                { value: thresholds.at(-1)?.value ?? 80, status: "warning" },
              ])
            }
          >
            Add threshold
          </button>
        </div>
      )}
    </Field>
  );
}

export function GaugeEditor({ spec: rawSpec, onChange }: PanelSpecEditorProps) {
  const spec = parseSpec(gaugeSpecSchema, rawSpec);

  return (
    <div className="polaris-fields">
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
