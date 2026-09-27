/* options.ts: The feature options catalog.
 *
 * This one catalog drives the settings UI's feature options editor, the generated docs/FeatureOptions.md and runtime behaviour, so the three cannot drift apart.
 * Options are written in config.json as `Enable.<Category>.<Option>` or `Disable.<Category>.<Option>`, optionally scoped to one projector by appending its id,
 * for example `Enable.Picture.Switches.192-168-8-50`. Value options use `Enable.<Category>.<Option>=<value>`.
 */
import type { FeatureCategoryEntry, FeatureOptionChoice, FeatureOptionEntry } from "homebridge-plugin-utils";

// What a remote button can be mapped to. Values are ADCP key names, plus two actions that are not keys.
const REMOTE_ACTIONS: FeatureOptionChoice[] = [

  { label: "Menu", value: "menu" },
  { label: "Back (return)", value: "return" },
  { label: "Select (enter)", value: "enter" },
  { label: "Toggle picture mute (blank screen)", value: "blank" },
  { label: "Do nothing", value: "none" }
];

export const featureOptionCategories: FeatureCategoryEntry[] = [

  { description: "Projector options.", name: "Device" },
  { description: "Apple TV Remote options (Control Center > Remote).", name: "Remote" },
  { description: "Picture mode options.", name: "Picture" },
  { description: "Aspect ratio options.", name: "Aspect" },
  { description: "Additional controls.", name: "Controls" },
  { description: "Sensors for Home automations.", name: "Sensors" },
  { description: "Logging options.", name: "Log" }
];

export const featureOptions: Record<string, FeatureOptionEntry[]> = {

  Aspect: [

    { default: false, description: "Add a switch per aspect ratio (Normal, 2.35:1 Zoom, ...) for scenes and automations. Turning one on selects that aspect.",
      name: "Switches" }
  ],
  Controls: [

    { default: false, description: "Add a Picture Mute switch that blanks the image without turning the projector off.", name: "PictureMute" }
  ],
  Device: [

    { default: true, description: "Make this projector available in HomeKit.", name: "" }
  ],
  Log: [

    { default: true, description: "Log commands sent from HomeKit (power, input, picture mode, ...).", name: "Commands" },
    { default: true, description: "Log changes made outside HomeKit, such as with the projector's IR remote.", name: "ExternalChanges" }
  ],
  Picture: [

    { default: false, description: "Add a switch per picture mode (Cinema Film 1, Reference, Game, ...) for scenes and automations. Turning one on selects that mode.",
      name: "Switches" }
  ],
  Remote: [

    { default: true, description: "Control the projector from the Apple TV Remote in Control Center: arrows, select, back and menu.", name: "" },
    { choices: REMOTE_ACTIONS, default: true, defaultValue: "blank", description: "What the Play/Pause button does.", group: "", name: "PlayPause" },
    { choices: REMOTE_ACTIONS, default: true, defaultValue: "menu", description: "What the Info (i) button does.", group: "", name: "Info" },
    { choices: REMOTE_ACTIONS, default: true, defaultValue: "return", description: "What the Back button does.", group: "", name: "Back" }
  ],
  Sensors: [

    { default: false, description: "Add a \"Projector Ready\" occupancy sensor that detects when the picture is fully on (after warm-up). Use it to trigger scenes.",
      name: "Ready" },
    { default: false, description: "Add a \"Projector Cooling\" occupancy sensor that detects cool-down. Use it to wait before cutting power at a smart plug.",
      name: "Cooling" }
  ]
};

// Typed names for every option the code reads, so a typo is a compile error instead of a silently ignored option.
export const Option = {

  ASPECT_SWITCHES: "Aspect.Switches",
  DEVICE: "Device",
  LOG_COMMANDS: "Log.Commands",
  LOG_EXTERNAL: "Log.ExternalChanges",
  PICTURE_MUTE: "Controls.PictureMute",
  PICTURE_SWITCHES: "Picture.Switches",
  REMOTE: "Remote",
  REMOTE_BACK: "Remote.Back",
  REMOTE_INFO: "Remote.Info",
  REMOTE_PLAY_PAUSE: "Remote.PlayPause",
  SENSOR_COOLING: "Sensors.Cooling",
  SENSOR_READY: "Sensors.Ready"
} as const;

export type OptionName = typeof Option[keyof typeof Option];
