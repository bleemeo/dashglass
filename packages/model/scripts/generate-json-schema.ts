/**
 * Generates the JSON Schema consumed by the Go backend (and usable for
 * editor autocompletion on dashboard files). The Zod schemas are the single
 * source of truth; run `pnpm generate-schema` after changing them.
 *
 * Note: cross-field refinements (layout $ref targets, variable name
 * uniqueness) are not representable in JSON Schema — the backend re-checks
 * those separately.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { dashboardSchema } from "../src";

const outPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../backend/schema/dashboard.schema.json",
);

const schema = {
  $id: "https://dashglass.dev/schemas/dashboard/v1",
  title: "Dashglass Dashboard",
  ...z.toJSONSchema(dashboardSchema, { target: "draft-2020-12" }),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(schema, null, 2)}\n`);
console.log(`wrote ${outPath}`);
