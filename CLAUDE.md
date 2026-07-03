# Polaris — notes for coding agents

Lightweight, Prometheus-only dashboarding (the dashboard part of Grafana,
nothing else) with GitOps-first file storage. **Read DESIGN.md before any
architectural change** — it is the source of truth for the data model, the
plugin system and the Bleemeo SaaS convergence plan. This file only covers
what you need to work in the repo.

## Layout

pnpm monorepo (TypeScript, React 19, strict tsconfig) + a Go backend:

- `packages/model` — dashboard schema (Zod, Perses-derived `kind`/`spec`),
  deterministic JSON/YAML/TOML serializers, migrations. The file format is
  the product.
- `packages/runtime` — dashboard engine: plugin registries (panels, pages,
  variable sources), `PrometheusDataSource` interface, query orchestrator,
  React providers, `DashboardRenderer`/`DashboardGrid`.
- `packages/datasource-prometheus` — HTTP impl of the interface (native
  Prometheus API paths) + `PrometheusLabelValuesVariable` source.
- `packages/panels-builtin` — panel plugins: TimeSeriesChart, StatChart,
  GaugeChart, Table (ECharts via `echarts/core`; Stat/Table are plain
  HTML/SVG) + their options-form editors (plain HTML `polaris-field*`
  controls). Chart theme tokens live here (`ChartThemeProvider`).
- `packages/promql-editor` — CodeMirror PromQL editor
  (`@prometheus-io/codemirror-promql`).
- `packages/ui` — Chakra system (`polarisSystem`, styles the runtime's
  `polaris-*` class names via semantic tokens) + color mode
  (`ColorModeProvider`, light/dark/system, `.dark` root class).
- `apps/polaris` — OSS app shell: assembles registries, TanStack Query for
  management CRUD, SSE → cache invalidation, form-based dashboard editor
  (`/d/:name/edit`, react-grid-layout v2) and as-code editor
  (`/d/:name/code`).
- `backend/` — Go single binary: embedded SPA, dashboards-directory CRUD
  (validating), read-only allowlisted Prometheus proxy on native
  `/api/v1/*` paths, fsnotify → SSE, `/api/capabilities`.
- `dashboards/` — sample dashboard files used in dev.

## Commands

```sh
pnpm test                    # all workspace tests (vitest)
pnpm typecheck               # all packages + app (tsc)
cd backend && go test ./...  # backend tests
pnpm --filter polaris dev    # vite on :3000, proxies /api to :8080
pnpm build-binary            # app build → embed → ./polaris binary
```

Dev backend: `cd backend && go run . -prometheus-url <url>
-dashboards-dir ../dashboards`. Without a real Prometheus, write a fake one
(a ~80-line Node http server answering `query_range`/`labels`/
`label/*/values` with sine data works fine; one existed in a previous
session's scratchpad).

## Hard rules (from DESIGN.md, enforced in reviews)

- **Shared packages expose neither Redux nor TanStack Query in their public
  API** (§8). The runtime's query orchestrator is dependency-free; the app
  uses TanStack Query; bleemeo-panel will keep Redux. Don't leak either
  into `packages/*` exports.
- **Everything extensible is `kind`/`spec`** resolved through a registry.
  Plugin specs are opaque to `packages/model` (each plugin validates its
  own spec with a forgiving zod fallback). Unknown panel kinds must degrade
  gracefully, never crash — that's the OSS-opens-SaaS-dashboard scenario.
- **Serialization must stay deterministic and git-friendly**: stable key
  order (`canonical.ts`), no volatile fields, defaults omitted. A one-field
  edit must produce a one-line YAML diff — there is a test asserting this;
  keep it passing.
- **After changing the Zod schemas in `packages/model`**, run
  `pnpm generate-schema` (in that package) to regenerate
  `backend/schema/dashboard.schema.json`, and mirror any cross-field check
  in `backend/internal/store/validate.go` (`crossFieldIssues`).
- The Go proxy allowlist is **read-only Prometheus endpoints only** — never
  expose admin/write paths.
- Chart colors: categorical slots assigned by index in fixed order (the
  ordering is the colorblind-safety mechanism), status colors reserved for
  thresholds/states and never used as series colors.
- The model, docs, comments and commit messages are in **English**.

## Gotchas

- `pnpm build-binary` overwrites the tracked placeholder
  `backend/internal/ui/dist/index.html` with the real build. Restore it
  before committing (`git diff` will show it); build assets are gitignored
  but the placeholder must stay tracked or `go:embed` breaks fresh clones.
- Workspace packages are consumed as TS source (`exports: ./src/index.ts`),
  so compiler options (jsx, DOM lib) live in `tsconfig.base.json`.
- `window.fetch` must be bound when stored (`fetch.bind(globalThis)`) —
  already handled in `http-datasource.ts`; same applies to any new client.
- jsdom has no canvas: test ECharts panels through their pure option
  builders (`buildTimeSeriesOption`…), not by mounting `<EChart>`.
- End-to-end visual checks work well with the full binary + a fake
  Prometheus + headless Chrome screenshots
  (`--headless=new --screenshot=… --timeout=15000`); the SSE stream keeps
  the page "loading" forever, so a hard `--timeout` is required
  (`--virtual-time-budget` hangs).
- jsonschema/v6 (Go): `ErrorKind.LocalizedString` needs a non-nil
  `message.Printer`.
- **Kill leftover `./polaris` processes when a served UI looks stale.** A
  binary from a previous session can hold `127.0.0.1:8080` (IPv4) while
  docker compose only gets the IPv6 side — the browser then reaches the
  old process and curl/localhost may reach the new one. `lsof -nP
  -iTCP:8080 -sTCP:LISTEN` shows the split; also check for a stray
  `fake-prom` node process. Restart the compose stack after killing so
  it rebinds IPv4.
- To screenshot both color modes, drive headless Chrome over CDP
  (`--remote-debugging-port`) and call `Emulation.setEmulatedMedia` with a
  `prefers-color-scheme` feature — there is no CLI flag for light, and the
  host OS preference leaks into `--screenshot` runs. Working scripts from a
  past session: `shot.mjs` / `editor-check.mjs` in that session's
  scratchpad (rewrite is ~60 lines).
- Code splitting relies on `sideEffects` in the workspace package.json
  files. Two traps: `echarts-setup.ts` must stay listed as side-effectful
  in `panels-builtin` (its `echarts.use()` gets shaken away otherwise and
  charts crash at runtime with "x is not a constructor"), and the
  panels-builtin root entry must never statically re-export chart
  components or ECharts lands back in the app's main chunk (chart panels
  register via `React.lazy`; `PanelChrome` owns the Suspense boundary).

## State / roadmap

Done: steps 1–5 of DESIGN.md §11 (model, backend, runtime, built-in panels
+ PromQL editor, app shell with view/explore/GitOps live reload), plus:
Apache-2.0 license (LICENSE, §12 resolved), `packages/ui` (theme +
light/dark/system color mode), the form-based dashboard editor
(`/d/:name/edit`; as-code editor moved to `/d/:name/code`; pure document
edit ops in `packages/model/src/edit.ts`), bundle code-splitting
(initial load 195 kB gzip), and Docker packaging (Dockerfile + compose
with a demo Prometheus).

Not started: Grafana importer, heatmap/bar panels, git-log dashboard
history, annotations, the bleemeo-panel embedding POC (DESIGN.md §9), and
the public-naming check ("Polaris" trademark, §12).
