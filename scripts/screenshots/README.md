# Demo screenshots

Reproducible screenshots of Dashglass for the README and docs. Everything is
deterministic: a fake Prometheus feeds seeded sine data, so the same dashboard
renders identically on every run.

## What's here

- `fake-prometheus.mjs` — dependency-free fake Prometheus (answers the
  read-only native API the proxy forwards) serving smooth, seeded data.
- `dashboards/demo.yaml` — the "Fleet overview" demo dashboard, exercising a
  **repeated panel** (`repeat` over `$instance`) and **data links** (drill-down
  URLs with `$instance` / `$__from` / `$__to`), plus gauge/stat/time-series.
- `capture.mjs` — drives headless Chrome over CDP and captures each target
  full-page in **light and dark** (there is no CLI flag for color scheme, so it
  emulates `prefers-color-scheme`). Output goes to `out/`.
- `run.sh` — boots the fake Prometheus and the current backend, then captures.

## Usage

The SPA dev server must be running first (it serves the app and proxies `/api`):

```sh
pnpm --filter dashglass dev        # http://localhost:3000
scripts/screenshots/run.sh         # writes PNGs to scripts/screenshots/out/
```

The backend runs with no configured users, so it is anonymous-admin — no login
step is needed. To promote an image to the docs, copy it out of `out/`:

```sh
cp scripts/screenshots/out/demo-overview-light.png docs/
```

## Tweaking

- **Which routes / viewport / settle time**: edit the `TARGETS` array at the top
  of `capture.mjs`.
- **Only one scheme**: `SCHEMES=light scripts/screenshots/run.sh`.
- **Chrome path** (non-macOS): set `CHROME=/path/to/chrome`.
- **The demo content**: edit `dashboards/demo.yaml`. The fake Prometheus returns
  data for any query; label values for `instance` (the repeat variable) are
  `web-1..web-3` — change `INSTANCES` in `fake-prometheus.mjs` to repeat over
  more tiles.

## Notes

- The SSE stream keeps the page in a "loading" state forever, so `capture.mjs`
  waits a fixed budget (`settle`) rather than for network idle.
- `out/` is throwaway; only copy the images you want into `docs/`.
