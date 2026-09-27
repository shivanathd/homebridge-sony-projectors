# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/).

## 0.1.0 (2026-09-27)

First release.

- Dynamic platform plugin for Homebridge 1.8+ and 2.x, Node.js 22.20+, 24 and 26.
- ADCP transport with SHA-256 challenge-response authentication, line framing, command pacing and capability discovery (`--info`).
- SDCP / PJ Talk transport for older projectors, with protocol auto-detection.
- Television accessory per projector: power, HDMI inputs (names and visibility remembered), Apple TV Remote keys, "View TV Settings" opens the menu.
- Optional companion accessory: picture-mode and aspect-ratio switches, Picture Mute, "Projector Ready" and "Projector Cooling" occupancy sensors, fault status.
- Feature options (global and per projector) with a UniFi Protect-style settings UI, first-run connection test and projector info panel.
- Coded errors (`SPJ-*`) with fixes in the log, de-duplicated failure logging with recovery messages, and a troubleshooting guide by code.
- No Response in HomeKit while a projector is unreachable; failed commands are reported to HomeKit as failed; no unhandled promise rejections.
