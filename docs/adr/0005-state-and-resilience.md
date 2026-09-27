# ADR-0005: Cached state, polling plus SDAP push, backoff, clean shutdown

- Status: **Accepted** · Date: 2026-09-27

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

## Implementation notes
Implemented in v0.1.0 (`src/projector/controller.ts`, `state.ts`).
- Polling: 10 s when on, 3× slower in standby, 2 s during warm-up and cool-down.
- Backoff doubles up to 60 s. An auth failure pauses for 30 s.
- The S1 crash has a regression test. The full lifecycle (unplug, No Response, recovery) was verified live on Homebridge 2.4 over HAP.
- The SDAP push listener in this decision is deferred to a later release (see ADR-0003). v0.1.0 relies on polling alone.
- After the v0.1.0 code review: each poll is one ADCP connection (`transport.poll()`); connecting is single-flight and abort-aware; HomeKit writes fail fast during a known outage, and sets are queued ahead of polls.
