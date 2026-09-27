# ADR-0004: HomeKit mapping, a Television accessory published externally

- Status: **Accepted** · Date: 2026-09-27

## Context
HomeKit allows one television per bridge and has no projector category. The Apple Home app
ignores custom characteristics, which is why the old plugin's aspect-ratio control is invisible.

## Decision
- One `Categories.TELEVISION` accessory per projector, published with
  `api.publishExternalAccessories` (paired separately). UUID from the projector serial
  (SDCP `0x8002` / ADCP `serialnum ?`), falling back to host.
- `Television` service: `Active` = power; `ActiveIdentifier` = HDMI input (`InputSource`
  services); `RemoteKey` = ADCP `key` / SDCP IR emulation; `PowerModeSelection` opens the
  projector menu.
- Picture mode and aspect ratio: **optional, config-gated, mutually exclusive `Switch`
  services** (subtype plus `ConfiguredName`), on the TV accessory or a bridged companion
  accessory. No custom characteristics.
- Warming and cooling map to `Active` with a "busy" guard: ignore toggles until the projector is stable.
- Unreachable: show "No Response" using `HapStatusError(SERVICE_COMMUNICATION_FAILURE)` on set,
  and `StatusActive=false` or an error update on the next poll.

## Consequences
Users pair the projector once per bridge. Several projectors work because each is external.

## Implementation notes
Implemented in v0.1.0. **Deviation:** accessory identity is `scopeSafeId(host)`, not the serial number. External accessories must be published at startup, even when the projector is unreachable, so the identity cannot wait for a network answer. Changing a projector's host creates a new accessory; this is documented.
