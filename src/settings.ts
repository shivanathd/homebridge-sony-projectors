/* settings.ts: Plugin-wide constants. */

// The npm package name. Homebridge uses it to associate cached and external accessories with this plugin.
export const PLUGIN_NAME = "homebridge-sony-projectors";

// The platform alias users put in config.json. It must match `pluginAlias` in config.schema.json.
export const PLATFORM_NAME = "SonyProjectors";

export const DEFAULTS = {

  // Port Sony uses for ADCP (Advanced Display Control Protocol).
  adcpPort: 53595,

  // Minimum spacing between two commands on one projector. Projectors drop commands that arrive too quickly.
  commandPacingMs: 200,

  // How long a single command may take, connect and handshake included, before it is treated as a timeout.
  commandTimeoutMs: 5000,

  // SDCP community string. Sony ships every projector with "SONY".
  community: "SONY",

  // How often to poll a projector that is on. Standby polls run three times less often.
  pollIntervalSeconds: 10,

  // Port Sony uses for SDCP / PJ Talk.
  sdcpPort: 53484
} as const;

export const LIMITS = {

  maxPollIntervalSeconds: 300,
  minPollIntervalSeconds: 3
} as const;

// Service subtypes. Keeping them in one table makes it impossible for two services to collide on an accessory.
export const Subtype = {

  aspect: (token: string): string => "aspect." + token,
  cooling: "sensor.cooling",
  input: (token: string): string => "input." + token,
  pictureMode: (token: string): string => "picture." + token,
  pictureMute: "control.pictureMute",
  ready: "sensor.ready"
} as const;
