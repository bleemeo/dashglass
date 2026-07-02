import { z } from "zod";

import { displaySchema, pluginSchema } from "./common";

/** Variable name as referenced in PromQL templating (`$instance`). */
export const variableNameSchema = z
  .string()
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_]*$/,
    "expected a variable name made of letters, digits and '_', not starting with a digit",
  );

/**
 * A variable whose values come from a plugin-provided list, e.g.
 * `PrometheusLabelValuesVariable`.
 */
export const listVariableSchema = z.strictObject({
  kind: z.literal("ListVariable"),
  spec: z.strictObject({
    name: variableNameSchema,
    display: displaySchema.optional(),
    defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
    allowAllValue: z.boolean().optional(),
    allowMultiple: z.boolean().optional(),
    plugin: pluginSchema,
  }),
});

/** A free-text (or constant) variable. */
export const textVariableSchema = z.strictObject({
  kind: z.literal("TextVariable"),
  spec: z.strictObject({
    name: variableNameSchema,
    display: displaySchema.optional(),
    value: z.string(),
    constant: z.boolean().optional(),
  }),
});

export const variableSchema = z.discriminatedUnion("kind", [
  listVariableSchema,
  textVariableSchema,
]);

export type ListVariable = z.infer<typeof listVariableSchema>;
export type TextVariable = z.infer<typeof textVariableSchema>;
export type Variable = z.infer<typeof variableSchema>;
