# ADR-0001: Build a new plugin vs contribute to an existing one

- Status: **Accepted** (owner, 2026-09-27)
- Date: 2026-09-27
- Research: [research report](../research/2026-09-27-sony-projector-homebridge-research.md) §5–§7

## Context
The original `homebridge-sony-sdcp` is unmaintained and crashes Homebridge when the projector
is unreachable. `keremerkan/homebridge-sony-adcp` is verified, maintained and well built, but it
supports ADCP only, one projector, and no aspect ratio. Homebridge's verification rules reject a
new plugin that offers "the same or less functionality than an existing verified plugin".

## Options
1. **Use or contribute to keremerkan/homebridge-sony-adcp.** Upstream pull requests for aspect
   ratio, CI/lint/lockfile, a Node engines refresh, and protocol-client tests. Least effort;
   it depends on the maintainer accepting the changes.
2. **New plugin, both protocols.** ADCP first, SDCP fallback, SDAP power push, several
   projectors, aspect ratio, custom UI with connection test. Clearly more than the existing
   plugin, so it can be verified. Most effort.
3. **New plugin, SDCP only.** A modern replacement for Galala7/marckagan aimed at 2014–2016
   and older projectors. Small, and fills a real gap, but a shrinking audience.

## Decision
**Option 2: build our own plugin, supporting both protocols**, clearly better than anything
available. It adds Apple TV Remote-style control (ADR-0008), Shortcuts and Home automation
hooks (ADR-0008), safer protocol handling (ADR-0003, ADR-0007), and actionable error
logging (ADR-0009).

### Attribution
No code is copied. Everything is written clean-room from Sony's protocol manuals. We still
credit prior art in `CREDITS.md` and the README:
- Galala7/homebridge-sony-sdcp (MIT): original Homebridge SDCP plugin; our starting point.
- vokkim/sony-sdcp-com (MIT): SDCP command table.
- keremerkan/homebridge-sony-adcp (MIT): ADCP handshake behaviour observed on the XW5100
  (bare `OK` ack, brute-force lockout timing). Credited as a reference.
- Galala7/pySDCP, apaperclip/sony_projector_protocol (MIT): protocol and model matrix.
- hjdhjd/homebridge-unifi-protect (ISC): architecture inspiration.
- kennymc-c/ucr-integration-sonyADCP is **GPL-3.0**. We read it for facts only and never copy
  from it.

If any MIT code is ever adapted, its copyright notice is kept in the file header and in `CREDITS.md`.

## Consequences
We take on long-term maintenance and follow the 5-phase [roadmap](../roadmap.md). The plugin
must clearly exceed keremerkan's feature set to pass Homebridge verification: SDCP models,
several projectors, aspect ratio, remote, and automation sensors.

## Update 2026-09-27: audience
The owner chose **Public and Verified by Homebridge**. So:
- The npm package, GitHub Releases, and full docs are required.
- The verification checklist (research §7) is a release gate.
- The SDCP transport (roadmap Phase 4b) is in scope as a differentiator from keremerkan/homebridge-sony-adcp.

## Update 2026-09-27: name
The npm package is **`homebridge-sony-projectors`**, with platform alias `SonyProjectors`. The
name was free on npm on 2026-09-27. `homebridge-sony-projector` was unpublished by someone
else in 2025, so we avoid it to prevent confusion.
