import type { Threshold } from "../thresholds";
import { Field } from "./controls";

/** Threshold rows (value + status) shared by the gauge and stat editors. */
export function ThresholdsEditor({
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
        <div className="dashglass-threshold-rows">
          {thresholds.map((threshold, index) => (
            <div key={index} className="dashglass-threshold-row">
              <input
                className="dashglass-field-input"
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
                className="dashglass-field-input"
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
                className="dashglass-field-button"
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
            className="dashglass-field-button"
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
