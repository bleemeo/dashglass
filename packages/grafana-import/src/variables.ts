import type { Variable } from "@dashglass/model";

import type { GrafanaTemplateVar } from "./types";

const NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function queryString(variable: GrafanaTemplateVar): string {
  if (typeof variable.query === "string") {
    return variable.query;
  }
  return variable.query?.query ?? "";
}

/**
 * Parses Grafana's `label_values(metric{...}, label)` / `label_values(label)`
 * templating functions. The metric part may contain braces and commas, so
 * the split happens at the LAST top-level comma.
 */
export function parseLabelValues(
  query: string,
): { labelName: string; matcher?: string } | null {
  const match = query.trim().match(/^label_values\((.*)\)$/s);
  if (!match) {
    return null;
  }
  const inner = match[1]!.trim();
  const lastComma = inner.lastIndexOf(",");
  if (lastComma === -1) {
    return NAME_PATTERN.test(inner) ? { labelName: inner } : null;
  }
  const matcher = inner.slice(0, lastComma).trim();
  const labelName = inner.slice(lastComma + 1).trim();
  return NAME_PATTERN.test(labelName) ? { labelName, matcher } : null;
}

export function migrateVariables(
  list: GrafanaTemplateVar[],
  warn: (message: string) => void,
): Variable[] {
  const variables: Variable[] = [];

  for (const item of list) {
    const name = item.name ?? "";
    if (!NAME_PATTERN.test(name)) {
      warn(`variable "${name}": invalid name, skipped`);
      continue;
    }
    const display = item.label ? { display: { name: item.label } } : {};

    switch (item.type) {
      case "query": {
        const parsed = parseLabelValues(queryString(item));
        if (!parsed) {
          warn(
            `variable "${name}": only label_values(...) queries convert, skipped`,
          );
          continue;
        }
        const current = item.current?.value;
        const defaultValue =
          typeof current === "string" && current !== "$__all"
            ? current
            : undefined;
        variables.push({
          kind: "ListVariable",
          spec: {
            name,
            ...display,
            ...(defaultValue !== undefined ? { defaultValue } : {}),
            ...(item.includeAll ? { allowAllValue: true } : {}),
            ...(item.multi ? { allowMultiple: true } : {}),
            plugin: {
              kind: "PrometheusLabelValuesVariable",
              spec: {
                labelName: parsed.labelName,
                ...(parsed.matcher ? { matchers: [parsed.matcher] } : {}),
              },
            },
          },
        });
        break;
      }
      case "constant":
      case "textbox": {
        const current = item.current?.value;
        const value =
          typeof current === "string" && current !== ""
            ? current
            : queryString(item);
        variables.push({
          kind: "TextVariable",
          spec: {
            name,
            ...display,
            value,
            ...(item.type === "constant" ? { constant: true } : {}),
          },
        });
        break;
      }
      case "datasource":
        // Dashglass is single-datasource; the variable is meaningless here.
        break;
      default:
        warn(
          `variable "${name}": type "${item.type ?? "?"}" not supported, skipped`,
        );
    }
  }

  return variables;
}
