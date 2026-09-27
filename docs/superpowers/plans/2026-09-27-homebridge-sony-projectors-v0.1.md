# homebridge-sony-projectors v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.1 of an open-source Homebridge platform plugin that controls Sony projectors (ADCP and SDCP) as HomeKit TVs with remote, automation hooks, safe networking and a UniFi-style settings UI.

**Architecture:**
- `src/protocol/` is a zero-dependency transport layer (ADCP and SDCP clients behind one interface, typed `SPJ-*` errors).
- `src/projector/` maps a transport onto a cached `StateStore` and HomeKit services.
- `src/platform.ts` handles lifecycle only.
- Feature options, logging helpers and the webUI come from `homebridge-plugin-utils`, reached through `src/lib/` adapters.

**Tech Stack:** TypeScript 5.9 (ESM, strict, `.ts` imports), Node ≥ 22.20 (tests run `.ts` directly via type stripping), `node:test`, Homebridge 2.4 (dev) with 1.8+ supported, homebridge-plugin-utils 2.4.0, @homebridge/plugin-ui-utils 2.2.6, ESLint 9 (hbpu preset).

**Executed inline by the author of the plan.** Tasks list exact files, public signatures and the concrete test cases. Implementation code is written during execution under TDD (test first, then fail, then implement, then pass, then commit).

---

## File map

```
package.json, tsconfig.json, tsconfig.build.json, eslint.config.mjs, .npmignore, .gitignore, .nvmrc
LICENSE, README.md, CHANGELOG.md, CREDITS.md, SECURITY.md, CONTRIBUTING.md, config.schema.json
src/index.ts                  default export: registerPlatform
src/settings.ts               PLUGIN_NAME, PLATFORM_NAME, defaults, Subtype table (as const)
src/options.ts                featureOptionCategories + featureOptions catalog
src/config.ts                 parse/validate raw config -> ProjectorConfig[] (+ issues[])
src/platform.ts               SonyProjectorsPlatform (DynamicPlatformPlugin)
src/lib/log.ts                projector-prefixed + debug-gated logger over hbpu
src/lib/reporter.ts           ErrorReporter: de-duplicated, coded, recovery-aware logging
src/protocol/errors.ts        ErrorCode, ProjectorError, isProjectorError, hint text
src/protocol/types.ts         PowerState, ProjectorIdentity, Capabilities, RemoteKeyName, ProjectorTransport
src/protocol/queue.ts         CommandQueue (serialize + pacing + abort)
src/protocol/adcp.ts          AdcpTransport
src/protocol/adcp-parse.ts    pure parsers (reply, json list, info, timer, power)
src/protocol/sdcp.ts          SdcpTransport
src/protocol/sdcp-codec.ts    pure encode/decode + code tables
src/protocol/detect.ts        createTransport(config): auto-probe ADCP -> SDCP
src/projector/state.ts        StateStore (typed snapshot, change events)
src/projector/controller.ts   ProjectorController: poll loop, commands, capabilities, reachability
src/projector/tv.ts           TelevisionAccessory (external)
src/projector/companion.ts    CompanionAccessory (bridged, cached)
src/projector/names.ts        persisted input names/visibility (storagePath JSON)
homebridge-ui/server.js       /probe, /getOptions
homebridge-ui/public/index.html, ui.mjs, config-helpers.mjs
test/helpers/fake-adcp.ts     fake ADCP projector server
test/helpers/fake-sdcp.ts     fake SDCP projector server
test/helpers/fake-api.ts      Homebridge API double built on real hap-nodejs
src/**/*.test.ts              colocated unit tests
docs/*.md                     README-linked docs, ADRs, research
.github/workflows/ci.yml, security.yml, release.yml; .github/dependabot.yml; issue templates
```

## Task 1: Scaffold and toolchain
- Files: package.json (engines, scripts, exact pins, keywords `homebridge-plugin`, `supports-hap`, funding, repository), tsconfig*.json extending `homebridge-plugin-utils/build/tsconfig.plugin.json`, eslint.config.mjs using `homebridge-plugin-utils/eslint`, .npmignore allow-list, .gitignore, LICENSE (MIT), `src/index.ts` and `src/settings.ts` stub.
- Scripts: `build`, `build-ui` (`homebridge-plugin-utils prepare-ui homebridge-ui/public/lib`), `lint`, `typecheck`, `test` (`node --test "src/**/*.test.ts" "test/**/*.test.ts"`), `prepublishOnly`.
- Verify: `npm run typecheck && npm run lint && npm test` all exit 0; `npm pack --dry-run` lists only dist, homebridge-ui, config.schema.json, docs, LICENSE, README, CHANGELOG.
- Commit: `chore: scaffold ESM TypeScript plugin`

## Task 2: Errors and types (protocol/errors.ts, protocol/types.ts)
- `ErrorCode` as const: `NET_UNREACHABLE='SPJ-NET-UNREACHABLE'`, `NET_TIMEOUT`, `NET_CLOSED`, `AUTH_FAILED`, `AUTH_REQUIRED`, `PROTO_UNSUPPORTED`, `PROTO_REJECTED`, `PROTO_INVALID`, `BUSY`, `COMMUNITY`, `ABORTED`.
- `class ProjectorError extends Error { code; hint; detail? }`, `hintFor(code, ctx)`.
- `PowerState = 'standby'|'warming'|'on'|'cooling'|'unknown'`.
- `ProjectorTransport`:
  - `protocol`;
  - `identify()`, `capabilities()`;
  - `getPower`/`setPower`, `getInput`/`setInput`, `getPictureMode`/`setPictureMode`, `getAspect`/`setAspect`, `getBlank`/`setBlank`;
  - `getLightHours`, `getFaults`, `sendKey(key)`;
  - `close()`.
- Tests: error code and hint mapping; `isProjectorError` narrowing.
- Commit.

## Task 3: CommandQueue (protocol/queue.ts)
- `new CommandQueue({ pacingMs })`, `run<T>(fn, { priority? }) → Promise<T>`, `close()`.
- Tests:
  - runs strictly one at a time;
  - keeps ≥ pacingMs between commands;
  - a rejected job doesn't block the next;
  - a priority job jumps waiting jobs;
  - after `close()`, pending jobs reject with `ABORTED`.

## Task 4: ADCP parsers (protocol/adcp-parse.ts)
- Pure functions:
  - `parseReply(line)` returns `{ok}` or `{value}` or `{error:'err_cmd'...}`;
  - `parsePower(value)` maps standby/saving_standby to standby, startup to warming, on to on, cooling1/cooling2/saving_cooling* to cooling;
  - `parseJsonList(value)`;
  - `parseInfoRange(json)`;
  - `parseTimer(value)` handles JSON `[{"light_src":1234}]`, a bare number, or null;
  - `hashChallenge(nonce, password)`;
  - `isSafeToken(v)` allows only `[a-z0-9_.]`.
- Tests: each parser, including the quoted `"on"` form, `err_*` forms, malformed JSON, and injection strings rejected by `isSafeToken`.

## Task 5: Fake ADCP projector (test/helpers/fake-adcp.ts)
- `startFakeAdcp({ password?, state?, fragment?, delayMs?, garbageGreeting?, closeAfterGreeting? })` returns `{ port, state, received[], close() }`.
- Implements the NOKEY greeting or a nonce, hash check (`ok` / `err_auth`), `power`, `power_status ?`, `input`, `picture_mode`, `aspect`, `blank`, `key`, `timer ?`, `error ?`, `warning ?`, `modelname ?`, `serialnum ?`, `version ?`, `? --info` ranges.
- Returns `err_inactive` for picture queries in standby and `err_cmd` for unknown commands.
- Simulates warm-up and cool-down timing (configurable ms).

## Task 6: AdcpTransport (protocol/adcp.ts)
- Constructor `{ host, port=53595, password?, timeoutMs=5000, pacingMs=200, log? }`.
- One short-lived connection per command via the queue. CRLF framing with a 4 KiB buffer cap. Auth handshake. Errors are mapped to `ProjectorError`.
- Tests against the fake:
  - NOKEY path;
  - auth success and wrong password (`AUTH_FAILED`), and password missing (`AUTH_REQUIRED`);
  - fragmented replies;
  - timeout;
  - connection refused (`NET_UNREACHABLE`);
  - `err_inactive` maps to `BUSY`, `err_cmd` to `PROTO_UNSUPPORTED`, other `err_*` to `PROTO_REJECTED`;
  - set rejects unsafe tokens without touching the network;
  - `capabilities()` builds inputs, picture modes and aspects from `--info` and falls back to defaults;
  - the password never appears in debug output.

## Task 7: SDCP codec and transport (protocol/sdcp-codec.ts, sdcp.ts, test/helpers/fake-sdcp.ts)
- Codec:
  - `encode(action, item, data?, community='SONY')` gives the 10-byte header plus data, with the length in **binary** (fixes old-library bug L1);
  - `decode(buf)` returns `{ ok, item, data | errorCode }`;
  - a `FrameReader` that accumulates a header and then its length.
- Tables for power, input, calibration preset, aspect, model and serial, mapped to the same tokens ADCP uses.
- Transport tests against the fake: power, input, preset, aspect round-trips; community mismatch (`0201`) maps to `COMMUNITY`; NG `0180` maps to `BUSY`; fragmented frames.

## Task 8: Detection (protocol/detect.ts)
- `createTransport(cfg)`: `adcp` or `sdcp` explicitly; `auto` tries ADCP (reads the greeting within the timeout), otherwise SDCP `identify`.
- Returns `{ transport, protocol }`, or throws the most informative error.
- Tests: auto picks ADCP when both fakes are up; picks SDCP when only SDCP is up; `NET_UNREACHABLE` when neither is.

## Task 9: Config parsing (src/config.ts)
- `parseConfig(raw) → { projectors: ProjectorConfig[], issues: string[] }`.
- Rejects a missing host and duplicate hosts. Protocol is `auto` by default. Validates port and poll interval (min 3 s, max 300 s) and input names.
- `id = scopeSafeId(host)`.
- Tests for each rule.

## Task 10: Feature options catalog (src/options.ts)
Categories: Device, Remote, Picture, Aspect, Controls, Sensors, Log.
- **Device:** `''` default true.
- **Remote:**
  - `''` default true;
  - `PlayPause` value, default `blank`, choices blank, menu, none;
  - `Info` value, default `menu`;
  - `Back` value, default `return`.
- **Picture:** `Switches` default false.
- **Aspect:** `Switches` default false.
- **Controls:** `PictureMute` default false.
- **Sensors:** `Ready` default false; `Cooling` default false.
- **Log:** `Commands` default true; `ExternalChanges` default true.

Test: the catalog passes `buildCatalogIndex` and every option expands to a unique name.

## Task 11: ErrorReporter and logger (src/lib/log.ts, reporter.ts)
- `ErrorReporter(log, { summaryEveryMs=600000, clock })`:
  - `failure(err)` logs the first occurrence per code at warn or error, then suppresses repeats and emits a summary ("still failing: N times") every interval;
  - `success()` after failures logs info "recovered after N failures".
- Tests use the hbpu `capturingLog` and a fake clock.

## Task 12: StateStore (src/projector/state.ts)
- Snapshot `{ reachable, power, input, pictureMode, aspect, blank, lightHours, faults[] }`.
- `update(partial)` emits `change(key, value, previous)` only on a real change.
- Tests.

## Task 13: ProjectorController (src/projector/controller.ts)
- Holds the transport factory, store, reporter and signal.
- `start()` runs under `superviseLoop`:
  1. connect or detect with `retry` and `exponentialBackoff` (ceiling 60 s);
  2. identify;
  3. capabilities, re-probed once after the first time power reaches ON;
  4. poll every N s (standby is 3× slower): power; then input, mode, aspect, blank if on; lamp hours every 10 min; faults every 60 s.
- On an auth failure, pause 30 s.
- Commands: `setPower`, `setInput`, `setPictureMode`, `setAspect`, `setBlank`, `sendKey`. Each goes through the reporter and store, reverts on failure, and refuses power while warming or cooling (`BUSY`).
- Tests with the fake ADCP and a short poll interval:
  - state converges;
  - an external change is detected and logged;
  - unreachable leads to `reachable=false` with one warning;
  - **the S1 regression: `setPower` against an unreachable host rejects without an unhandled rejection** (hbpu `assertNoUnhandledRejections`);
  - abort stops all timers.

## Task 14: Fake Homebridge API (test/helpers/fake-api.ts)
- Real `@homebridge/hap-nodejs` for `hap`, and homebridge's `PlatformAccessory` class.
- Records register, unregister, publishExternal and update calls. An EventEmitter for `didFinishLaunching` and `shutdown`. `user.storagePath()` points to a temp directory.

## Task 15: TelevisionAccessory (src/projector/tv.ts, names.ts)
- Category TELEVISION; published externally.
- AccessoryInformation fields.
- Television service: Active, ActiveIdentifier, ConfiguredName, SleepDiscoveryMode, RemoteKey, PowerModeSelection.
- InputSource per capability input (Identifier starts at 1), with persisted names and visibility.
- Tests:
  - onGet returns the cache;
  - onSet Active calls the controller;
  - a failure throws `HapStatusError`;
  - RemoteKey maps through options (PlayPause blank toggles blank);
  - store changes push `updateCharacteristic`.

## Task 16: CompanionAccessory (src/projector/companion.ts)
- Bridged and cached; UUID `generate(id + ':companion')`.
- Services are added or removed by options via hbpu `validService` and `acquireService` with subtypes from `settings.Subtype`:
  - picture-mode switches and aspect switches (mutually exclusive, and turning off the active one is refused and re-synced);
  - Picture Mute switch;
  - Ready and Cooling occupancy sensors, with `StatusFault` from faults.
- If every group is disabled, the companion is unregistered.
- Tests for each group and for mutual exclusion.

## Task 17: Platform (src/platform.ts, src/index.ts)
- Collect cached accessories in `configureAccessory`. On `didFinishLaunching`: parse config, log issues, create a controller, TV and companion per projector, and unregister stale companions.
- `shutdown` aborts everything.
- Does nothing, with one info line, when no projectors are configured.
- Tests using the fake API and fake ADCP: end-to-end power on from HomeKit reaches the fake; stale accessory swept; no config leads to no start.

## Task 18: config.schema.json
- `pluginAlias SonyProjectors`, `pluginType platform`, `singular`, `customUi`.
- `projectors[]` with name, host (`format: hostname`), protocol (auto/adcp/sdcp), port, password (`widget: password`), community (`widget: password`), pollInterval.
- `options[]` and `debug`.
- Layout sections. Test: the schema parses and its enum values match the `config.ts` constants.

## Task 19: Custom webUI (homebridge-ui/)
- `server.js`:
  - `/probe {host, protocol, port, password, community}` returns identity, capabilities and power, or `{error, code, hint}`;
  - `/getOptions` returns the catalog from `../dist/options.js`.
- `public/ui.mjs`:
  - webUi firstRun (host and password, then Test Connection, which saves the projector);
  - `getControllers` returns the configured projectors (`serialNumber` = scope id);
  - `getDevices` probes and returns the projector itself as a controller-device;
  - `infoPanel` shows model, serial, protocol, lamp hours and power.
- `index.html` has the WEBUI LOADER CONFIG. `npm run build-ui` stamps it.
- Verify: open index.html in a browser with a stubbed `homebridge` global; first-run and feature-options pages render (screenshot).

## Task 20: Docs
README (features, install, projector setup incl. Remote Start/Network Management, ADCP password), docs/Configuration.md, docs/FeatureOptions.md (`prepare-docs`), docs/RemoteAndAutomations.md, docs/Troubleshooting.md (by error code), docs/Security.md, CHANGELOG.md, CREDITS.md, SECURITY.md, CONTRIBUTING.md, issue templates.

## Task 21: CI and release workflows
- ci.yml: matrix Node 22.20/24/26 × Homebridge 1.11.4/2.4.0: `npm ci`, lint, typecheck, test, build, `npm pack --dry-run`, `prepare-docs --check`.
- security.yml: CodeQL (JS/TS), gitleaks, OSV-Scanner, and `npm audit --omit=dev` weekly and on PRs.
- release.yml: on GitHub release publish, `npm publish` via OIDC trusted publishing (`id-token: write`).
- dependabot.yml: npm and actions weekly. Actions pinned to commit SHAs.

## Task 22: Final verification and publish repo
- Full local run: lint, typecheck, test, build, pack, gitleaks, OSV, Semgrep.
- Run Homebridge locally (`homebridge -D -U ./test/hbConfig`) against the fake projector and check the logs.
- `gh repo create shivanathd/homebridge-sony-projectors --public`, push, confirm CI is green, tag v0.1.0 as a GitHub pre-release. **No npm publish.**
