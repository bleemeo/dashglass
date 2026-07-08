import { useId, type ReactNode } from "react";

/**
 * Plain-HTML form controls for the plugin option editors. Like the panel
 * chrome, they are structure-only (`dashglass-field*` class names); the host
 * theme (packages/ui) provides the visual identity, and the package stays
 * free of any UI-framework dependency.
 */

export function Field({
  label,
  children,
}: {
  label: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="dashglass-field">
      <label className="dashglass-field-label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

export function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          className="dashglass-field-input"
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  /** [value, label] pairs; the empty value renders as "default". */
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <select
          id={id}
          className="dashglass-field-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map(([optionValue, optionLabel]) => (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number | undefined;
  /** undefined = field cleared → the spec key is omitted. */
  onChange: (value: number | undefined) => void;
  step?: number;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          className="dashglass-field-input"
          type="number"
          step={step ?? "any"}
          value={value ?? ""}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(raw === "" ? undefined : Number(raw));
          }}
        />
      )}
    </Field>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="dashglass-field dashglass-field-inline">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label className="dashglass-field-label" htmlFor={id}>
        {label}
      </label>
    </div>
  );
}

/** Labels for the shared unit enum (units.ts unitSchema). */
export const UNIT_OPTIONS = [
  ["", "default (none)"],
  ["short", "short (k/M/G)"],
  ["percent", "percent (0–100)"],
  ["percentunit", "percent (0–1)"],
  ["bytes", "bytes"],
  ["bytesps", "bytes/s"],
  ["bitsps", "bits/s"],
  ["ops", "rate (…/s)"],
  ["seconds", "seconds"],
  ["milliseconds", "milliseconds"],
  ["hertz", "hertz"],
  ["celsius", "°C"],
] as const;

/**
 * Returns `spec` with `key` set to `value`, or removed when the value is
 * the "default" sentinel (undefined, empty string, false). Keys are dropped
 * rather than written as defaults so saved files stay minimal
 * (serialization rule: defaults omitted).
 */
export function withSpecValue<Spec extends Record<string, unknown>>(
  spec: Spec,
  key: string,
  value: unknown,
): Spec {
  const next: Record<string, unknown> = { ...spec };
  if (value === undefined || value === "" || value === false) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next as Spec;
}
