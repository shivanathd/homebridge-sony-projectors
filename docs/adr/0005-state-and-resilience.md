# ADR-0005: Cached state, polling plus SDAP push, backoff, clean shutdown

- Status: Proposed · Date: 2026-09-27

## Decision
- A per-projector `StateStore`. `onGet` returns cached values synchronously. `onSet` awaits
  the command, updates optimistically, re-reads, and reverts on failure.
- A poll loop, 10 s by default, each characteristic updated only when it changes. SDAP
  broadcasts (if enabled) update power immediately. Slower polling while in standby.
- Reconnect with exponential backoff (capped at 60 s). Authentication errors pause polling
  for 30 s (ADCP brute-force lockout) and log one clear, actionable message.
- One root `AbortController`, aborted on `APIEvent.SHUTDOWN`. All timers, sockets and the
  UDP listener hang off it.
- No `process.on('unhandledRejection')` workaround. Instead the loop is supervised and every
  promise is handled (a verification rule).

## Consequences
The Home app is never slow, even with the projector unplugged. State can lag the real device
by up to one poll interval unless SDAP push is on.
