# homebridge-sony-projectors

[![CI](https://github.com/shivanathd/homebridge-sony-projectors/actions/workflows/ci.yml/badge.svg)](https://github.com/shivanathd/homebridge-sony-projectors/actions/workflows/ci.yml)
[![Security](https://github.com/shivanathd/homebridge-sony-projectors/actions/workflows/security.yml/badge.svg)](https://github.com/shivanathd/homebridge-sony-projectors/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

HomeKit support for Sony home-cinema projectors. Your projector becomes a TV in the Home app, with an Apple TV Remote in Control Center, input selection,
picture-mode and aspect-ratio switches for scenes, and sensors that let automations react to warm-up and cool-down.

It talks to the projector directly on your network using Sony's own control protocols: **ADCP** for current models and **SDCP / PJ Talk** for older ones. It
picks the right one automatically.

## Features

- **TV tile.** Power and HDMI input, with the correct state even when someone uses the projector's IR remote.
- **Apple TV Remote.** Control Center > Remote > your projector: arrows, select and back drive the projector's menus, and Info opens the menu. Play/Pause
  toggles picture mute by default. Every button can be remapped.
- **Scenes and automations.** Optional switches per picture mode (Cinema Film 1, Reference, Game, ...) and per aspect ratio (Normal, 2.35 Zoom, ...), a Picture
  Mute switch, and "Projector Ready" and "Projector Cooling" sensors. All of them work in Home app scenes, automations and Shortcuts.
- **Honest status.** A projector that cannot be reached shows **No Response**, not a false "Off". Commands that fail are reported to HomeKit as failed.
- **Useful logs.** Every problem has a code (`SPJ-...`) and a sentence explaining how to fix it. A projector that is unplugged produces one warning, not one
  per poll, and a line when it comes back.
- **Settings UI.** A first-run screen tests the connection and detects the model. A Feature Options editor sets options globally or per projector, and only
  shows what that projector supports.
- **Safe by design.** No runtime dependencies in the protocol layer, every network operation has a timeout, values sent to the projector are validated, and the
  ADCP password never crosses the network or appears in logs.

## Supported projectors

| Protocol | Models | Notes |
|---|---|---|
| ADCP (TCP 53595) | VPL-VW 2016 and later (VW260/270/285/290/295/325, VW5xx/6xx/7xx/8xx/9xx, VW5000), VPL-XW5000/6000/7000/5100/6100/8100 | Full feature set, including the remote |
| SDCP / PJ Talk (TCP 53484) | Older VPL-VW and VPL-HW models | Power, input, picture mode, aspect, picture mute, lamp hours. No remote keys. |

Developed and tested against a VPL-VW290ES and simulated projectors. Reports from other models are welcome.

## Requirements

- Homebridge 1.8 or later (Homebridge 2 supported)
- Node.js 22.20 or later, 24 or 26
- The projector connected to your network by Ethernet

## Setup

### 1. Prepare the projector

In the projector's menu:

1. **Installation > Network Setting**: give it a fixed address, or better, set a DHCP reservation on your router.
2. **Installation > Remote Start**: **On**. Or set **Network Management** to **On**, which enables Remote Start and keeps the network active in standby.
   Without this, the projector stops listening in standby and cannot be turned on from HomeKit.

In the projector's web page (open its IP address in a browser):

3. Make sure **ADCP** is enabled. Note the administrator password: it is also the ADCP password (factory default `Projector`). Changing it is recommended; see
   [Security](docs/Security.md).

### 2. Install the plugin

Search for **Sony Projectors** in the Homebridge UI's Plugins tab, or run:

```bash
npm install -g homebridge-sony-projectors
```

Run it as a [child bridge](https://github.com/homebridge/homebridge/wiki/Child-Bridges) so it is isolated from other plugins.

### 3. Connect

Open the plugin's settings. The first-run screen asks for the projector's address and password, tests the connection, and saves it.

### 4. Add the TV to the Home app

HomeKit allows one TV per bridge, so each projector is published as its own accessory. In the Home app choose **Add Accessory > More options**, pick the
projector, and enter your Homebridge setup code. Switches and sensors, if enabled, appear on the bridge you have already paired.

## Configuration

Most people only need the settings UI. For reference, a full `config.json` entry:

```json
{
  "platform": "SonyProjectors",
  "projectors": [
    {
      "name": "Theater",
      "host": "192.168.1.50",
      "password": "your-projector-admin-password",
      "protocol": "auto",
      "pollInterval": 10
    }
  ],
  "options": [ "Enable.Picture.Switches", "Enable.Sensors.Ready" ],
  "debug": false
}
```

| Setting | Default | Description |
|---|---|---|
| `name` | `Projector` | Name in HomeKit. |
| `host` | (required) | IP address or hostname. |
| `password` | empty | ADCP password (the projector's web admin password). Leave empty if ADCP authentication is off. |
| `protocol` | `auto` | `auto`, `adcp` or `sdcp`. |
| `port` | protocol default | Only for non-standard ports. Needs an explicit `protocol`. |
| `community` | `SONY` | SDCP only: the PJ Talk community, if it was changed on the projector. |
| `pollInterval` | `10` | Seconds between checks while the projector is on (3-300). Standby is checked three times less often; warm-up and cool-down every 2 seconds. |
| `options` | none | [Feature options](docs/FeatureOptions.md). |
| `debug` | `false` | Log protocol traffic to the Homebridge log without turning on debug mode for all of Homebridge. |

## Documentation

- [Apple TV Remote, scenes and automations](docs/RemoteAndAutomations.md)
- [Feature options reference](docs/FeatureOptions.md)
- [Troubleshooting, by error code](docs/Troubleshooting.md)
- [Securing your projector](docs/Security.md)
- [Changelog](CHANGELOG.md)
- [Design: architecture decision records](docs/adr/) and the [research behind them](docs/research/2026-09-27-sony-projector-homebridge-research.md)

## Development

```bash
npm install
npm test                  # unit and integration tests, against simulated ADCP and SDCP projectors
npm run lint && npm run typecheck
npm run fake-projector    # a simulated VPL-VW290ES on 127.0.0.1:55595 (password: --password Projector)
npm run dev               # Homebridge with test/hbConfig, pointed at the simulated projector
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

This project stands on earlier work. See [CREDITS.md](CREDITS.md). Not affiliated with or endorsed by Sony.

## License

[MIT](LICENSE)
