import { z } from "zod";

/**
 * Prometheus-style duration string: "300ms", "30s", "5m", "1h", "2d", "1w",
 * "1y", or compound forms like "1h30m".
 */
export const durationSchema = z
  .string()
  .regex(
    /^(\d+(ms|s|m|h|d|w|y))+$/,
    'expected a Prometheus duration string such as "30s", "5m" or "1h30m"',
  );

/**
 * Machine name: used in metadata and everywhere a stable identifier is
 * needed. No spaces; `display.name` carries the human-friendly label.
 */
export const nameSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-zA-Z0-9_.-]+$/,
    "expected a name made of letters, digits, '_', '.' or '-' (no spaces)",
  );

/** Key of a panel in the `spec.panels` map, referenced by layout `$ref`s. */
export const panelKeySchema = z
  .string()
  .min(1)
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "expected a panel key made of letters, digits, '_' or '-'",
  );

export const metadataSchema = z.strictObject({
  name: nameSchema,
});

export const displaySchema = z.strictObject({
  name: z.string().optional(),
  description: z.string().optional(),
});

/**
 * The universal extension point: every pluggable element (panel type, query
 * type, data source type, variable source) is a `kind` resolved through a
 * plugin registry, plus a `spec` owned by that plugin. The model keeps the
 * spec opaque; plugins validate their own spec.
 */
export const pluginSchema = z.strictObject({
  kind: z.string().min(1),
  spec: z.record(z.string(), z.unknown()).optional(),
});

export type Duration = z.infer<typeof durationSchema>;
export type Metadata = z.infer<typeof metadataSchema>;
export type Display = z.infer<typeof displaySchema>;
export type PluginRef = z.infer<typeof pluginSchema>;
