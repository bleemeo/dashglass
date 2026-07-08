# Contributing to Dashglass

Thanks for your interest in Dashglass. This is a small, focused project;
issues and pull requests are welcome.

## Development setup

Dashglass is a pnpm monorepo (TypeScript, React) plus a Go backend.

```sh
pnpm install
pnpm test          # all workspace tests (vitest)
pnpm typecheck     # all packages + app (tsc)

cd backend
go test ./...      # backend tests
```

Run the app against your own Prometheus during development — the vite dev
server proxies `/api` to the backend:

```sh
# terminal 1: backend on :8080
cd backend && go run . -prometheus-url http://localhost:9090 -dashboards-dir ../dashboards
# terminal 2: vite on :3000
pnpm --filter dashglass dev
```

`pnpm build-binary` produces the single `./dashglass` binary with the SPA
embedded.

See [README.md](./README.md) for the repository layout and
[DESIGN.md](./DESIGN.md) for the data model, plugin system and the design
rationale — please read DESIGN.md before proposing an architectural
change.

## Ground rules

- **The file format is the product.** Serialization stays deterministic
  and git-friendly: stable key order, defaults omitted, a one-field edit
  produces a one-line diff. There is a test asserting this — keep it
  passing.
- **After changing the Zod schemas** in `packages/model`, run
  `pnpm generate-schema` (in that package) to regenerate the backend's
  JSON Schema, and mirror any cross-field check in the Go validator.
- **The Prometheus proxy is read-only.** Never expose write/admin
  Prometheus endpoints through it.
- **Everything in the repository is in English** — code, comments,
  docs, commit messages, PR descriptions.
- Add tests for new behavior, and make sure `pnpm test`,
  `pnpm typecheck` and `go test ./...` are green before opening a PR.

## Pull requests

Keep changes focused and describe the motivation. Small, reviewable
commits with clear messages are appreciated. CI runs the test, typecheck
and lint suites plus a Docker smoke test; they must pass.

## Reporting bugs

Open an issue with the steps to reproduce, what you expected, and what
happened instead. For security issues, follow [SECURITY.md](./SECURITY.md)
instead of opening a public issue.
