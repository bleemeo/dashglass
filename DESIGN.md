# Dashglass — Design Document

Status: draft, pre-implementation.

## 1. Vision

Dashglass is a lightweight, Prometheus-native dashboarding tool: the dashboard
part of Grafana — and only that — with first-class GitOps support.

- **Prometheus only** as a data source (at first).
- Dashboards are **edited in the UI** but **stored as files** (JSON, YAML or
  TOML, user's choice) in a directory, so they can be versioned, reviewed and
  deployed through git.
- Ships as a **single Go binary** embedding the SPA — no database, no
  migration scripts, no plugin marketplace. Deliberately lighter than Grafana.

A second, longer-term goal shapes the architecture from day one: the Bleemeo
SaaS panel should eventually be able to **embed this UI and extend it with
proprietary plugins** (open-core model). The open-source app and the SaaS
panel would share the same dashboard engine, the same panel plugins and the
same API contract, differing only in the plugins they register and the
backend they talk to.

## 2. Non-goals

- Alerting, notification channels, incident management.
- Non-Prometheus data sources (SQL, Loki, traces…) — the data source layer is
  an interface, but only Prometheus is implemented.
- Fine-grained permissions beyond the built-in three-role model (§7.4):
  no per-dashboard/folder ACLs, no teams, no organizations/multi-tenancy,
  no SCIM, no audit log — that is the SaaS backend's concern. The OSS
  binary ships users, three fixed roles and identity-provider mapping,
  because self-hosted users rightfully expect that much; the line is
  drawn at *fine-grained* and *multi-tenant*.
- Runtime-loadable third-party plugins. Plugins are composed at build time;
  the registry design keeps runtime loading possible later.

## 3. Tech stack

Aligned with `bleemeo-panel` so components, patterns and developer habits
transfer both ways:

| Concern | Choice | Rationale |
|---|---|---|
| Build/runtime | Vite, React 19, TypeScript | Same as panel |
| UI kit | Chakra UI v3 | Same as panel |
| Charts | **Apache ECharts** (canvas) | Panel already uses ECharts for every serious widget (line, gauge, heatmap, bar) with shared utilities we can reuse. Canvas handles the point volumes a Prometheus dashboard produces; Recharts (SVG, one DOM node per point) does not. Native zoom/brush, gauges, heatmaps. |
| PromQL editing | `@prometheus-io/codemirror-promql` | Official Prometheus package: highlighting + linting + autocompletion backed by the live Prometheus API (metric names, labels, label values). Already used by panel. |
| Dashboard grid | `react-grid-layout` v2 | Already used by panel (`WidgetGrid`) |
| Schema/validation | Zod | Canonical dashboard schema, file validation on load, JSON Schema generation for editor autocompletion in GitOps workflows |
| Server state (OSS app) | TanStack Query | See §8 |
| Backend | Go, single binary, SPA embedded via `embed.FS` | Consistent with the Bleemeo ecosystem; one artifact to deploy |

## 4. Architecture overview

```
                    ┌───────────────────────────────┐
   browser ────────►│  Go backend (single binary)   │
                    │                               │
                    │  • serves the embedded SPA    │
                    │  • Prometheus proxy           │──────► Prometheus
                    │    (native /api/v1/* paths)   │
                    │  • dashboard file CRUD        │──────► dashboards/ dir
                    │  • fsnotify watcher → SSE     │        (git repo)
                    │  • /api/capabilities          │
                    └───────────────────────────────┘
```

The backend exists because the browser can neither write files nor query
Prometheus across origins with server-held credentials. It has three jobs:

1. **Serve the SPA** (embedded, one binary).
2. **Proxy Prometheus**, exposing the *native Prometheus HTTP API paths*
   (`/api/v1/query_range`, `/api/v1/query`, `/api/v1/labels`,
   `/api/v1/label/<name>/values`, `/api/v1/metadata`). Prometheus-side
   authentication is configured server-side; credentials never reach the
   browser. Mirroring the native API keeps the frontend client trivial and
   lets `codemirror-promql` plug in directly.
3. **Manage dashboard files**: read/validate/write the dashboards directory,
   watch it with fsnotify and push changes to the UI over SSE — `git pull`
   in the directory updates open dashboards live. That is the GitOps loop.

## 5. Dashboard data model

We adopt the **Perses dashboard model** (CNCF) rather than inventing one. It
is well designed, validation-friendly, and — decisively — **plugin-oriented
in the format itself**: panels, queries, data sources and variables are all
`kind`/`spec` pairs, so proprietary panel kinds serialize in the same file
format with no schema change.

Shape (Perses-derived, `apiVersion`-versioned for future migrations):

```yaml
kind: Dashboard
metadata:
  name: node-overview
spec:
  display: { name: "Node overview" }
  duration: 1h
  refreshInterval: 30s
  variables:
    - kind: ListVariable
      spec:
        name: instance
        plugin:
          kind: PrometheusLabelValuesVariable
          spec: { labelName: instance }
  panels:
    cpu:
      kind: Panel
      spec:
        display: { name: "CPU usage" }
        plugin:
          kind: TimeSeriesChart
          spec: { legend: { position: bottom } }
        queries:
          - kind: TimeSeriesQuery
            spec:
              plugin:
                kind: PrometheusTimeSeriesQuery
                spec:
                  query: 'rate(node_cpu_seconds_total{instance=~"$instance"}[5m])'
                  seriesNameFormat: "{{cpu}} {{mode}}"
  layouts:
    - kind: Grid
      spec:
        items:
          - { x: 0, y: 0, width: 12, height: 8,
              content: { $ref: "#/spec/panels/cpu" } }
```

Key properties we keep from Perses:

- **Panels and layouts are separate**: panels are a map, layouts reference
  them by `$ref`. Moving a panel is a layout-only diff.
- **Everything extensible is `kind`/`spec`** — the plugin registry (§7) is a
  direct lookup on `kind`.

The model lives in `packages/model` as Zod schemas + TypeScript types, with
serializers and migrations. The Go backend validates against the same schema
(generated JSON Schema).

### Git-friendly serialization rules

This is where Grafana fails and Dashglass must shine. Rules for every writer
(UI saves included):

- **Deterministic output**: stable key order, stable list order. Editing a
  panel title must produce a one-line diff.
- **No volatile fields**: no timestamps, no regenerated IDs, no editor
  metadata in the file.
- **Defaults are omitted**, not expanded.
- **Format by extension**: `.json` / `.yaml` / `.toml`, one internal model,
  three encoders. YAML is the default (most readable in review).
- **Versioned schema** (`apiVersion`) with explicit migrations.
- Optional **provisioned/read-only mode**: dashboards owned by git; the UI
  allows experimenting but offers "export patch" instead of saving.

## 6. Repository layout (pnpm monorepo)

```
packages/
  model/                  # Perses-derived types, Zod schemas, serializers
                          # (json/yaml/toml), schema migrations, round-trip tests
  runtime/                # plugin registries, dashboard rendering engine
                          # (grid, panel chrome, time-range & variables context,
                          # metrics query orchestrator), DataSource interface
  ui/                     # Chakra theme + shared primitives
  panels-builtin/         # TimeSeriesChart, StatChart, GaugeChart, Table (ECharts)
  datasource-prometheus/  # PrometheusDataSource impl targeting the native API
apps/
  dashglass/                # OSS app shell: assembles runtime + builtins +
                          # local-backend datasource + basic auth provider
backend/                  # Go server
```

The SaaS panel is a separate (private) consumer of the published packages: it
registers the same built-ins plus proprietary plugins. Composition happens at
build time (the Grafana OSS/Enterprise, GitLab CE/EE model) — no module
federation, no runtime plugin loading, no version matrix.

## 7. Plugin architecture — the four registries

Exploration of `bleemeo-panel` identified exactly what is hard-coded today
and must be a registry in Dashglass from the first commit:

| Extension point | Today in bleemeo-panel | In Dashglass |
|---|---|---|
| Panel types | Hard-coded ternary chain on a numeric enum (`WidgetCard.tsx`) | `registerPanel({ kind, component, editor, defaults, migrate })` |
| Navigation & routes | Static `navigationPages` array + inline `<Routes>` (`App.tsx`), gated by feature flags | `registerPage({ nav, route, element })`, filtered by capabilities |
| Data source | Metrics engine wired to `/v1/widget/preview_query/` (`promql-data.ts`) | `PrometheusDataSource` interface (§7.1) |
| Auth | Implicit Django session cookie + CSRF + `X-Bleemeo-Account` header (`api.ts`) | `AuthProvider` interface: `getUser()`, `decorateRequest()`, `login()/logout()` |

A `kind` found in a dashboard file resolves through the panel registry to a
component; unknown kinds render a graceful "unknown panel" placeholder (so an
OSS install can open a SaaS-exported dashboard without crashing).

Existing Bleemeo widget kinds map cleanly: LINE/STACKED → `TimeSeriesChart`,
NUMBER → `StatChart`, GAUGE → `GaugeChart`; STATUS, SNMP_STATUS and LOGS
remain proprietary kinds — which is precisely the validation of the plugin
model.

### 7.1 The DataSource contract

The cornerstone of backend interchangeability. One TypeScript interface,
shaped after the Prometheus HTTP API:

```ts
interface PrometheusDataSource {
  rangeQuery(promql: string, start: Time, end: Time, step: Duration): Promise<PromResponse>
  instantQuery(promql: string, time?: Time): Promise<PromResponse>
  labelNames(match?: string[], range?: TimeRange): Promise<string[]>
  labelValues(label: string, match?: string[], range?: TimeRange): Promise<string[]>
  metricMetadata(): Promise<MetricMetadata>
}
```

- **OSS implementation**: calls the Go backend's Prometheus proxy (native
  paths) — near-trivial.
- **SaaS implementation**: calls Bleemeo's `preview_query` /
  `promql_for_metric` endpoints. Their responses are already
  Prometheus-shaped (`{ status, data: { resultType, result } }`), so the
  adapter is thin.

The same interface feeds `codemirror-promql` completions and the variables
system (`label_values(...)`).

### 7.2 The management API contract

A small OpenAPI-specified "Dashglass API" both backends implement:

- Dashboard CRUD (list/get/save/delete, plus watch events over SSE).
- The Prometheus proxy (§4).
- `/api/capabilities` (§7.3).
- Current-user info.

The Go backend implements it natively; the Bleemeo API implements it behind a
thin façade. The UI only ever speaks this contract.

### 7.3 Capabilities

At startup the UI asks the backend what it supports: multi-tenancy, billing,
agents, provisioned/read-only mode, active plugin list… The OSS backend
returns the minimal profile; the SaaS returns the full one. This generalizes
the panel's existing `hasAgent`/`hasK8S`/`hasMonitor` feature-flag pattern
into a server-driven mechanism — the same UI, fed differently, instead of a
fork.

### 7.4 Configuration & authentication

**Configuration.** The binary reads an optional YAML file (`-config
dashglass.yaml`) with `${ENV_VAR}` expansion for secrets; precedence is
`flags > environment > file > defaults`, and every flag keeps working
without a file. Two kinds of state, two files:

- `dashglass.yaml` — static configuration written by a human (listen,
  Prometheus URL, dashboards dir, auth providers). Anything defined here
  is authoritative: the admin UI shows it read-only.
- `auth.yaml` — server-managed state written atomically by the backend
  (local users, role mappings edited from the UI, session secret). Never
  hand-edited; the "provisioned or managed" split mirrors the dashboards
  readonly mode.

**Authentication.** Three fixed roles — `viewer` (read dashboards, query
proxy), `editor` (+ write dashboards), `admin` (+ admin surface). One
effective role per user, no cumulation. `-readonly` stays orthogonal and
wins over roles for dashboard writes. Identity comes from, in delivery
order:

1. **Local users** — username + argon2id hash + role in `auth.yaml`.
   Managed from the admin UI (and a `dashglass user` break-glass CLI +
   `DASHGLASS_BOOTSTRAP_ADMIN_PASSWORD` for automated deployments).
   Bootstrap without CLI: while auth is disabled everyone is an
   anonymous admin, so the admin UI is reachable and "create the first
   user" enables authentication.
2. **Trusted reverse proxy** — `user`/`groups` headers from Authelia,
   Authentik, oauth2-proxy…; no Dashglass session, headers are evaluated
   per request.
3. **Native OIDC** — authorization-code flow, groups claim; lands on the
   same session cookie as local login.
4. **Native LDAP** — deferred until demand shows up; most homelab LDAP
   deployments already front it with an OIDC provider.

External identities carry groups; groups map to roles with one shared
structure per provider (`role_mapping: {admin: [...], editor: [...],
viewer: ["*"]}`): the **highest matching role wins**, `"*"` matches any
authenticated user, and **no match means 403** — being authenticated in a
shared IdP grants nothing until a mapping says so. Local users have no
groups; their role is direct.

Sessions are signed cookies (HttpOnly, SameSite=Lax, HMAC secret
generated into `auth.yaml`), plus a per-user session version bumped on
password/role change so revocation is immediate despite stateless
cookies. Login is throttled per IP. `capabilities.auth` advertises the
mode so the same UI serves the SaaS through its own AuthProvider
(§7 table) — this section is the OSS implementation of that contract,
not a second system.

`bleemeo-panel` is deeply RTK Query (Redux); the natural choice for a small
OSS app is TanStack Query. Picking either for the *shared packages* would
leak an implementation choice into the public contract: RTK Query would force
every host to mount a Redux store with our reducers/middleware; exposed
TanStack hooks would force a `QueryClient` on the panel.

**Rule: the shared packages expose neither Redux nor TanStack Query in their
public API.**

1. **`runtime` embeds its own metrics query orchestrator**, self-contained
   behind the `PrometheusDataSource` interface: per-panel polling aligned on
   the query `step`, abort when a panel leaves the viewport, sharing of
   identical queries across panels. It is the functional equivalent of
   panel's `promql-data.ts` listener-middleware engine, but encapsulated with
   no external store dependency (this is also how Perses makes its engine
   embeddable). Panels are pure display components receiving data as props
   from the panel chrome. The orchestrator's needs (step-aligned polling,
   visibility-based abort, streaming later) exceed TanStack's request/cache
   model anyway, so it is dedicated code with no dependency.
2. **Each host app keeps its own stack for management CRUD** (dashboards,
   settings, users):
   - the OSS `apps/dashglass` uses **TanStack Query** — no global store to
     maintain for an app this size;
   - `bleemeo-panel` **keeps Redux/RTK unchanged**. When it embeds the
     dashboard engine, it mounts `<DashboardRenderer>` with a
     `PrometheusDataSource` implementation backed by `preview_query`, next to
     its Redux store, with no conflict. Its `promql-data.ts` eventually
     becomes replaceable by the runtime orchestrator.

Nuance: the rule constrains the **public API**. Internally, `runtime` could
use a private, non-exposed `QueryClient` as an implementation detail — it
coexists fine with Redux in a host — but the metrics orchestrator is
dedicated code regardless, to keep the package lean.

## 9. SaaS convergence path

The panel is already PromQL-native end to end (widgets carry a
`promql_query`; the metrics endpoint returns Prometheus-shaped responses), so
convergence is an adapter problem, not a rewrite. Strangler-fig, not big
bang:

1. Dashglass ships standalone with the four registries in place (even while
   only built-ins exist).
2. Panel converts its widget-dispatch ternary and `navigationPages` array
   into registries (an internal refactor, no behavior change).
3. Panel embeds the Dashglass dashboard engine for its dashboard pages, with a
   Bleemeo `PrometheusDataSource` and its proprietary panel kinds.
4. Model convergence: a **bidirectional converter** between the Bleemeo
   widget model (widgets as separate API resources, grid stored per widget,
   `DashboardLayoutJSON` export format) and the Dashglass/Perses document
   model. Long-term, the SaaS can store/expose dashboards in the Dashglass
   format, enabling **"export your SaaS dashboards to git"** (GitOps as a
   SaaS feature) and a two-way migration bridge between OSS and SaaS users.

Versioning discipline: once panel consumes the packages, the plugin API is a
contract. Keep it marked `experimental` until Dashglass v1 ships, and only
stabilize it after **porting one real panel widget** onto it — that exercise
reveals what the contract is missing.

## 10. Features

The original feature plan (v1, then v2+), kept for the rationale behind each
choice. **What actually exists is tracked in §13** — that matrix is
authoritative; all of v1 and most of v2+ below has shipped, so read this
section as intent, not status.

### v1

- Panel kinds: **timeseries**, **stat** (single value + sparkline),
  **gauge**, **table**.
- PromQL editor with highlighting, linting and live autocompletion
  (CodeMirror + `codemirror-promql` wired to the data source).
- Dashboard **variables** (`$instance`, `$job`) fed by `label_values()` —
  in the schema from day one even if the editor UI comes later.
- Time range picker, auto-refresh, zoom/brush on charts.
- **Legend templating** (`{{instance}} — {{mountpoint}}`) and unit
  formatting (bytes, percent, durations) — small details that carry 90% of
  perceived quality.
- **Explore mode**: a free PromQL + graph page to iterate on a query before
  adding it to a panel.
- File watch + live reload (the GitOps loop).

### v2+

- Heatmap and bar panels.
- **Grafana dashboard importer** (even partial: timeseries/stat/gauge) — the
  adoption killer feature; nobody recreates 40 dashboards by hand.
- Dashboard history via `git log` when the dashboards directory is a git
  repo (read-only integration; git itself is the version store).
- Provisioned/read-only mode (the originally-sketched "export patch" was
  dropped — provisioned instances are edited in git).
- **Data links / drill-down**: panel links carrying the current variables and
  time range (`$instance`, `$__from`/`$__to`) to another dashboard or an
  external tool.
- **Repeating panels by variable**: one panel definition rendered once per
  value of a variable (panel repeat done; row/section repeat is the follow-up).
- Annotations (planned — not yet built).

## 11. Build order

1. `packages/model` — schema, serializers, migrations, round-trip tests.
   The file format is the product; it comes first.
2. Go backend — Prometheus proxy, file CRUD + validation, fsnotify watcher +
   SSE, capabilities.
3. `packages/runtime` — the four registries, grid rendering, panel chrome,
   time-range/variables context, metrics orchestrator.
4. `packages/panels-builtin` (reusing panel's ECharts utilities —
   `chart-options.ts`, `line-chart-tools.ts` — as a starting point) +
   PromQL editor.
5. `apps/dashglass` assembled end to end; then, only after stabilization, the
   "panel embeds the engine" proof of concept.

## 12. Open questions

- ~~**License**~~ — **decided (2026-07): Apache-2.0**, adoption is the
  priority. `LICENSE` at the repo root; every package declares
  `"license": "Apache-2.0"`.
- **Project naming**: working name "Dashglass" (repo `dashglass`); check for
  trademark/name collisions before going public.
- Prior art: **Perses** (CNCF) shares the pitch and provided the data model;
  differentiation is editing UX, git-friendly multi-format serialization,
  and the Bleemeo convergence story.

## 13. Feature status

Canonical status of every feature — the single source of truth the README
and `CLAUDE.md` defer to. Update this table when a feature lands or a
non-goal changes. Legend: ✅ done · 🚧 planned · ⛔ non-goal (§2).

| Area | Feature | Status |
|---|---|---|
| Panels | Time series, stat, gauge, table, bar, heatmap, status grid, markdown, image, clock | ✅ |
| Panels | Legend templating (`{{label}}`) and unit formatting | ✅ |
| Dashboards | PromQL editor (autocomplete + lint) | ✅ |
| Dashboards | Variables, incl. chaining (dependent lists) | ✅ |
| Dashboards | Time range picker, auto-refresh, zoom/brush | ✅ |
| Dashboards | Explore mode | ✅ |
| Dashboards | Kiosk / TV mode, light & dark themes | ✅ |
| Dashboards | Panel repeat by variable | ✅ |
| Dashboards | Data links / drill-down (variable + `$__from`/`$__to`) | ✅ |
| Dashboards | Row/section repeat | 🚧 |
| Dashboards | Annotations | 🚧 |
| Storage | Deterministic JSON/YAML/TOML files, one-field/one-line diff | ✅ |
| Storage | File watch → SSE live reload | ✅ |
| Storage | Git history (log/diff/restore), commit-on-save, remote sync | ✅ |
| Storage | Provisioned / `-readonly` mode | ✅ |
| Data | Prometheus via read-only proxy | ✅ |
| Data | Datasource auth: basic/bearer, custom headers, custom CA, mTLS | ✅ |
| Data | Non-Prometheus sources (SQL, Loki, traces) | ⛔ |
| Import | Grafana JSON and grafana.com import | ✅ |
| Auth | Local users + 3 roles + admin UI | ✅ |
| Auth | Reverse-proxy headers, OIDC (auth-code + PKCE, groups→role) | ✅ |
| Auth | LDAP | 🚧 |
| Auth | Per-dashboard ACLs, teams, multi-tenancy | ⛔ |
| Ops | Single Go binary (embedded SPA), Docker packaging | ✅ |
| Ops | Release pipeline (CalVer tags, prebuilt binaries, GHCR images) | ✅ |
| Ops | Runtime admin config (datasource, git remote) | ✅ |
| Alerting | Alerting, notifications, incident management | ⛔ |
| Plugins | Runtime-loadable third-party plugins (build-time only) | ⛔ |
| SaaS | bleemeo-panel embedding POC (§9) | 🚧 |
