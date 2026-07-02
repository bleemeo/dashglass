import { z } from "zod";

export const PANEL_REF_PREFIX = "#/spec/panels/";

/** JSON reference to a panel in the dashboard's `spec.panels` map. */
export const panelRefSchema = z.strictObject({
  $ref: z
    .string()
    .regex(
      /^#\/spec\/panels\/[a-zA-Z0-9_-]+$/,
      'expected a panel reference such as "#/spec/panels/cpu"',
    ),
});

export const gridItemSchema = z.strictObject({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  content: panelRefSchema,
});

/**
 * Layouts are separate from panel definitions: panels live in a map, layouts
 * position them by reference. Moving a panel is a layout-only diff.
 */
export const gridLayoutSchema = z.strictObject({
  kind: z.literal("Grid"),
  spec: z.strictObject({
    display: z
      .strictObject({
        title: z.string(),
        collapse: z.strictObject({ open: z.boolean() }).optional(),
      })
      .optional(),
    items: z.array(gridItemSchema),
  }),
});

/** Extracts the panel key from a layout `$ref`. */
export function panelKeyFromRef(ref: string): string {
  return ref.slice(PANEL_REF_PREFIX.length);
}

/** Builds a layout `$ref` for a panel key. */
export function panelRefFromKey(key: string): string {
  return `${PANEL_REF_PREFIX}${key}`;
}

export type GridItem = z.infer<typeof gridItemSchema>;
export type GridLayout = z.infer<typeof gridLayoutSchema>;
