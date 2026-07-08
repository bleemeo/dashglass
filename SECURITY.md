# Security policy

## Reporting a vulnerability

Please report security issues **privately**, not through public issues or
pull requests.

The preferred channel is GitHub's private vulnerability reporting: open
the repository's **Security** tab and choose **Report a vulnerability**.
This opens a private advisory visible only to the maintainers.

Please include:

- a description of the issue and its impact,
- the steps or a proof of concept to reproduce it,
- the affected version or commit.

We aim to acknowledge a report within a few working days and will keep
you informed as we investigate and prepare a fix. Please give us a
reasonable window to release a fix before any public disclosure.

## Scope and posture

A few design points worth knowing when assessing Dashglass:

- **The Prometheus proxy is read-only**: only an allowlisted set of
  native query/metadata endpoints is forwarded; write and admin paths
  are never exposed.
- **Datasource and git credentials stay server-side.** They are never
  sent to the browser; the git remote token/SSH key reaches git through
  askpass / `GIT_SSH_COMMAND`, never on a command line.
- **Authentication is opt-in.** A fresh instance is open (anyone who can
  reach it has admin access) until the first user is created or an
  external identity provider is configured — see the README. Do not
  expose an unauthenticated instance to an untrusted network.
- Server-managed secrets (session secret, stored credentials) are
  written to owner-only (`0600`) files.

Reports about the intentionally-open first-run state, or about instances
deliberately run without authentication, are not considered
vulnerabilities.
