# Polaris

Lightweight, Prometheus-native dashboards with first-class GitOps support:
dashboards are edited in the UI and stored as JSON/YAML/TOML files you can
version, review and deploy through git.

See [DESIGN.md](./DESIGN.md) for the full design document.

## Repository layout

- `packages/model` — dashboard data model: Zod schemas (Perses-derived),
  deterministic JSON/YAML/TOML serializers, schema migrations.
- `packages/runtime` — plugin registries, query orchestrator and dashboard
  rendering engine.
- `packages/panels-builtin` — built-in panel plugins: time series, stat,
  gauge, table (ECharts).
- `packages/datasource-prometheus` — Prometheus data source over the
  native HTTP API paths.
- `packages/promql-editor` — CodeMirror PromQL editor with live
  autocompletion.
- `packages/ui` — Chakra theme and shared primitives (planned).
- `apps/polaris` — the open-source app shell (planned).
- `backend/` — Go server: SPA hosting, Prometheus proxy, dashboard file
  management (CRUD + validation + fsnotify/SSE live reload).

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
```

Backend:

```sh
cd backend
go test ./...
go run . -prometheus-url http://localhost:9090 -dashboards-dir ../dashboards
```

App development (vite dev server on :3000, proxying /api to the backend
on :8080):

```sh
pnpm --filter polaris dev
```

Full single-binary build (SPA embedded):

```sh
pnpm build-binary
./polaris -prometheus-url http://localhost:9090 -dashboards-dir ./dashboards
```

The dashboard JSON Schema used by the backend is generated from the Zod
schemas (`pnpm generate-schema` in `packages/model`); regenerate it after
changing the model.
