/** Kinds of lines in a unified diff, for coloring. */
export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "context";

/**
 * Classifies one line of `git diff` output. File headers (---/+++ and the
 * diff/index lines) are "meta", hunk headers (@@) are "hunk", and only
 * actual content changes are "add"/"del".
 */
export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "meta";
  }
  if (
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("similarity ") ||
    line.startsWith("rename ")
  ) {
    return "meta";
  }
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("+")) {
    return "add";
  }
  if (line.startsWith("-")) {
    return "del";
  }
  return "context";
}
