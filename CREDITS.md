# Credits

homebridge-sony-projectors is an independent, clean-room implementation. No code was copied from the projects below, but they informed its design and are
gratefully acknowledged.

| Project | License | What it contributed |
|---|---|---|
| [Galala7/homebridge-sony-sdcp](https://github.com/Galala7/homebridge-sony-sdcp) | MIT | The original Homebridge plugin for Sony SDCP projectors, and the starting point for this project. |
| [vokkim/sony-sdcp-com](https://github.com/vokkim/sony-sdcp-com) | MIT | SDCP command table. |
| [Galala7/pySDCP](https://github.com/Galala7/pySDCP) | MIT | SDCP item codes and value tables. |
| [apaperclip/sony_projector_protocol](https://github.com/apaperclip/sony_projector_protocol) | MIT | SDCP value tables and the model-to-protocol matrix. |
| [keremerkan/homebridge-sony-adcp](https://github.com/keremerkan/homebridge-sony-adcp) | MIT | Observed ADCP authentication behaviour on real hardware (the `ok` acknowledgement and brute-force lockout). |
| [steven-ward/Homebridge-Sony-ADCP-Projector-Plugin](https://github.com/steven-ward/Homebridge-Sony-ADCP-Projector-Plugin) | MIT | ADCP remote key names and reply formats. |
| [tokyotexture/home-assistant-sony-adcp](https://github.com/tokyotexture/home-assistant-sony-adcp) | Apache-2.0 | ADCP `--info` syntax variants and JSON list replies. |
| [hjdhjd/homebridge-unifi-protect](https://github.com/hjdhjd/homebridge-unifi-protect) | ISC | Architecture and settings-UI patterns. The settings page markup is adapted from it. |
| [hjdhjd/homebridge-plugin-utils](https://github.com/hjdhjd/homebridge-plugin-utils) | ISC | Feature options, settings UI framework, lint and TypeScript presets (a dependency). |

Protocol details also come from Sony's published protocol manuals for the VPL-VW320/VW520 (SDCP) and the Sony projector ADCP documentation.

Sony, VPL and the related product names are trademarks of Sony Group Corporation. This project is not affiliated with or endorsed by Sony.
