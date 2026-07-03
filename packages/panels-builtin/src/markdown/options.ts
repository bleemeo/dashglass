import { z } from "zod";

// Kept apart from MarkdownPanel.tsx so importing the schema (editor, root
// entry) never drags react-markdown into the host's main chunk.
export const markdownSpecSchema = z.object({
  /** Markdown source; raw HTML is not rendered (react-markdown default). */
  content: z.string().optional(),
});

export type MarkdownSpec = z.infer<typeof markdownSpecSchema>;
