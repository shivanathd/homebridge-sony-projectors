# ADR-0007: Testing, security and release pipeline

- Status: **Accepted** · Date: 2026-09-27

## Decision
- **Tests** (`node:test`):
  - Protocol encode/decode golden tests from manual examples.
  - A **fake projector** TCP server (ADCP and SDCP) covering auth, timeouts, fragmentation,
    garbage input, and unreachable hosts.
  - Platform tests with a mocked HAP.
  - Regression test for S1: an unreachable projector must never crash the process.
- **CI** (GitHub Actions, Node 22/24/26):
  - lint, typecheck, test, `npm pack --dry-run`;
  - CodeQL, Semgrep, gitleaks, OSV-Scanner;
  - Dependabot for npm and Actions; Actions pinned by SHA.
- **Release**: tag, then a GitHub Release with notes, then publish through
  **npm trusted publishing (OIDC)** with automatic provenance. Package set to "disallow tokens".
  CHANGELOG.md is kept.
- **Runtime hygiene**:
  - Password field uses `widget: password`; it is never logged, and logs redact the config.
  - No telemetry, no post-install script, nothing written outside `api.user.storagePath()`.
  - SECURITY.md covers reporting and the LAN-trust model.
- **User guidance** (docs/Security.md): ADCP auth on with a non-default password, host
  allow-list set to the Homebridge IP, PJ Talk disabled when using ADCP, and an IoT VLAN.

## Implementation notes
Implemented in v0.1.0.
- `ci.yml`: Node × Homebridge matrix, lint, typecheck, build, package-content check, docs-freshness check, coverage.
- `security.yml`: CodeQL, npm audit, OSV-Scanner, gitleaks, and dependency review on pull requests. Also runs weekly.
- `release.yml`: npm trusted publishing (OIDC) with provenance.
- All actions are pinned to commit SHAs. Dependabot covers npm and actions.
