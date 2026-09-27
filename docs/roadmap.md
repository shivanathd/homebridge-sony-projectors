# Roadmap: Sony projector Homebridge plugin

**v0.1.0 (2026-09-27)** delivered phases 0 to 4b, except the SDAP listener. The remaining items are the SDAP listener, npm publication and Homebridge verification (phase 5), lens memory, and a Matter outlet.

Status: draft, sequenced 2026-09-27. Each phase ends with something shippable and tested.
Decisions live in [adr/](adr/); evidence is in the [research report](research/2026-09-27-sony-projector-homebridge-research.md).

## Phase 0: Decisions and scaffold
- ~~Projector model~~ (VPL-VW290ES) · ~~protocol priority~~ (ADCP first) · ~~audience~~ (public + verified) · ~~UI~~ (UniFi-style, homebridge-plugin-utils) · ~~name~~ (`homebridge-sony-projectors`).
- Repo: ESM TypeScript toolchain, lint, `node:test`, CI (lint, typecheck, test, CodeQL, Semgrep, gitleaks, OSV), Dependabot, SECURITY.md, CREDITS.md, LICENSE (MIT).
- **Exit:** CI green on an empty platform that refuses to start unless configured.

## Phase 1: Protocol core (no HomeKit)
- `AdcpClient` behind the `ProjectorTransport` interface; command queue and pacing; framing; typed errors; **capability probe** that detects supported commands and values per device (ADR-0003, ADR-0009).
- Real-hardware target: the owner's **VPL-VW290ES** (ADCP, auth on).
- Fake projector server for both protocols. Tests cover auth, fragmentation, timeouts, garbage input, and unreachable hosts (including a regression test for the S1 crash).
- A small CLI (`npx … probe <ip>`) for testing against real hardware.
- **Exit:** can control a real projector from the CLI; crash tests pass.

## Phase 2: MVP plugin
- Dynamic platform, `projectors[]` config, Television accessory published externally, power and HDMI inputs, cached reads, polling, backoff, clean shutdown (ADR-0004, ADR-0005).
- Error codes, de-duplicated logging, `docs/Troubleshooting.md` (ADR-0009).
- **Exit:** runs on a child bridge for 7 days without errors; shows "No Response" rather than the wrong state when the projector is unplugged.

## Phase 3: Remote, Shortcuts and automations
- Apple TV Remote key map, `PowerModeSelection` opening the menu, configurable Play/Pause (ADR-0008).
- Companion accessory: picture mode and aspect switches, momentary lens-memory and picture-mute actions, Ready/Cooling sensors, light-hours `FilterMaintenance`, `StatusFault`.
- Feature options to enable each group per projector.
- **Exit:** a documented "movie night" automation works end to end (projector Ready, then lights dim).

## Phase 4: Settings UI and diagnostics
- Custom UI (ADR-0006 C, homebridge-plugin-utils `webUi`): feature-options tree editor, first-run setup, "Test connection", "Detect model", diagnostics dump with secrets redacted.
- SDAP listener (optional): instant power updates and auto-discovery in the UI.
- **Exit:** a new user goes from install to working without editing JSON.

## Phase 4b: SDCP transport
- `SdcpClient` plus auto-probe fallback for pre-2016 models, tested against the fake projector only (no owner hardware).

## Phase 5: Release and verification
- npm trusted publishing (OIDC) with provenance, GitHub Releases, CHANGELOG.
- Docs: README, Configuration, Remote & Automations cookbook, Security hardening guide, Troubleshooting.
- Apply for Homebridge verification; the differentiators are listed in ADR-0001.
- Later: Matter power outlet (Homebridge ≥ 2.3).
