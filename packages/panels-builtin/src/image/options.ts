import { z } from "zod";

export const imageSpecSchema = z.object({
  /** Image source URL (any http(s) image). */
  url: z.string().optional(),
  alt: z.string().optional(),
  /** How the image fills the panel (default: contain). */
  fit: z.enum(["cover", "fill"]).optional(),
});

export type ImageSpec = z.infer<typeof imageSpecSchema>;
