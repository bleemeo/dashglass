import { z } from "zod";

export const calculationSchema = z.enum(["last", "mean", "min", "max", "sum"]);
export type Calculation = z.infer<typeof calculationSchema>;

/** Reduces a series' points to the stat value, ignoring null gaps. */
export function calculate(
  points: [number, number | null][],
  calculation: Calculation,
): number | null {
  const values = points
    .map(([, value]) => value)
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return null;
  }
  switch (calculation) {
    case "last":
      return values[values.length - 1]!;
    case "mean":
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "sum":
      return values.reduce((sum, value) => sum + value, 0);
  }
}
