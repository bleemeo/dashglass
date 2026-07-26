## Summary

<!-- What does this change, and why? -->

## Checklist

For user-visible changes (see [CONTRIBUTING.md → "Landing a feature"](../CONTRIBUTING.md#landing-a-feature)):

- [ ] **DESIGN.md §13** feature status updated (the single source of truth)
- [ ] **README** feature list updated if the pitch changed; how-to added to
      `docs/user-guide.md` if the feature needs one
- [ ] `pnpm generate-schema` re-run and the JSON Schema committed, if the model
      changed; cross-field checks mirrored in the Go validator
- [ ] Screenshot refreshed (`scripts/screenshots/run.sh`) if the UI changed
      materially
- [ ] Tests added; `pnpm test`, `pnpm typecheck` and `go test ./...` are green
