# ADR-0002: Dynamic platform, ESM TypeScript, Homebridge 1.8+/2.x, Node 22/24/26

- Status: Proposed · Date: 2026-09-27 · Applies if ADR-0001 = new plugin

## Context
Verification requires a dynamic platform. Accessory plugins and callback handlers are legacy.
Homebridge 2.4 is current; Node 20 support ended April 2026. UniFi Protect and the official
template are both ESM plus strict TypeScript.

## Decision
- `api.registerPlatform`, `pluginType: "platform"`, `singular: true`, with a `projectors[]` array.
- `"type": "module"`, TypeScript strict, `module: nodenext`, `verbatimModuleSyntax`,
  `noUncheckedIndexedAccess`, and `erasableSyntaxOnly` (use `as const` objects, not enums).
- `engines`: `"homebridge": "^1.8.0 || ^2.0.0"`, `"node": "^22.20.0 || ^24.0.0 || ^26.0.0"` (floor raised by ADR-0006).
- Keywords: `homebridge-plugin`, `supports-hap`.
- ESLint flat config with zero warnings allowed. Tests with `node:test`, and `.ts` run directly
  through Node's built-in type stripping.
- Exact-pinned dependencies, lockfile committed, and a `files` allow-list (checked with `npm pack --dry-run`).

## Consequences
One modern toolchain and no Babel or Jest. Supporting Homebridge 1.8 means we can't use
2.x-only APIs (Matter) without a runtime version check.

## Update 2026-09-27
The tsconfig and ESLint base come from `homebridge-plugin-utils` presets (ADR-0006).
