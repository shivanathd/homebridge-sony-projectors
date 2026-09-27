# Apple TV Remote, scenes and automations

## Apple TV Remote

Open **Control Center > Remote** (add Apple TV Remote to Control Center in Settings if it is missing) and choose your projector at the top.

| Remote button | Projector | Change it with |
|---|---|---|
| Arrows | Menu navigation | |
| Select (centre) | Enter | |
| Back | Return | `Enable.Remote.Back=<action>` |
| Info (i) | Menu | `Enable.Remote.Info=<action>` |
| Play/Pause | Toggle picture mute (blank screen) | `Enable.Remote.PlayPause=<action>` |
| "View TV Settings" in the Home app | Menu | |

The actions available are `menu`, `return`, `enter`, `blank` (toggle picture mute) and `none`. Turn the remote off entirely with `Disable.Remote`.

Remote keys are available on ADCP projectors. SDCP projectors do not accept key commands.

## Switches for scenes

Enable any of these in the Feature Options tab. They appear on a "Controls" accessory next to the TV.

| Feature option | Adds |
|---|---|
| `Enable.Picture.Switches` | One switch per picture mode the projector reports: "Cinema Film 1 Mode", "Reference Mode", "Game Mode", and so on. |
| `Enable.Aspect.Switches` | One switch per aspect ratio: "Aspect Normal", "Aspect 2.35 Zoom", and so on. |
| `Enable.Controls.PictureMute` | "Picture Mute": blanks the image without turning the projector off. |

Picture-mode and aspect switches work like radio buttons. Turning one on selects it and turns the others off. The active one cannot be turned off, because
the projector is always in some mode; select a different one instead.

Picture settings only apply while the projector is on. If a switch is used while the projector is in standby, it springs back and the log explains why
(`SPJ-BUSY`). For scenes that turn the projector on, trigger the picture settings from the Ready sensor instead (see below).

## Sensors for automations

| Feature option | Sensor | Detects |
|---|---|---|
| `Enable.Sensors.Ready` | Projector Ready | The picture is fully on (warm-up finished). |
| `Enable.Sensors.Cooling` | Projector Cooling | The projector is cooling down after being turned off. |

The Ready sensor also reports a **fault** in the Home app when the projector reports an error or warning (for example, a lamp or temperature warning). The
details are in the Homebridge log.

## Recipes

**Movie night.** Automation: *When Projector Ready detects occupancy* > set a scene that dims the lights, closes the blinds, and turns on "Cinema Film 1 Mode".
Starting it from the Ready sensor instead of the power switch means the scene runs once the picture is actually on.

**Gaming.** The projector only accepts input and picture changes once it is on, so split it in two. Scene "Game": turn on the projector. Automation: *When
Projector Ready detects occupancy* > select the console's HDMI input and turn on "Game Mode". (If you also use a movie-night automation on the same sensor,
use a Shortcut to choose which one runs.)

**Scope content.** Scene "Scope": turn on "Aspect 2.35 Zoom". Pair it with a masking or screen controller if you have one.

**Safe power-off at a smart plug.** Automation: *When Projector Cooling stops detecting occupancy* > turn off the plug. Never cut power during cool-down; it
shortens lamp life.

**Shortcuts.** The Shortcuts app's "Control Home" action can set any of the above, so you can build "Movie mode" buttons for the Home Screen or Siri.
