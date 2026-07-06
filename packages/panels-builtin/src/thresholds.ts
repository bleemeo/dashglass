import { z } from "zod";

/**
 * Shared threshold model for single-value panels (gauge, stat): ordered
 * status boundaries — the value is "good" below the first threshold,
 * then takes each threshold's status from its value upward. Status
 * colors come from the theme's reserved status ramp, never from the
 * series palette.
 */
export const thresholdsSchema = z.array(
  z.object({
    value: z.number(),
    status: z.enum(["warning", "serious", "critical"]),
  }),
);

export type Threshold = z.infer<typeof thresholdsSchema>[number];

export type ThresholdStatus = "good" | Threshold["status"];

/** Status of a value against ordered thresholds. */
export function thresholdStatus(
  value: number,
  thresholds: Threshold[],
): ThresholdStatus {
  let status: ThresholdStatus = "good";
  for (const threshold of thresholds) {
    if (value >= threshold.value) {
      status = threshold.status;
    }
  }
  return status;
}
