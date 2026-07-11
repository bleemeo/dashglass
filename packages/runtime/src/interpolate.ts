/** Values of dashboard variables, by name. */
export type VariableValues = Record<string, string | string[]>;

/**
 * Substitutes `$name` and `${name}` variable references in a string. Each
 * reference is resolved through `resolve`; a reference `resolve` returns
 * `undefined` for is left untouched (so an unknown `$foo` survives verbatim
 * rather than collapsing to an empty string). The two forms share this core
 * so PromQL and URL interpolation stay in step.
 */
function substitute(
  input: string,
  resolve: (name: string) => string | undefined,
): string {
  const replace = (match: string, name: string): string => {
    const value = resolve(name);
    return value === undefined ? match : value;
  };
  return input
    .replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, replace)
    .replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, replace);
}

/**
 * Escapes a literal label value for a regex that lives inside a
 * double-quoted PromQL string (`=~"…"`). Each metacharacter is prefixed
 * with a *double* backslash: PromQL decodes the quoted string first
 * (turning `\\` into `\`), leaving `\.` for the RE2 engine to match
 * literally. A single backslash would be an invalid string escape.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?()|[\]{}^$\\]/g, "\\\\$&");
}

function encodePromQL(value: string | string[]): string {
  // Multi-values render as a regex alternation, the PromQL idiom for
  // multi-select variables used with the =~ matcher. Each member is
  // escaped so a value like "10.0.0.1" or "a|b" matches literally, not
  // as a pattern. Single values are left verbatim: they may be used in
  // an exact (=) matcher where escaping would be wrong.
  return Array.isArray(value) ? value.map(escapeRegex).join("|") : value;
}

function encodeUrl(value: string | string[]): string {
  // URL contexts want each value percent-encoded; multi-values join with a
  // comma (the common `var-x=a,b` convention) rather than the PromQL `|`.
  return Array.isArray(value)
    ? value.map(encodeURIComponent).join(",")
    : encodeURIComponent(value);
}

/**
 * Substitutes dashboard variables in a PromQL expression: `$name` and
 * `${name}` forms.
 */
export function interpolate(input: string, values: VariableValues): string {
  return substitute(input, (name) => {
    const value = values[name];
    return value === undefined ? undefined : encodePromQL(value);
  });
}

/**
 * Substitutes dashboard variables in a URL (data links). Values are
 * percent-encoded so they are safe in a query string, and the time-range
 * tokens `$__from` / `$__to` (epoch milliseconds) are available alongside
 * the variables — pass them in `values` under those keys.
 */
export function interpolateUrl(input: string, values: VariableValues): string {
  return substitute(input, (name) => {
    const value = values[name];
    return value === undefined ? undefined : encodeUrl(value);
  });
}
