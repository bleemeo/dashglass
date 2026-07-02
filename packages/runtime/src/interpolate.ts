/** Values of dashboard variables, by name. */
export type VariableValues = Record<string, string | string[]>;

function encode(value: string | string[]): string {
  // Multi-values render as a regex alternation, the PromQL idiom for
  // multi-select variables used with the =~ matcher.
  return Array.isArray(value) ? value.join("|") : value;
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
