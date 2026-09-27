/* types.ts: The protocol-neutral contract between projector transports (ADCP, SDCP) and the rest of the plugin.
 *
 * Values are exchanged as ADCP-style tokens ("hdmi1", "cinema_film1", "2.35_1_zoom") whichever protocol is on the wire. The SDCP transport translates its numeric
 * codes to and from these tokens, so nothing above this layer knows or cares which protocol a projector speaks.
 */

export type Protocol = "adcp" | "sdcp";

export type ProtocolPreference = Protocol | "auto";

// Sony reports a handful of transitional power states. Anything between standby and on is collapsed into the two states that matter to HomeKit.
export type PowerState = "cooling" | "on" | "standby" | "unknown" | "warming";

export interface ProjectorIdentity {

  firmware?: string;
  macAddress?: string;
  model?: string;
  serial?: string;
}

// What a specific projector can do, discovered at runtime. Lists are ordered as the projector reports them.
export interface Capabilities {

  aspects: readonly string[];
  blank: boolean;
  faults: boolean;
  inputs: readonly string[];
  lightHours: boolean;
  pictureModes: readonly string[];
  remote: boolean;
}

export interface Faults {

  errors: readonly string[];
  warnings: readonly string[];
}

// What one poll should read. Power is always read.
export interface PollRequest {

  blank: boolean;
  faults: boolean;
  lightHours: boolean;
  picture: boolean;
}

// One optional reading: its value, or the error the projector gave for it (unavailable in standby, not supported, ...).
export type Reading<T> = { error: unknown } | { value: T };

export interface PollResult {

  aspect?: Reading<string>;
  blank?: Reading<boolean>;
  faults?: Reading<Faults>;
  input?: Reading<string>;
  lightHours?: Reading<number | null>;
  pictureMode?: Reading<string>;
  power: PowerState;
}

export interface ProjectorTransport {

  // A human-readable "host:port" for log lines.
  readonly endpoint: string;
  readonly protocol: Protocol;

  capabilities(): Promise<Capabilities>;
  close(): void;
  getAspect(): Promise<string>;
  getBlank(): Promise<boolean>;
  getFaults(): Promise<Faults>;
  getInput(): Promise<string>;
  getLightHours(): Promise<number | null>;
  getPictureMode(): Promise<string>;
  getPower(): Promise<PowerState>;
  identify(): Promise<ProjectorIdentity>;

  // Read everything a poll needs, as cheaply as the protocol allows (ADCP: one connection). Rejects only when power cannot be read.
  poll(request: PollRequest): Promise<PollResult>;
  sendKey(key: string): Promise<void>;
  setAspect(aspect: string): Promise<void>;
  setBlank(on: boolean): Promise<void>;
  setInput(input: string): Promise<void>;
  setPictureMode(mode: string): Promise<void>;
  setPower(on: boolean): Promise<void>;
}

export interface TransportOptions {

  commandTimeoutMs?: number;
  host: string;

  // Receives protocol traces. Secrets are redacted before they get here.
  debug?: (message: string) => void;
  pacingMs?: number;
  port?: number;
}

// The inputs, picture modes and aspect ratios a projector gets when it cannot tell us its own list. These match the VPL-VW/XW home-cinema lineup.
export const DEFAULT_CAPABILITIES: Capabilities = {

  aspects: [ "normal", "v_stretch", "1.85_1_zoom", "2.35_1_zoom", "stretch", "squeeze" ],
  blank: true,
  faults: true,
  inputs: [ "hdmi1", "hdmi2" ],
  lightHours: true,
  pictureModes: [ "cinema_film1", "cinema_film2", "reference", "tv", "photo", "game", "brt_cinema", "brt_tv", "user" ],
  remote: true
};
