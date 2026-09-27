# ADR-0006: Dependency policy and settings UI

- Status: **Accepted: Option C** (owner, 2026-09-27)

## Context
UniFi Protect gets its feature options, web UI, retry, logging and service helpers from
`homebridge-plugin-utils` (hjdhjd). That is powerful, but it is a runtime dependency with its
own UI build step. keremerkan proves a zero-dependency plugin can be very good.

## Options
- **A. Zero runtime deps plus the stock schema form.** Simplest and smallest attack surface.
  No connection-test button.
- **B. `@homebridge/plugin-ui-utils` custom UI only** (Homebridge-owned, one dependency).
  Adds first-run setup, "Test connection" and "Detect model and protocol". Normal settings
  still use the schema form.
- **C. `homebridge-plugin-utils`** for the full UniFi-style feature-options UI. Richest,
  but depends on one individual's library, and it's overkill for about 10 options.

## Decision
**Option C: `homebridge-plugin-utils` (hjdhjd) plus `@homebridge/plugin-ui-utils`.** This gives
the full UniFi Protect-style experience:
- The feature-options tree editor, with Global and per-projector scopes and `Enable.X` /
  `Disable.X` / `Enable.X.Y=value` grammar. The catalog lives in `src/options.ts` and is the
  single source of truth for the UI, the docs (`prepare-docs`) and runtime.
- The `webUi` first-run flow. `onSubmit` calls our `server.js` `/probe` handler: connect,
  authenticate, read the projector identity, detect capabilities. This also covers the
  connection test and diagnostics from Option B.
- Library helpers we reuse instead of writing our own: `retry` / `exponentialBackoff`,
  `superviseLoop`, `TimerRegistry`, `prefixedLog`, `formatErrorMessage`,
  `acquireService` / `validService`, and `notResponding()` (library ≥ 2.4).
- Shared tsconfig and ESLint preset (supersedes the toolchain details in ADR-0002).

## Consequences and mitigations
- **Engines:** the library requires Node ≥ 22.20, so ours becomes
  `"node": "^22.20.0 || ^24.0.0 || ^26.0.0"`. The Homebridge range stays
  `^1.8.0 || ^2.0.0`, with CI testing both.
- **Supply chain:** it adds a single-maintainer dependency plus transitive `mqtt` and
  `undici`, even though we don't use MQTT. Mitigations:
  - pin the exact version;
  - Dependabot, with every library bump reviewed by diff;
  - OSV and `npm audit` in CI;
  - `npm pack` size budget.
- **Replaceability:** all library usage goes through `src/lib/` adapters (`options`, `log`,
  `retry`, `services`), so it can be swapped out if the library is abandoned.
- The protocol layer (ADR-0003) still imports **nothing** from it, so it stays zero-dependency and reusable.

## Implementation notes
Implemented in v0.1.0 (`homebridge-ui/`, `src/probe.ts`, `src/options.ts`). Capability metadata on the options (`meta.requires`) hides unsupported options per projector. Rendering and the first-run flow were verified in a browser against a stubbed Homebridge UI.
