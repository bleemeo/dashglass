import type { z } from "zod";

/**
 * Panel plugins own their spec validation (the model keeps plugin specs
 * opaque). Parsing is forgiving: an invalid spec falls back to the
 * schema's defaults so a hand-edited dashboard degrades instead of
 * crashing the panel.
 */
export function parseSpec<Schema extends z.ZodType>(
  schema: Schema,
  spec: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(spec ?? {});
  if (result.success) {
    return result.data;
  }
  return schema.parse({});
}
