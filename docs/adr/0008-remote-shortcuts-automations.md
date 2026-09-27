# ADR-0008: Apple TV Remote-style control, Shortcuts and automation surface

- Status: Proposed · Date: 2026-09-27

## Context
The owner wants Apple TV Remote-style control plus Shortcuts and automations. HomeKit gives
TV accessories a first-class remote: in iOS Control Center, a Television service with
`RemoteKey` appears in the **Apple TV Remote** picker. The Home app and the Shortcuts app can
only act on, and trigger from, **standard** services, so every feature has to map to one.

## Decision

### Remote (Control Center → Remote → pick the projector)
| iOS Remote control | HomeKit | ADCP | SDCP |
|---|---|---|---|
| Arrow pad | `RemoteKey` ARROW_* | `key "up/down/left/right"` | IR emulation `0x17xx` |
| Select (centre) | SELECT | `key "enter"` | IR emulation |
| Back | BACK | `key "reset"` (fallback: `key "menu"`) | IR emulation |
| Info (ⓘ) | INFORMATION | `key "menu"` (configurable) | IR emulation |
| Play/Pause | PLAY_PAUSE | `blank` toggle (picture mute), configurable | `0x0030` toggle |
| "View TV Settings" | `PowerModeSelection` | `key "menu"` | IR emulation |
| Volume buttons | `TelevisionSpeaker` | Off by default (projectors have no speaker); optional mapping to lens zoom or light output | none |

- Every key mapping can be overridden in config. Values are validated against the command allow-list (ADR-0003).
- Key presses bypass the poll pacing (they have priority) but are still serialized.

### Shortcuts and Home automations
Actions (usable in Scenes, automations and the Shortcuts "Control Home" action):
- **Power** (`Active`) and **Input** (`ActiveIdentifier`), both native.
- **Picture mode** and **aspect ratio** as mutually exclusive switches: "Cinema Film 1",
  "Game", "2.35:1 Zoom", and so on. Config picks which ones are exposed.
- **Momentary actions** (stateless switches that turn off again after 1 s):
  "Picture Mute", "Lens Memory 1–5" (`pic_pos_sel`), "Menu". A Shortcut or a scene button
  can then fire a lens-memory recall.

Triggers (sensors other automations react to):
- **"Projector Ready"** occupancy sensor: detected only when power is fully ON (not warming).
  For example, "when the projector is ready, dim the lights and lower the screen".
- **"Projector Cooling"** contact sensor: automations can wait for cool-down before cutting
  power at a smart plug.
- **Light source hours** via `FilterMaintenance` (`FilterLifeLevel`, `FilterChangeIndication`)
  against a configurable life limit, shown natively in the Home app.
- **Fault** via `StatusFault` on the TV service from `error ?` / `warning ?`. Error text is logged.

Everything beyond power and input is **off by default** and enabled per projector through
feature options, so users who only want a TV tile get a clean one.

### Later (not in the MVP)
A Matter power outlet (Homebridge ≥ 2.3) for Google/Alexa users. HomeKit "TV scenes" are
already covered by the switches above.

## Consequences
Sensors and switches live on a bridged **companion accessory**, because extra services on an
external TV tile get cluttered. Each projector is then one external TV plus one bridged
companion, and the UUIDs of both derive from the serial number.
