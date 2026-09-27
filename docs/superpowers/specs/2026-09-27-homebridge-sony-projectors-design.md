# homebridge-sony-projectors: design spec (v0.1)

Date: 2026-09-27 · Status: approved by owner ("go ahead, build it") · Decisions: [ADR-0001…0009](../../adr/)

## Goal
An open-source, Homebridge-verifiable plugin that turns Sony home-cinema projectors into
first-class HomeKit TVs. It adds:
- Apple TV Remote control;
- Home and Shortcuts automation hooks;
- safe networking (no crash paths) and actionable, de-duplicated error logging;
- a UniFi Protect-style settings UI.

## Scope of v0.1
| In | Out (later) |
|---|---|
| ADCP transport (auth, framing, pacing, capability discovery with `--info`) | SDAP push listener |
| SDCP transport (basic: power, input, picture preset, aspect, identity) | Matter outlet |
| Several projectors, each an external Television accessory | TelevisionSpeaker / volume |
| Inputs, Remote keys, "View TV Settings" → menu | Lamp-life HomeKit service (the Home app shows it as unsupported) |
| Companion accessory: picture-mode switches, aspect switches, Picture Mute switch, Ready/Cooling occupancy sensors, `StatusFault` on Ready | npm publish (owner sets up trusted publishing) |
| Feature options via homebridge-plugin-utils, custom webUI with first-run and projector probe | |
| Error codes, de-duplicated reporter, Troubleshooting doc | |
| CI: lint, typecheck, test (Node 22/24/26 × Homebridge 1.11/2.4), CodeQL, gitleaks, OSV, Dependabot | |

## Deviations from the ADRs (recorded here and in the ADRs)
1. **Accessory identity is `scopeSafeId(host)`**, not the serial number. External accessories
   must be published at startup, even when the projector is unreachable. If you change the
   host, it becomes a new accessory; this is documented.
2. **Cooling is an OccupancySensor**, not a ContactSensor. It's simpler to automate on
   ("when Cooling stops detecting").
3. **Lamp hours** are shown in the settings UI and logs, not as FilterMaintenance.
4. **Lens memory** is deferred. The VW290ES has a manual lens (ADR-0003); add it once
   verified on a motorised model.

## Behaviour contract
- `onGet` never does I/O. `onSet` awaits the transport, throws
  `HapStatusError(SERVICE_COMMUNICATION_FAILURE)` on failure, and reverts cached state.
- No promise is left unhandled. The poll loop runs under `superviseLoop`, and a regression
  test proves an unreachable projector can't crash the process.
- Power toggles during warm-up or cool-down are refused with `SPJ-BUSY` (logged once) and the
  displayed state is corrected.
- The password is never logged. Debug protocol traces redact the auth hash.
