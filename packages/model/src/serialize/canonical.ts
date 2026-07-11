/**
 * Canonical form: the git-friendliness contract. Every writer (UI saves
 * included) serializes through this so that output is deterministic — stable
 * key order regardless of input order, volatile-free — and a small edit
 * produces a small diff.
 */

/**
 * Global key ordering. Keys are emitted in this order; keys not listed
 * (plugin spec contents, panel map keys, ...) come after, alphabetically.
 */
const KEY_ORDER = [
  "apiVersion",
  "kind",
  "metadata",
  "spec",
  "name",
  "display",
  "description",
  "datasources",
  "variables",
  "panels",
  "layouts",
  "duration",
  "refreshInterval",
  "default",
  "value",
  "constant",
  "defaultValue",
  "allowAllValue",
  "allowMultiple",
  "plugin",
  "queries",
  "links",
  "repeat",
  "title",
  "collapse",
  "open",
  "items",
  "x",
  "y",
  "width",
  "height",
  "content",
  "$ref",
  "url",
  "targetBlank",
  "variable",
  "direction",
  "maxPerRow",
] as const;

const KEY_RANK = new Map<string, number>(
  KEY_ORDER.map((key, index) => [key, index]),
);

function compareKeys(a: string, b: string): number {
  const rankA = KEY_RANK.get(a) ?? Number.POSITIVE_INFINITY;
  const rankB = KEY_RANK.get(b) ?? Number.POSITIVE_INFINITY;
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Returns a deep copy with object keys in canonical order and
 * `undefined`/`null` entries dropped (absence is the canonical encoding of
 * "not set"; it also keeps the model TOML-compatible, TOML having no null).
 */
export function canonicalize<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, entryValue]) => entryValue !== undefined && entryValue !== null,
    );
    entries.sort(([a], [b]) => compareKeys(a, b));
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, canonicalize(entryValue)]),
    ) as T;
  }
  return value;
}
