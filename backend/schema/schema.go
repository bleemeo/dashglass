// Package schema embeds the dashboard JSON Schema generated from the Zod
// schemas in packages/model (single source of truth). Regenerate with
// `pnpm generate-schema` in packages/model after changing the model.
package schema

import _ "embed"

//go:embed dashboard.schema.json
var Dashboard []byte
