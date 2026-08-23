# Dashglass user guide

How to build and operate dashboards. For the design and architecture, see
[DESIGN.md](../DESIGN.md); for the canonical list of what exists, see
[DESIGN.md §13](../DESIGN.md#13-feature-status).

![A Dashglass dashboard: gauge, stat and time-series panels, a panel repeated
across every $instance, and drill-down links in the panel headers.](screenshot-light.png)

- [Dashboards and panels](#dashboards-and-panels)
- [Variables](#variables)
- [Repeating panels](#repeating-panels)
- [Data links (drill-down)](#data-links-drill-down)
- [Time range and refresh](#time-range-and-refresh)
- [GitOps and history](#gitops-and-history)
- [The Prometheus connection](#the-prometheus-connection)
- [Authentication](#authentication)
- [Importing from Grafana](#importing-from-grafana)

## Dashboards and panels

Every dashboard is a file (`.yaml` / `.json` / `.toml`) in the dashboards
directory. You edit it in the UI and it stays a git-friendly file — a
one-field edit produces a one-line diff.

**Create one** with **New dashboard** (top right of the Dashboards page):
give it a title and a file name (auto-slugified; one `/` allowed to put it in
a folder), and either start **blank** or **import from Grafana** (see below).
On an empty instance the home screen also offers one-click **example
dashboards** ("Prometheus overview", "Prometheus internals") built from
metrics Prometheus exposes about itself, so they show data on any install.

**Two editors** for an existing dashboard:

- **Visual editor** (`/d/:name/edit`) — a 24-column grid:
  - **Move/resize** a panel by dragging its header or its resize corner.
  - **Sections** group panels; add one with **Add section** and give it an
    optional title.
  - **Add panel** (per section) drops in a Time series panel and opens its
    editor; **Edit** and **✕** appear on hover over a panel.
  - **Undo/Redo** (`⌘Z` / `⇧⌘Z`), **Save** (`⌘S`, only when there are
    changes) or **Discard**. The grid below the toolbar is a **live preview**
    with the real variables and time range.
- **As-code editor** (`/d/:name/code`) — the raw file in your chosen format,
  validated on save (schema errors are shown inline). Anything the visual
  editor can't express yet you can always write here.

**The panel editor** (the drawer in the visual editor) has: **Title**,
**Description** (shown on the dashboard as an ⓘ marker in the panel header,
with the text as its tooltip; variables are interpolated in it), **Type**;
the type-specific options (below); **Queries**
(a PromQL expression plus a **Legend format** like `{{instance}} —
{{mountpoint}}`); **[Links](#data-links-drill-down)**; and
**[Repeat](#repeating-panels)**.

### Panel types

Common options: **Unit** (short, percent, bytes, bytes/s, seconds, …) and, on
value panels, **Thresholds** (ordered value → status of `warning` / `serious`
/ `critical`; below the first threshold is "good").

| Type | Use for | Key options |
|---|---|---|
| **Time series** | metrics over time | unit; legend `bottom`/`right`/`hidden`; stack; fill area; Y min/max |
| **Stat** | one big number + sparkline | unit; calculation `last`/`mean`/`min`/`max`/`sum`; decimals; sparkline; thresholds |
| **Gauge** | a value within a range | unit; min (0) / max (100); thresholds (color the arc) |
| **Table** | series as rows | unit; thresholds (cell color + in-cell bar) |
| **Bar** | compare series | unit; calculation; orientation; sort |
| **Heatmap** | histogram (`le` buckets) over time | bucket unit (de-cumulates Prometheus buckets) |
| **Status grid** | many entities' health as a honeycomb | value mapping (Nagios `0=OK` / boolean up-down / custom); reduce (last/min/max/mean); name label; tile order (worst-first/query); tiles per row; max tiles |
| **Text (Markdown)** | notes/headings | Markdown content (raw HTML not rendered) |
| **Image** | a static image | URL; alt text; fit (`contain` default / `cover` / `fill`) |
| **Clock** | wall-clock (great in kiosk mode) | format (time / datetime / date / long date / ISO); UTC; font size |

## Variables

Variables become **toolbar selectors** and are interpolated into your
queries. Edit them from the **Variables…** button in the editor. Two kinds:

- **Label values** — options come from Prometheus label values. Fields:
  **Name** (the `$name` identifier), **Label** (toolbar display name),
  **Label name** (the Prometheus label to list, e.g. `instance`), **Default
  value**, **Allow "All"**, **Allow multiple**, and **Matchers** (one series
  selector per line to narrow the values).
- **Text** — a fixed value; tick **Constant** to hide it from the toolbar
  (handy for a value referenced in queries but not meant to be changed).

**Reference** a variable in PromQL as `$name` or `${name}`:

```promql
rate(node_cpu_seconds_total{instance=~"$instance"}[5m])
```

- **"All"** (when *Allow "All"* is on) resolves to the regex `.+`, so use it
  with a regex matcher (`=~`).
- **Multiple** values render as a regex alternation (`a|b|c`, each escaped),
  again for `=~`. A single value is inserted verbatim (safe for `=`).

**Chaining** — a variable's *Matchers* can reference another variable, so its
options depend on the current selection:

```promql
node_uname_info{instance=~"$instance"}   # this variable's values follow $instance
```

Selections are mirrored into the URL as `var-<name>=<value>` (repeated per
value for multi-select), so a dashboard link is shareable with its filters.

## Repeating panels

Repeat renders **one panel definition once per value of a variable** — define
a panel once, get a tile per instance, and the layout grows on its own as the
underlying set changes. The *Per-node CPU* row in the screenshot at the top of
this guide is a single panel repeated across `$instance`.

Configure it in the panel editor under **Repeat → Repeat by variable** (pick
the variable; optionally choose a direction), or in the file:

```yaml
panels:
  cpu:
    kind: Panel
    spec:
      display:
        name: CPU — $instance      # the title interpolates per instance
      repeat:
        variable: instance         # repeat over this variable
        direction: horizontal      # optional: horizontal (default) | vertical
        # maxPerRow: 3             # optional cap on tiles per row
      plugin:
        kind: TimeSeriesChart
      queries:
        - kind: TimeSeriesQuery
          spec:
            plugin:
              kind: PrometheusTimeSeriesQuery
              spec:
                query: rate(node_cpu_seconds_total{instance="$instance"}[5m])
```

Behavior:

- It repeats over the variable's **current selection**, or over **all of its
  options** when "All" is selected.
- Each instance pins the variable to its own value, so every tile runs its
  **own interpolated query** (`instance="web-1"`, `instance="web-2"`, …).
- Put the variable in the panel title (`CPU — $instance`) so each tile labels
  itself.
- Horizontal tiles wrap to new rows and push the panels below them down;
  `vertical` stacks them in one column.

Keep a repeated panel alone on its grid row — that is what the editor
produces and what the reflow is tuned for.

> Repeating a whole **row/section** (rather than a single panel) is planned.

## Data links (drill-down)

Data links turn a panel into a jumping-off point: they appear in the panel
header and carry the **current context** — dashboard variables and the
selected time range — into the target URL. The *Runbook*, *Node detail* and
*Metrics* links in the screenshot's panel headers are data links.

Configure them in the panel editor under **Links** (title + URL, and whether
to open in a new tab), or in the file:

```yaml
panels:
  network:
    kind: Panel
    spec:
      display:
        name: Network throughput
      links:
        # Internal drill-down: another dashboard, context carried over.
        - title: Node detail
          url: /d/node-detail?var-instance=$instance&from=$__from&to=$__to
        # External tool, opened in a new tab.
        - title: Runbook
          url: https://wiki.example.com/runbook/$job
          targetBlank: true
      plugin:
        kind: TimeSeriesChart
```

What gets interpolated into the URL:

- **Variables** — `$name` / `${name}`, percent-encoded (multi-value joined
  with commas).
- **Time range** — `$__from` and `$__to`, epoch milliseconds of the current
  range.

Use relative URLs (`/d/…`) to drill into another dashboard with the same
filters applied (the receiving dashboard restores them from the `var-…`
params), and absolute URLs for external tools.

> Internal links currently trigger a full page load; an in-app navigation
> path is a planned refinement.

## Time range and refresh

The dashboard toolbar controls the window every panel queries:

- **Time range** — presets **Last 5m / 15m / 1h / 6h / 24h / 7d**, or
  **Custom…** for an absolute From/To range.
- **Auto-refresh** — off / 10s / 30s / 1m / 5m — and a **Refresh now** button.
- Defaults come from the dashboard file (`spec.duration`,
  `spec.refreshInterval`); the *current* range is not written back — it lives
  in the URL (`?from=now-1h`, or `?from=<ms>&to=<ms>` for absolute), so a link
  is shareable.

**Zoom** by dragging a rectangle across any time-series chart (sets an
absolute range); **double-click** a chart to zoom out ×2; re-pick a preset to
reset.

**Fullscreen a panel** by clicking its title ("View fullscreen"); it opens in
place (`?viewPanel=<key>`), with **Esc** or **Back to dashboard** to leave.

**The panel menu** (**⋯**, on hover in the panel header) acts on the
*resolved* query — variables and the repeat instance already applied:

- **View fullscreen** — same as clicking the title, and the only way in for
  an untitled panel.
- **Explore query** — opens the expression in **Explore** with the panel's
  time range, to iterate on it without touching the dashboard. One entry per
  query when the panel has several; ⌘/middle-click opens a new tab.
- **Copy PromQL** — the expression to the clipboard, for a terminal or an
  alerting rule.

**Kiosk mode** (toolbar button, or `?kiosk=1`) hides the nav, banners, and the
whole toolbar for wall displays — press **Esc** to exit. Pair it with a Clock
panel and auto-refresh for a NOC screen.

## GitOps and history

When the dashboards directory is a git repository, Dashglass reads its history
straight from git (it needs the `git` binary on PATH and the directory inside
a git work tree; otherwise the History features are hidden).

- **History drawer** (toolbar → **History**) lists the commits touching this
  dashboard (short hash, subject, author, relative time); expand one to see a
  **diff against the current file**. **Restore this version** writes the old
  content back as a normal save — uncommitted, so you review and commit it in
  git (or let commit-on-save do it).
- **Commit-on-save** (`git.commit_on_save` in `dashglass.yaml`) commits every
  UI save, **authored by the signed-in user** so `git blame` stays honest.
- **Remote sync** pulls on an interval and pushes right after a commit; on a
  diverged history it rebases, and if that conflicts it stops and asks you to
  resolve it in the repo. Configure it in `dashglass.yaml` under `git.remote`
  (or from **Admin → Git sync**); credentials (HTTPS token or SSH deploy key)
  are stored server-side and never put on a command line.
- **Provisioned / read-only** (`-readonly`, or `dashboards.readonly: true`)
  makes the API refuse writes and the UI drop every edit affordance — the
  dashboards are managed entirely by editing the files in git. Even admins
  cannot save in this mode.

## The Prometheus connection

The browser never talks to Prometheus: every query goes through the
backend's read-only proxy, and the connection settings (including all
credentials) stay server-side. Point Dashglass at Prometheus with
`-prometheus-url` / `DASHGLASS_PROMETHEUS_URL` / `prometheus.url` in
`dashglass.yaml` — provisioning it this way locks the admin UI — or
configure it at runtime from **Admin → Datasource**.

Authentication towards Prometheus: **basic auth** (native Prometheus
`web.config.yml`, or a reverse proxy in front) or a **bearer token**.
Beyond credentials:

- **Extra headers** are sent with every upstream request — the
  Mimir/Cortex tenancy header (`X-Scope-OrgID: tenant-1`), or a custom
  `Authorization` scheme with the auth mode left on "none".
- **CA certificate (PEM)** verifies a self-signed or private-CA
  Prometheus endpoint properly (it replaces the system trust store for
  this connection).
- **Client certificate + key (PEM)** enable **mTLS**, Prometheus's
  native `client_auth_type: RequireAndVerifyClientCert`.
- **Skip TLS verification** is the last resort when the certificate
  cannot be fixed — anyone on the network path can then impersonate the
  datasource, so prefer the CA field.

In `dashglass.yaml` the TLS material is provisioned as file paths
(`prometheus.ca_file`, `client_cert_file`, `client_key_file`,
`insecure_skip_verify`, plus `headers`) — see
[dashglass.example.yaml](../dashglass.example.yaml). Configured from the
admin UI, certificates are pasted as PEM and persisted server-side
(`settings.yaml`, mode 0600); the client key is write-only and never
shown again. **Test connection** probes the full stack — TLS, headers
and credentials — before saving.

## Authentication

A **fresh instance is open**: until the first user exists, everyone is an
anonymous **admin** so you can set things up. A banner reminds you of this.

**Enable auth** by creating the first user in **Admin → Users → Create the
first user** (it must be an admin). From then on everyone signs in.

**Roles** are cumulative:

| Role | Can |
|---|---|
| **viewer** | view dashboards, query Prometheus, browse git history |
| **editor** | + create / edit / delete dashboards, import from grafana.com |
| **admin** | + everything under Admin: users, datasource, git sync |

The last admin cannot be deleted or demoted; passwords are at least 8
characters. (Read-only mode overrides roles — nobody can write.)

**Automated / break-glass:**

- `DASHGLASS_BOOTSTRAP_ADMIN_PASSWORD=…` creates an `admin` user at startup if
  none exists.
- `dashglass user add <name> [role]` (also `passwd`, `rm`) manages local users
  from the CLI (role defaults to admin).

**Identity providers** are configured in `dashglass.yaml` under `auth:`
(annotated reference: [dashglass.example.yaml](../dashglass.example.yaml)).
`${ENV}` references expand from the environment, so secrets stay out of the
file; precedence is **flags > environment > file > defaults**, and anything
provisioned by the deployment shows read-only in the admin UI. Every provider
shares one **group → role** rule (`role_mapping`): the highest match wins,
`*` matches any authenticated user, and **no match means access is denied** —
a shared IdP grants nothing until a group is listed.

### Connecting an identity provider

Add the block below to `dashglass.yaml` and restart. The default local login
stays available only until you enable a provider that replaces it.

#### OpenID Connect (OIDC)

Native OIDC (Authentik, Keycloak, Pocket ID, Auth0, Okta…). Dashglass runs the
authorization-code flow itself — no reverse proxy required.

1. In your IdP, register an application (confidential client,
   authorization-code + PKCE) and set its **redirect URI** to
   `https://<your-dashglass-host>/api/auth/oidc/callback`.
2. Collect the **issuer** URL, **client ID** and **client secret**, and make
   sure the ID token carries a **groups** claim.
3. Configure it (put the secret in the environment):

   ```yaml
   auth:
     oidc:
       issuer: https://auth.example.com/application/o/dashglass/
       client_id: dashglass
       client_secret: ${OIDC_CLIENT_SECRET}
       redirect_url: https://dashglass.example.com/api/auth/oidc/callback
       groups_claim: groups          # optional (default "groups")
       role_mapping:
         admin: [dashglass-admins]
         editor: [dev-team]
         viewer: ["*"]               # any authenticated user can view
   ```

4. Set `OIDC_CLIENT_SECRET` and restart. The login page now offers your
   provider; each user's role is derived from their groups.

Default scopes are `openid profile email groups`; the username is taken from
`preferred_username`, then `email`, then `sub`. A user whose groups match no
rule is denied (never silently defaulted to viewer).

If the provider's certificate cannot be verified (self-signed, or missing
SANs — Go rejects certificates that only carry the legacy Common Name),
`insecure_skip_verify: true` disables TLS verification towards the provider.
This lets anyone on the network path impersonate the issuer, so treat it as
a stopgap and prefer fixing the certificate.

#### Reverse proxy

If an authenticating proxy already fronts Dashglass (Authelia, Authentik,
oauth2-proxy, Tailscale…), let it be the identity source — setting
`user_header` disables local login.

```yaml
auth:
  proxy:
    user_header: Remote-User
    groups_header: Remote-Groups        # optional
    trusted_proxies: ["10.0.0.0/8"]     # only honor headers from these peers
    role_mapping:
      admin: [dashglass-admins]
      editor: [dev-team]
      viewer: ["*"]
```

Set `trusted_proxies` to the proxy's address range. Leave it unset **only**
if the backend is unreachable except through the proxy — otherwise anyone who
can reach the backend directly could spoof the identity headers.

#### LDAP

Not available yet — LDAP is planned
([DESIGN.md §13](../DESIGN.md#13-feature-status)). In the meantime, put a
reverse proxy in front or use OIDC (most directories expose an OIDC bridge).

## Importing from Grafana

In the **New dashboard** dialog, open **▸ Import from Grafana**:

- **From grafana.com** — paste a dashboard URL or its numeric id and press
  **Load** (available unless the instance runs with `-disable-grafana-com`;
  the backend only accepts a numeric id and only talks to `grafana.com`, to
  rule out SSRF).
- **JSON export** — paste or upload the JSON from Grafana's *Share → Export*.

Conversion runs in the browser and is **best-effort**. It maps the common
panels (time series/graph, stat/singlestat, gauge, table, bar gauge/bar
chart, heatmap, text), turns Grafana rows into sections, converts PromQL
targets (rewriting `[[var]]`/`${var:fmt}` templating and `legendFormat`), and
migrates `label_values(...)` and constant/textbox variables.

Anything it can't map is **imported as-is** (never dropped): an unmapped panel
keeps its Grafana type and renders as an "unknown panel" you can fix later,
and every approximation is listed under **"Imported with approximations:"** so
there are no silent surprises. Review the result in the editor before saving.
