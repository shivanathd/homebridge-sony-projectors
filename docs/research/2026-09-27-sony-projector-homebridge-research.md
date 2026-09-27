# Sony projector × Homebridge: research, security review, build-vs-reuse

Date: 2026-09-27 · Status: complete · Feeds: [ADRs](../adr/) and [roadmap](../roadmap.md)

## 1. Question

Can we build our own Homebridge plugin for Sony projectors, better than
[Galala7/homebridge-sony-sdcp](https://github.com/Galala7/homebridge-sony-sdcp), using
[hjdhjd/homebridge-unifi-protect](https://github.com/hjdhjd/homebridge-unifi-protect) as the
quality bar? And should we?

Short answer: yes, it's feasible. The protocols are small and everything relevant is MIT-licensed.
But a verified, maintained ADCP plugin already exists, so a new plugin has to justify itself
(see §6 and ADR-0001).

## 2. Plugins surveyed

| Plugin | Protocol | Last activity | Shape | Verdict |
|---|---|---|---|---|
| Galala7/homebridge-sony-sdcp 0.0.3 | SDCP (via `sony-sdcp-com`) | Code 2018; npm 2017 | 160 lines JS, accessory plugin, callbacks | Unmaintained, crashes (see §3) |
| marckagan/homebridge-sony-sdcp-v2 0.1.0 | SDCP (same `sony-sdcp-com`) | 2026-08 | Homebridge 2 port of the above | Keeps the abandoned library |
| keremerkan/homebridge-sony-adcp 1.0.7 | ADCP only | 2026-09-27 | ~1,070 lines TS, verified, zero runtime deps | **Current best option** (§5) |
| steven-ward/homebridge-sony-adcp-projector 2.3.2 | ADCP | 2026-02 | Warm/cool state machine, 200 ms pacing | Active, unverified |
| hjdhjd/homebridge-unifi-protect | n/a (quality bar) | active | ESM TS + `homebridge-plugin-utils` | Reference architecture |

## 3. Security and quality review of homebridge-sony-sdcp

### Scans (all run 2026-09-27)

| Tool | Scope | Result |
|---|---|---|
| `npm audit` | Dependency tree (`sony-sdcp-com@0.0.2` → `baconjs@0.7.89`) | 0 vulnerabilities |
| OSV-Scanner 2.6.0 | Lockfile | No issues |
| Semgrep (`p/javascript`, `p/nodejs`, `p/secrets`, `p/security-audit`) | Plugin + library source | 0 findings |
| Gitleaks 8.30.1 | Full git history (10 commits) | No leaks |

No known CVEs and no secrets. The attack surface is small: outbound TCP only, no listener,
no `eval` or `child_process`. **The problems are reliability and protocol-level, not
dependency CVEs.**

### Findings from manual review

| # | Severity | Finding | Evidence |
|---|---|---|---|
| S1 | **High (availability)** | `setPower()` / `setAspectRatio()` promises are fire-and-forget. If the projector is unreachable, the rejection is unhandled and **the Node process exits**. That takes down Homebridge, or the child bridge if one is used. | `index.js:118-126`, `index.js:62-94`. Reproduced: `ERR_UNHANDLED_REJECTION`, exit 1, Node 26. Upstream issue vokkim/sony-sdcp-com#5 reports the same. |
| S2 | Medium (protocol) | SDCP has no real authentication. The "community" string (default `SONY`) is sent in plaintext and **broadcast by the projector every 30 s** over SDAP (UDP 53862). Anyone on the network segment can power-cycle the projector. | Sony VPL-VW320/520 protocol manual §4 |
| S3 | Low | The community string isn't configurable in the plugin, so a user who changed it can't connect. Changing it adds no security anyway (S2). | `index.js:22` |
| Q1 | Medium | Getters do network I/O with a 5 s timeout. That trips HAP's 3 s slow-handler warning and can stall the whole bridge. | `index.js:52`, `index.js:99`; library default timeout 5000 ms |
| Q2 | Medium | Errors in getters return `0` ("Off") instead of throwing `HapStatusError`, so the Home app shows the wrong state rather than "No Response". | `index.js:57-60`, `index.js:111-115` |
| Q3 | Medium | Aspect ratio is a **custom characteristic**, which the Apple Home app ignores (Eve and similar apps only). | `sony-characteristics.js` |
| Q4 | Low | Implicit global `PORT = 53484` (no `var`). Throws in strict mode or ESM. | `index.js:5` |
| Q5 | Low | Legacy accessory plugin with `.on('get'/'set')` callbacks. No `config.schema.json` (no settings UI). `engines` don't declare Homebridge 2. Can't be verified. | `index.js:14`, `package.json` |
| Q6 | Low | Hard-coded identity: Model "Projector", Serial "123456". | `index.js:39-41` |
| L1 | Low | The library assumes each TCP `data` event is one whole response (no framing). It opens a new socket per command. Its data-length byte is encoded in *decimal*, which is wrong for payloads of 10 bytes or more. The library is abandoned (two releases, both January 2017). | `raw-client.js:32-36`, `raw-client.js:107` |

## 4. Protocol facts (Sony)

- **SDCP / PJ Talk** (TCP 53484): binary request/response.
  - Header: `02 0A <community:4> <00 set|01 get> <item:2> <len:1> <data>`.
  - One command in flight at a time. 30 s idle timeout. Item codes include power `0x0130`/`0x0102`, input `0x0001`, picture preset `0x0002`, aspect `0x0020`, and model/serial `0x8001`/`0x8002`.
- **SDAP** (UDP 53862): 30 s broadcast carrying model, serial and **power status**. This is the only push signal available.
- **ADCP** (TCP 53595): ASCII lines ending in CRLF.
  - Greeting is `NOKEY`, or a nonce that the client answers with `sha256hex(nonce + password)` and gets back `ok`/`err_auth`. The password never crosses the wire.
  - Documented default password: `Projector` (the web admin password).
  - Commands follow `cmd "value"` / `cmd ?`, e.g. `power`, `power_status`, `input`, `picture_mode`, `aspect`, `blank`, `timer`, `modelname`, `serialnum`.
  - **No push**, so everything needs polling. One implementation says commands sent too fast get dropped and paces them 200 ms apart.
- **Which models speak which**: XW5000/6000/7000/5100/6100/8100 speak both. VW models from roughly 2016 speak both. For the 2014–16 VW/HW generation, ADCP support is disputed; probe at runtime. Pre-2014 models are SDCP only.
- **Security guidance for users**: keep ADCP auth on and change the default password. Set the projector's "Host address" allow-list to the Homebridge IP. Disable PJ Talk if unused. Use an IoT VLAN.

## 5. How keremerkan/homebridge-sony-adcp measures up

Scans: gitleaks clean, `npm audit` 0, Semgrep 0 findings. It has zero runtime dependencies.

**Strengths:**
- Dynamic platform. Television accessory published externally. `onGet` returns cached state.
- Serialized ADCP client with proper line framing and handshake (`src/adcp-client.ts`).
- Rejects quotes and control characters in user-configured command values, which stops command injection (`platform.ts:228`, `:245`).
- Reverts HomeKit state when a command fails. Very good operator-facing error messages. Optional Matter outlet.

**Gaps against the UniFi-Protect bar:**
- ADCP only, so no SDCP fallback for older projectors.
- **No aspect ratio control.**
- One projector per install (`singular`, single `host`). No SDAP-driven power updates.
- No CI, no lint, no lockfile. Tests cover only the Matter module; the protocol client has none.
- `engines` still lists Node 18/20, which Homebridge no longer supports.
- No custom settings UI (e.g. "test connection").
- `platform.ts` is a 740-line monolith.

Most of these could be contributed upstream as pull requests.

## 6. What "UniFi-Protect-grade" means for a projector plugin

Keep: ESM TypeScript with strict settings; separate protocol client from HomeKit mapping;
`configureAccessory` only stores cached accessories and the real work starts at
`didFinishLaunching`; `onGet` returns cached state and `onSet` awaits and then re-syncs;
feature options (`Enable.X` / `Disable.X`) resolved once; retry with backoff; one
`AbortController` for shutdown; prefixed logs; custom UI first-run screen with a connection
test; CI with provenance publishing via npm trusted publishing (OIDC).

Skip: multi-controller layering, MQTT, FFmpeg, removal-grace timers, the 3.8k-line test rig,
doc-chrome tooling.

## 7. Homebridge 2026 baseline

- Homebridge 2.4.0 is current (2.0 went stable 2026-05-04).
- Node support: 22 / 24 / 26 (20 ended April 2026). Recommended `engines`: `"homebridge": "^1.8.0 || ^2.0.0", "node": "^22.12.0 || ^24.0.0 || ^26.0.0"`.
- Verified-plugin rules:
  - Dynamic platform.
  - `config.schema.json`.
  - A GitHub release for every version.
  - No post-install scripts, no analytics, no unhandled exceptions.
  - Must not start unless configured.
  - Files written only under `api.user.storagePath()`.
  - Must not offer the same or less functionality than an existing verified plugin. **This directly affects a new ADCP-only plugin.**
- HomeKit:
  - One television per bridge, so publish externally with `Categories.TELEVISION` (there is no PROJECTOR category).
  - The Apple Home app ignores custom characteristics, so picture mode and aspect ratio must be standard `Switch` services (mutually exclusive, config-gated) or `InputSource`s.
