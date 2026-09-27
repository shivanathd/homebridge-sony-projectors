# ADR-0009: Actionable error logging and diagnostics

- Status: **Accepted** · Date: 2026-09-27

## Context
The old plugin used `console.log("error in geting power state")` and then crashed. Users
can't tell a network problem from a wrong password or a projector in standby with network
management off.

## Decision
- **Typed errors with stable codes.** Each logs one line saying what happened, the likely
  cause, and how to fix it:
  | Code | Example message |
  |---|---|
  | `SPJ-NET-UNREACHABLE` | "Living Room Projector (192.168.1.40): no response on TCP 53595. Check the IP address and that [Remote Start] is On so the projector listens in standby." |
  | `SPJ-AUTH-FAILED` | "…ADCP password rejected. If you just changed it, the projector locks out for about 30 s after failed attempts." |
  | `SPJ-AUTH-MISSING` | "…projector requires an ADCP password; none configured." |
  | `SPJ-PROTO-UNSUPPORTED` | "…`aspect` isn't supported on VPL-VW295ES; the Aspect switches were disabled." |
  | `SPJ-BUSY` | "…power toggle ignored while cooling down (about 90 s)." |
  | `SPJ-COMMUNITY` | "…SDCP community mismatch (projector ≠ 'SONY')." |
- **De-duplication.** A repeating failure logs once, then a summary every 10 minutes ("still
  unreachable, 60 failures"), then an info line on recovery. This avoids log floods from
  the poll loop.
- **Levels.** Errors and warnings for things the user can act on. Info for state changes that
  came from outside HomeKit ("power turned on by IR remote"). Debug for protocol traffic,
  with the password redacted. A per-plugin `debug` option shows debug output without turning
  on debug for all of Homebridge.
- **Prefix.** Every line starts `[Projector name]`.
- **Diagnostics button in the custom UI** (ADR-0006 B): runs connect, handshake, then
  identity (model, serial, firmware, protocol, supported commands) and shows copy-pasteable
  output for bug reports, with secrets redacted.
- **docs/Troubleshooting.md** keyed by error code; every log line mentions its code so users
  can search for it.

## Implementation notes
Implemented in v0.1.0.
- `src/protocol/errors.ts` (codes and hints) and `src/lib/reporter.ts` (de-duplication, a 10-minute summary, recovery line).
- `docs/Troubleshooting.md` has one section per code, enforced by a test.
- The diagnostics view is the settings UI's projector info panel together with the plugin's `debug` option.
