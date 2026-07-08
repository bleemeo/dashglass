import { useMemo } from "react";

import type { PanelProps } from "@dashglass/runtime";

import { parseSpec } from "../spec";
import { imageSpecSchema } from "./options";

/**
 * A static image panel: logos, diagrams, status banners. No queries — the
 * data prop is ignored. Prefer this over a Markdown image when you want
 * to control how it fills the panel.
 */
export function ImagePanel({ spec }: PanelProps) {
  const parsed = useMemo(() => parseSpec(imageSpecSchema, spec), [spec]);

  if (!parsed.url) {
    return (
      <p className="dashglass-panel-unknown">
        No image URL — set one in the panel options.
      </p>
    );
  }
  return (
    <img
      src={parsed.url}
      alt={parsed.alt ?? ""}
      referrerPolicy="no-referrer"
      style={{
        width: "100%",
        height: "100%",
        // contain (default) letterboxes; cover crops; fill stretches.
        objectFit: parsed.fit ?? "contain",
        display: "block",
      }}
    />
  );
}
