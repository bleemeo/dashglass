/**
 * Panel repetition is a pure layout transform: one grid item carrying a
 * `repeat` config expands into one instance per variable value, and the
 * panels below it slide down to make room. Keeping this side-effect-free
 * (no React, no variable context) makes the reflow easy to test and keeps
 * the runtime's dependency-free contract (DESIGN.md §8) intact.
 */

export interface RepeatableItem {
  /** Panel key referenced by this layout item. */
  panelKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * When set, the item repeats once per entry in `values`, each instance
   * pinned to that value of `variable`. `direction`/`maxPerRow` shape the
   * tiling (default: horizontal, wrapping at the grid width).
   */
  repeat?:
    | {
        variable: string;
        values: string[];
        direction?: "horizontal" | "vertical" | undefined;
        maxPerRow?: number | undefined;
      }
    | undefined;
}

export interface PlacedItem {
  /** Stable React key, unique across a layout's placed items. */
  key: string;
  panelKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The variable value pinned for this instance, or null when not repeated. */
  pinned: { name: string; value: string } | null;
}

/**
 * Expands repeated items and reflows the grid. Instances of a repeated item
 * tile left-to-right from the item's own `x`, wrapping every `perRow`
 * instances; vertical repeats stack in a single column. Every item on a
 * lower original row is pushed down by the extra rows the expansion above it
 * consumes.
 *
 * Reflow is row-based: same-row neighbours never push each other, so a
 * repeated panel placed beside a normal one leaves that neighbour in place.
 * The intended (and editor-produced) layout is a repeated panel alone on its
 * row; two repeats sharing a row grow in parallel and the taller one governs
 * the push below.
 */
export function placeItems(
  items: RepeatableItem[],
  columns = 24,
): PlacedItem[] {
  const perRowOf = (item: RepeatableItem, count: number): number => {
    if (!item.repeat || count <= 1 || item.repeat.direction === "vertical") {
      return 1;
    }
    const fit = Math.max(1, Math.floor((columns - item.x) / item.width));
    const desired =
      item.repeat.maxPerRow ?? Math.max(1, Math.floor(columns / item.width));
    return Math.max(1, Math.min(desired, fit));
  };

  const expansions = items.map((item) => {
    const values = item.repeat?.values ?? [];
    const count = item.repeat && values.length > 0 ? values.length : 1;
    const perRow = perRowOf(item, count);
    const rows = Math.ceil(count / perRow);
    return { item, values, count, perRow, extra: rows * item.height - item.height };
  });

  // Extra rows contributed by each original row = the largest expansion on
  // that row (side-by-side blocks grow in parallel, they do not stack).
  const extraByRow = new Map<number, number>();
  for (const expansion of expansions) {
    const current = extraByRow.get(expansion.item.y) ?? 0;
    if (expansion.extra > current) {
      extraByRow.set(expansion.item.y, expansion.extra);
    }
  }
  const offsetFor = (y: number): number => {
    let sum = 0;
    for (const [row, extra] of extraByRow) {
      if (row < y) {
        sum += extra;
      }
    }
    return sum;
  };

  const placed: PlacedItem[] = [];
  expansions.forEach(({ item, values, count, perRow }, index) => {
    const baseY = item.y + offsetFor(item.y);
    const pinnedName =
      item.repeat && values.length > 0 ? item.repeat.variable : null;
    for (let i = 0; i < count; i += 1) {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      placed.push({
        key: count > 1 ? `${item.panelKey}-${index}-${i}` : `${item.panelKey}-${index}`,
        panelKey: item.panelKey,
        x: item.x + col * item.width,
        y: baseY + row * item.height,
        width: item.width,
        height: item.height,
        pinned: pinnedName ? { name: pinnedName, value: values[i]! } : null,
      });
    }
  });
  return placed;
}
