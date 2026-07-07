/** Values of dashboard variables, by name. */
export type VariableValues = Record<string, string | string[]>;

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

function encode(value: string | string[]): string {
  // Multi-values render as a regex alternation, the PromQL idiom for
  // multi-select variables used with the =~ matcher. Each member is
  // escaped so a value like "10.0.0.1" or "a|b" matches literally, not
  // as a pattern. Single values are left verbatim: they may be used in
  // an exact (=) matcher where escaping would be wrong.
  return Array.isArray(value)
    ? value.map(escapeRegex).join("|")
    : value;
}

/**
 * Substitutes dashboard variables in a PromQL expression: `$name` and
 * `${name}` forms.
 */
export function interpolate(input: string, values: VariableValues): string {
  return input
    .replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, name: string) => {
      const value = values[name];
      return value === undefined ? match : encode(value);
    })
    .replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, name: string) => {
      const value = values[name];
      return value === undefined ? match : encode(value);
    });
}
