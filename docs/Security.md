# Securing your projector

Sony's control protocols were designed for trusted AV networks. This page explains what they protect, what they do not, and how to set up your projector
and network.

## What the protocols protect

**ADCP** (current models) uses a challenge-response login. The projector sends a random challenge and the plugin answers with a SHA-256 hash of the challenge
and password, so the password itself never crosses the network. Commands and replies after the login are not encrypted.

**SDCP / PJ Talk** (older models) has no real authentication. Its 4-character "community" is sent in plain text, and the projector also broadcasts it every
30 seconds. Anyone on the same network segment can control an SDCP projector.

## Recommended settings on the projector

1. **Keep ADCP authentication on** and change the administrator password from the factory default (`Projector`). It is the same password as the web page.
2. **Set the host address allow-list** for ADCP (and PJ Talk, if used) to your Homebridge server's IP address, so only Homebridge can send commands.
3. **Turn off protocols you do not use.** If your projector supports ADCP, disable PJ Talk.
4. **Give the projector a DHCP reservation** so its address does not change and cannot be taken over.

## Recommended network setup

- Put AV equipment on a separate network (VLAN) that Homebridge can reach and that guest devices cannot.
- Do not forward the projector's ports (53595, 53484) to the internet.

## What the plugin does

- Values sent to the projector are checked against a strict character allow-list, so a setting cannot inject a second command.
- The password is never logged. Debug traces show `<auth hash>` instead of the hash.
- The settings UI's connection test never sends the password back to the browser.
- Only files inside the Homebridge storage directory are written (`sony-projectors.json`, holding input names and what was learned about each projector;
  no secrets).
- No analytics or network access other than to your projectors.
- The protocol code has no third-party runtime dependencies. Dependencies are pinned, and CI runs CodeQL, dependency audits (npm audit, OSV-Scanner) and a
  secret scan (gitleaks) on every change.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).
