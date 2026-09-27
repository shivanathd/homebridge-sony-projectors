# ADR-0003: In-house protocol clients; ADCP first, SDCP fallback, SDAP listener

- Status: Proposed · Date: 2026-09-27

## Context
`sony-sdcp-com` is abandoned and unsafe (unhandled rejections, no framing, wrong length
encoding). No maintained Node ADCP library exists. Both protocols are small: SDCP is an
11-byte header; ADCP is text lines plus a SHA-256 handshake.

## Decision
Build a `src/protocol/` module with **no HomeKit imports**:
- `ProjectorTransport` interface: `getPower()`, `setPower()`, `getInput()`, `setInput()`,
  `getPictureMode()`, `setPictureMode()`, `getAspect()`, `setAspect()`, `getIdentity()`.
- `AdcpClient` (TCP 53595) and `SdcpClient` (TCP 53484) implement it, each with:
  - a serialized command queue, with configurable pacing (default 200 ms);
  - length- or CRLF-based framing, and a maximum buffer size;
  - a timeout on every call, and typed errors (`timeout|socket|auth|protocol|unsupported`);
  - **every promise awaited or caught**.
- `auto` mode: probe ADCP (read the greeting), fall back to SDCP; cache the result per projector.
- `SdapListener` (UDP 53862, optional): pushes power state and discovery. Off by default,
  because containers and VLANs often block broadcast.
- Values from user config that go into ADCP commands are allow-list validated (no quotes or control characters).
- Written from Sony's protocol manual and MIT-licensed references only. GPL sources
  (ucr-integration-sonyADCP) may be read for facts but not copied.

## Consequences
Zero runtime dependencies for the protocol layer. We own correctness, so it needs
fake-projector tests (ADR-0007).

## Update 2026-09-27: owner hardware is the VPL-VW290ES
- **ADCP confirmed.** Sources: the VW290ES/VW325ES operating instructions (Sony 50311341M)
  list ADCP as the network control protocol, and the `sony_projector_protocol`
  capability matrix places it in the "VW290ES/VW270ES" ADCP series. SDCP on port 53484 is
  **not documented** for this model.
- Its ADCP value sets:
  - inputs `hdmi1`, `hdmi2`;
  - picture modes `cinema_film1`, `cinema_film2`, `reference`, `tv`, `photo`, `game`,
    `brt_cinema`, `brt_tv`, `user`.
- Factory defaults: auth **On**, password `Projector` (same as the web admin password), 60 s idle timeout.
- Power-on over the network needs **Installation → Remote Start = On**, or
  **Network Management = On**, which enables Remote Start automatically.
- Lamp-based: `timer ?` reports lamp hours. The lens is believed to be **manual**, which
  would make `pic_pos_sel` (lens memory) unsupported. This is unverified, so the capability
  probe must detect it (`err_cmd` / `err_inactive`) and hide the feature automatically.
- **Consequence:** ADCP is built and tested first against this device. SDCP moves to a
  later phase and ships only if the old-model differentiator is still wanted (ADR-0001).
