/** Compact relative time ("just now", "5m ago", "3d ago", "2mo ago"). */
export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) {
    return "";
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "";
  }
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) {
    return "just now";
  }
  // Largest unit whose threshold the age has crossed.
  const steps: [threshold: number, perUnit: number, suffix: string][] = [
    [31536000, 31536000, "y"],
    [2592000, 2592000, "mo"],
    [86400, 86400, "d"],
    [3600, 3600, "h"],
    [60, 60, "m"],
  ];
  for (const [threshold, perUnit, suffix] of steps) {
    if (seconds >= threshold) {
      return `${Math.floor(seconds / perUnit)}${suffix} ago`;
    }
  }
  return "just now";
}
