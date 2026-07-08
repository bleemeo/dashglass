import type { Extension } from "@codemirror/state";
import { PromQLExtension } from "@prometheus-io/codemirror-promql";

export interface PromQLExtensionOptions {
  /**
   * Base URL of a Prometheus-compatible API (the Dashglass backend proxy,
   * "" for same-origin) powering metric/label/value autocompletion.
   * Omitted: static PromQL completion only (functions, keywords).
   */
  completeURL?: string | undefined;
  /** Injectable fetch (auth decoration, tests). */
  fetchFn?: typeof fetch | undefined;
}

/**
 * Builds the official Prometheus CodeMirror extension: syntax
 * highlighting, offline linting, and — when completeURL is set —
 * autocompletion backed by the live Prometheus API.
 */
export function buildPromQLExtension(
  options: PromQLExtensionOptions = {},
): Extension {
  const extension = new PromQLExtension()
    .activateCompletion(true)
    .activateLinter(true);
  if (options.completeURL !== undefined) {
    extension.setComplete({
      remote: {
        url: options.completeURL,
        ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
      },
    });
  }
  return extension.asExtension();
}
