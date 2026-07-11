import { z } from "zod";

import { displaySchema, pluginSchema } from "./common";
import { variableNameSchema } from "./variables";

/**
 * A query attached to a panel. `kind` is the query family (e.g.
 * "TimeSeriesQuery"); the nested plugin (e.g. "PrometheusTimeSeriesQuery")
 * carries the actual query definition.
 */
export const querySchema = z.strictObject({
  kind: z.string().min(1),
  spec: z.strictObject({
    plugin: pluginSchema,
  }),
});

/**
 * A data link shown on a panel: a navigable URL with dashboard variables
 * (`$instance`) and the time-range tokens `$__from`/`$__to` interpolated at
 * render time. Relative URLs point at other dashboards
 * (`/d/host-detail?var-instance=$instance`); absolute URLs open external
 * targets.
 */
export const linkSchema = z.strictObject({
  // Empty is tolerated (an in-progress row in the editor, like a blank query
  // string) and simply not rendered; a link needs a URL to be actionable.
  url: z.string(),
  title: z.string().optional(),
  /** Open the link in a new browser tab. */
  targetBlank: z.boolean().optional(),
});

/**
 * Repeats a panel once per value of a dashboard variable. The values are the
 * variable's current selection (or all of its options when "All" is
 * selected). Instances tile horizontally by default, wrapping to new rows
 * and pushing the panels below them down; `direction: "vertical"` stacks
 * them in a single column instead. `maxPerRow` caps the horizontal count.
 */
export const repeatSchema = z.strictObject({
  variable: variableNameSchema,
  direction: z.enum(["horizontal", "vertical"]).optional(),
  maxPerRow: z.number().int().min(1).optional(),
});

export const panelSchema = z.strictObject({
  kind: z.literal("Panel"),
  spec: z.strictObject({
    display: displaySchema.optional(),
    plugin: pluginSchema,
    queries: z.array(querySchema).optional(),
    links: z.array(linkSchema).optional(),
    repeat: repeatSchema.optional(),
  }),
});

export type Query = z.infer<typeof querySchema>;
export type Link = z.infer<typeof linkSchema>;
export type Repeat = z.infer<typeof repeatSchema>;
export type Panel = z.infer<typeof panelSchema>;
