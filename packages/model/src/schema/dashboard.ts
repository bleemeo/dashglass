import { z } from "zod";

import {
  displaySchema,
  durationSchema,
  metadataSchema,
  nameSchema,
  panelKeySchema,
  pluginSchema,
} from "./common";
import { gridLayoutSchema, panelKeyFromRef } from "./layouts";
import { panelSchema } from "./panels";
import { variableSchema } from "./variables";

export const CURRENT_API_VERSION = "v1";

export const datasourceSchema = z.strictObject({
  display: displaySchema.optional(),
  default: z.boolean().optional(),
  plugin: pluginSchema,
});

export const dashboardSpecSchema = z.strictObject({
  display: displaySchema.optional(),
  datasources: z.record(nameSchema, datasourceSchema).optional(),
  variables: z.array(variableSchema).optional(),
  panels: z.record(panelKeySchema, panelSchema),
  layouts: z.array(gridLayoutSchema),
  duration: durationSchema.optional(),
  refreshInterval: durationSchema.optional(),
});

export const dashboardSchema = z
  .strictObject({
    apiVersion: z.literal(CURRENT_API_VERSION),
    kind: z.literal("Dashboard"),
    metadata: metadataSchema,
    spec: dashboardSpecSchema,
  })
  .superRefine((dashboard, ctx) => {
    const panelKeys = new Set(Object.keys(dashboard.spec.panels));
    dashboard.spec.layouts.forEach((layout, layoutIndex) => {
      layout.spec.items.forEach((item, itemIndex) => {
        const key = panelKeyFromRef(item.content.$ref);
        if (!panelKeys.has(key)) {
          ctx.addIssue({
            code: "custom",
            message: `layout item references unknown panel "${key}"`,
            path: [
              "spec",
              "layouts",
              layoutIndex,
              "spec",
              "items",
              itemIndex,
              "content",
              "$ref",
            ],
          });
        }
      });
    });

    const seenVariables = new Set<string>();
    dashboard.spec.variables?.forEach((variable, index) => {
      const name = variable.spec.name;
      if (seenVariables.has(name)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate variable name "${name}"`,
          path: ["spec", "variables", index, "spec", "name"],
        });
      }
      seenVariables.add(name);
    });

    // A panel's `repeat` must target a variable declared on the dashboard.
    Object.entries(dashboard.spec.panels).forEach(([key, panel]) => {
      const repeat = panel.spec.repeat;
      if (repeat && !seenVariables.has(repeat.variable)) {
        ctx.addIssue({
          code: "custom",
          message: `panel "${key}" repeats over unknown variable "${repeat.variable}"`,
          path: ["spec", "panels", key, "spec", "repeat", "variable"],
        });
      }
    });
  });

export type Datasource = z.infer<typeof datasourceSchema>;
export type DashboardSpec = z.infer<typeof dashboardSpecSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
