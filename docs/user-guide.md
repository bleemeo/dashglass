# Dashglass user guide

How to build and operate dashboards. For the design and architecture, see
[DESIGN.md](../DESIGN.md); for the canonical list of what exists, see
[DESIGN.md §13](../DESIGN.md#13-feature-status).

- [Dashboards and panels](#dashboards-and-panels)
- [Variables](#variables)
- [Repeating panels](#repeating-panels)
- [Data links (drill-down)](#data-links-drill-down)
- [Time range and refresh](#time-range-and-refresh)
- [GitOps and history](#gitops-and-history)
- [Authentication](#authentication)
- [Importing from Grafana](#importing-from-grafana)

> Sections marked _(stub)_ are placeholders — contributions welcome.

## Dashboards and panels

_(stub)_ Dashboards are files (`.yaml` / `.json` / `.toml`) in the
dashboards directory. Edit them in the UI (`/d/:name/edit`), as code
(`/d/:name/code`), or in your editor + git. Panel kinds: time series, stat,
gauge, table, bar, heatmap, status grid, markdown.

## Variables

_(stub)_ Dashboard variables (`$instance`, `$job`) are declared on the
dashboard and interpolated into PromQL. List variables are fed by Prometheus
label values and can chain (a variable's query references another).

## Repeating panels

Repeat renders **one panel definition once per value of a variable** — define
a panel once, get a tile per instance, and the layout grows on its own as the
underlying set changes.

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
selected time range — into the target URL.

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
filters applied, and absolute URLs for external tools.

> Internal links currently trigger a full page load; an in-app navigation
> path is a planned refinement.

## Time range and refresh

_(stub)_ The toolbar sets the range and auto-refresh; drag-select on a chart
to zoom.

## GitOps and history

_(stub)_ When the dashboards directory is a git repo, the History drawer
browses versions (log/diff) and restores one. Optional commit-on-save and
remote pull/push sync close the loop.

## Authentication

_(stub)_ Fresh instances are open (anonymous admin) until you create the
first user. Local users have three roles; reverse-proxy headers and OIDC are
configured in `dashglass.yaml` (see
[dashglass.example.yaml](../dashglass.example.yaml)).

## Importing from Grafana

_(stub)_ Import a Grafana dashboard from a JSON export or by grafana.com ID;
unsupported panels are flagged per-panel rather than failing the import.
