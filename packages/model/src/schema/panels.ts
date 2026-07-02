import { z } from "zod";

import { displaySchema, pluginSchema } from "./common";

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

export const panelSchema = z.strictObject({
  kind: z.literal("Panel"),
  spec: z.strictObject({
    display: displaySchema.optional(),
    plugin: pluginSchema,
    queries: z.array(querySchema).optional(),
  }),
});

export type Query = z.infer<typeof querySchema>;
export type Panel = z.infer<typeof panelSchema>;
