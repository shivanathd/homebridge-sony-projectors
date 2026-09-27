/* controller.ts: Everything about one projector except HomeKit.
 *
 * The controller owns the transport, keeps the StateStore current with a poll loop, and runs commands. It knows nothing about HomeKit: the TV and companion
 * accessories read the store and call the command methods. Every failure here ends as a logged, coded error or a rejected promise that its caller handles; there
 * is no fire-and-forget I/O, which is exactly what crashed the 2018 plugin (S1 in the research report).
 */
import type { Capabilities, ProjectorIdentity, ProjectorTransport, Protocol, Reading } from "../protocol/types.ts";
import { ErrorCode, ProjectorError, isProjectorError } from "../protocol/errors.ts";
import { ErrorReporter, describeError } from "../lib/reporter.ts";
import type { ProjectorState, StateKey } from "./state.ts";
import { aspectLabel, inputLabel, pictureModeLabel } from "../protocol/labels.ts";
import { createTransport, detectProtocol } from "../protocol/detect.ts";
import { DEFAULT_CAPABILITIES } from "../protocol/types.ts";
import type { HomebridgePluginLogging } from "homebridge-plugin-utils";
import { Option } from "../options.ts";
import type { ProjectorConfig } from "../config.ts";
import { StateStore } from "./state.ts";
import { superviseLoop } from "homebridge-plugin-utils";

export interface ControllerTimings {

  // Pause after an authentication failure. Sony projectors lock out for about 30 seconds after repeated bad passwords.
  authPauseMs: number;
  backoffCeilingMs: number;
  faultsEveryMs: number;
  lightHoursEveryMs: number;
  pollMs: number;
  standbyPollMs: number;
  transitionPollMs: number;
}

// What the controller has learned about a projector, cached across restarts so HomeKit can be set up before the projector answers.
export interface LearnedFacts {

  capabilities?: Capabilities;
  identity?: ProjectorIdentity;
  protocol?: Protocol;
}

export interface ControllerOptions {

  commandTimeoutMs?: number;
  config: ProjectorConfig;
  initial?: LearnedFacts;
  isEnabled: (option: string) => boolean;
  log: HomebridgePluginLogging;
  pacingMs?: number;
  signal: AbortSignal;
  timings?: Partial<ControllerTimings>;
}

// How long after a HomeKit command a matching change is attributed to that command rather than to someone using the IR remote.
const OWN_CHANGE_WINDOW_MS = 120000;

const LABELS: Partial<Record<StateKey, { label: (value: string) => string; name: string }>> = {

  aspect: { label: aspectLabel, name: "Aspect ratio" },
  input: { label: inputLabel, name: "Input" },
  pictureMode: { label: pictureModeLabel, name: "Picture mode" }
};

function capabilitiesFor(protocol: Protocol | undefined): Capabilities {

  return (protocol === "sdcp") ? { ...DEFAULT_CAPABILITIES, remote: false } : DEFAULT_CAPABILITIES;
}

export class ProjectorController {

  public readonly store = new StateStore();

  #capabilities: Capabilities;
  #capabilitiesConfirmed = false;
  #capabilitiesProbed = false;
  #connecting: Promise<ProjectorTransport> | null = null;
  readonly #config: ProjectorConfig;
  #failures = 0;
  #identity: ProjectorIdentity;
  readonly #isEnabled: (option: string) => boolean;
  #lastFaults = -Infinity;
  #lastLightHours = -Infinity;
  readonly #learnedListeners: (() => void)[] = [];
  readonly #log: HomebridgePluginLogging;
  readonly #options: ControllerOptions;
  readonly #ownChanges = new Map<StateKey, number>();
  #protocol: Protocol | undefined;
  readonly #reporter: ErrorReporter;
  readonly #signal: AbortSignal;
  readonly #timings: ControllerTimings;
  #transport: ProjectorTransport | null = null;
  #wake: (() => void) | null = null;

  constructor(options: ControllerOptions) {

    const { config, initial = {}, isEnabled, log, signal, timings = {} } = options;
    const pollMs = config.pollIntervalSeconds * 1000;

    this.#config = config;
    this.#isEnabled = isEnabled;
    this.#log = log;
    this.#options = options;
    this.#protocol = (config.protocol === "auto") ? initial.protocol : config.protocol;
    this.#capabilities = initial.capabilities ?? capabilitiesFor(this.#protocol);
    this.#identity = initial.identity ?? {};
    this.#reporter = new ErrorReporter(log);
    this.#signal = signal;
    this.#timings = { authPauseMs: 30000, backoffCeilingMs: 60000, faultsEveryMs: 60000, lightHoursEveryMs: 600000, pollMs, standbyPollMs: pollMs * 3,
      transitionPollMs: 2000, ...timings };

    this.store.onChange((key, value, previous) => this.#noticeChange(key, value, previous));

    signal.addEventListener("abort", () => {

      this.#transport?.close();
      this.#transport = null;
      this.#wake?.();
    }, { once: true });
  }

  public get capabilities(): Capabilities {

    return this.#capabilities;
  }

  public get identity(): ProjectorIdentity {

    return this.#identity;
  }

  public get protocol(): Protocol | undefined {

    return this.#protocol;
  }

  // Called when capabilities, identity or protocol are learned or change, so accessories can adapt and the facts can be cached.
  public onLearned(listener: () => void): void {

    this.#learnedListeners.push(listener);
  }

  public start(): void {

    void superviseLoop({

      loop: async (signal) => {

        while(!signal.aborted) {

          // Each iteration handles its own failures, so the loop only exits when Homebridge shuts down.
          // eslint-disable-next-line no-await-in-loop
          await this.#sleep(await this.#iteration());
        }
      },
      onError: (error) => this.#log.error("The polling loop stopped unexpectedly and will restart with Homebridge: %s", describeError(error)),
      signal: this.#signal
    });
  }

  public async setPower(on: boolean): Promise<void> {

    const power = this.store.get("power");

    await this.#command(on ? "Turning on" : "Turning off", on ? "turn on" : "turn off", async (transport) => {

      if(on && (power === "cooling")) {

        throw new ProjectorError(ErrorCode.BUSY, "The projector is cooling down. It can be turned on again once cool-down finishes (usually about a minute).");
      }

      if(!on && (power === "warming")) {

        throw new ProjectorError(ErrorCode.BUSY, "The projector is warming up. It can be turned off once the picture is on.");
      }

      if((on && ((power === "on") || (power === "warming"))) || (!on && ((power === "standby") || (power === "cooling")))) {

        return;
      }

      await transport.setPower(on);
      this.#own("power");
      this.store.update({ power: on ? "warming" : "cooling" });
    });
  }

  public async setInput(input: string): Promise<void> {

    await this.#command("Switching input to " + inputLabel(input), "switch input to " + inputLabel(input), async (transport) => {

      await transport.setInput(input);
      this.#own("input");
      this.store.update({ input });
    });
  }

  public async setPictureMode(mode: string): Promise<void> {

    await this.#command("Setting picture mode to " + pictureModeLabel(mode), "set picture mode to " + pictureModeLabel(mode), async (transport) => {

      await transport.setPictureMode(mode);
      this.#own("pictureMode");
      this.store.update({ pictureMode: mode });
    });
  }

  public async setAspect(aspect: string): Promise<void> {

    await this.#command("Setting aspect ratio to " + aspectLabel(aspect), "set aspect ratio to " + aspectLabel(aspect), async (transport) => {

      await transport.setAspect(aspect);
      this.#own("aspect");
      this.store.update({ aspect });
    });
  }

  public async setBlank(on: boolean): Promise<void> {

    await this.#command(on ? "Muting the picture" : "Unmuting the picture", on ? "mute the picture" : "unmute the picture", async (transport) => {

      await transport.setBlank(on);
      this.#own("blank");
      this.store.update({ blank: on });
    });
  }

  // A remote button press, already mapped to an action: an ADCP key name, "blank" to toggle picture mute, or "none".
  public async remoteAction(action: string): Promise<void> {

    if(action === "none") {

      return;
    }

    if(action === "blank") {

      await this.setBlank(!(this.store.get("blank") ?? false));

      return;
    }

    await this.#command("Sending remote key " + action, "send remote key " + action, async (transport) => transport.sendKey(action), { quiet: true });
  }

  // Run one command: log it, make sure there is a transport, run it, then poll soon to pick up side effects. Failures are logged with their fix and rethrown so
  // the HomeKit handler can tell HomeKit the command failed.
  async #command(doing: string, action: string, run: (transport: ProjectorTransport) => Promise<void>, { quiet = false } = {}): Promise<void> {

    if(this.#isEnabled(Option.LOG_COMMANDS) && !quiet) {

      this.#log.info("%s.", doing);
    } else {

      this.#log.debug("%s.", doing);
    }

    try {

      // While polls are already failing to reach the projector, fail at once instead of making HomeKit wait out a network timeout: HAP warns about writes
      // slower than 3 seconds, and the Home app already shows No Response.
      if(this.#reporter.code?.startsWith("SPJ-NET")) {

        throw new ProjectorError(ErrorCode.NET_UNREACHABLE, this.#config.host + ": the projector is not responding (it has been unreachable since the last " +
          "successful poll).");
      }

      await run(await this.#ensureTransport());
      this.#wake?.();
    } catch(error) {

      const busy = isProjectorError(error) && (error.code === ErrorCode.BUSY);

      // A remote key pressed in standby is routine; do not make it a warning.
      if(busy && quiet) {

        this.#log.debug("Unable to %s: %s", action, describeError(error));
      } else {

        this.#log[busy ? "warn" : "error"]("Unable to %s: %s", action, describeError(error));
      }

      throw error;
    }
  }

  async #ensureTransport(): Promise<ProjectorTransport> {

    if(this.#signal.aborted) {

      throw new ProjectorError(ErrorCode.ABORTED, "Homebridge is shutting down.");
    }

    if(this.#transport) {

      return this.#transport;
    }

    // One connection attempt at a time: a HomeKit command and the poll loop must not both detect and build separate transports (with separate queues).
    this.#connecting ??= this.#connect().finally(() => {

      this.#connecting = null;
    });

    return this.#connecting;
  }

  async #connect(): Promise<ProjectorTransport> {

    if(!this.#protocol) {

      const protocol = await detectProtocol(this.#settings(), this.#signal);

      this.#log.info("Detected %s control.", protocol.toUpperCase());
      this.#protocol = protocol;
      this.#learned();
    }

    // Shutdown may have happened while detecting.
    if(this.#signal.aborted) {

      throw new ProjectorError(ErrorCode.ABORTED, "Homebridge is shutting down.");
    }

    this.#transport = createTransport(this.#settings(), this.#protocol);

    return this.#transport;
  }

  #settings(): Parameters<typeof createTransport>[0] {

    const { adcpPort, community, host, password, sdcpPort } = this.#config;

    return { adcpPort, commandTimeoutMs: this.#options.commandTimeoutMs, community, debug: (message: string): void => this.#log.debug(message), host,
      pacingMs: this.#options.pacingMs, password, sdcpPort };
  }

  // One poll. Returns how long to wait before the next one.
  async #iteration(): Promise<number> {

    try {

      const transport = await this.#ensureTransport();

      await this.#poll(transport);
      this.#failures = 0;
      this.#reporter.success();

      await this.#learn(transport);

      switch(this.store.get("power")) {

        case "on":

          return this.#timings.pollMs;

        case "warming":
        case "cooling":

          return this.#timings.transitionPollMs;

        default:

          return this.#timings.standbyPollMs;
      }
    } catch(error) {

      if(this.#signal.aborted) {

        return 0;
      }

      this.#failures++;
      this.#reporter.failure("Talking to the projector at " + this.#config.host, error);
      this.store.update({ reachable: false });

      const code = isProjectorError(error) ? error.code : undefined;

      // On auto, a projector that has gone away may come back speaking something else (a firmware update, a replaced unit), so detect again next time.
      if((this.#config.protocol === "auto") && code?.startsWith("SPJ-NET")) {

        this.#transport?.close();
        this.#transport = null;
        this.#protocol = undefined;
      }

      if((code === ErrorCode.AUTH_FAILED) || (code === ErrorCode.AUTH_REQUIRED)) {

        return this.#timings.authPauseMs;
      }

      return Math.min(this.#timings.backoffCeilingMs, this.#timings.pollMs * (2 ** Math.min(this.#failures - 1, 10)));
    }
  }

  async #poll(transport: ProjectorTransport): Promise<void> {

    const now = Date.now();
    const capabilities = this.#capabilities;

    // Picture settings are only readable while the projector is on; skip them in standby to keep standby polls to a single query.
    const picture = this.store.get("power") !== "standby";
    const lightHours = capabilities.lightHours && ((now - this.#lastLightHours) >= this.#timings.lightHoursEveryMs);
    const faults = capabilities.faults && ((now - this.#lastFaults) >= this.#timings.faultsEveryMs);
    const result = await transport.poll({ blank: picture && capabilities.blank, faults, lightHours, picture });

    this.store.update({ power: result.power, reachable: true });

    if(lightHours) {

      this.#lastLightHours = now;
    }

    if(faults) {

      this.#lastFaults = now;
    }

    // Picture readings taken in the same batch as a standby power reading are meaningless.
    if(result.power === "on") {

      this.#apply("input", result.input);
      this.#apply("pictureMode", result.pictureMode);
      this.#apply("aspect", result.aspect);
      this.#apply("blank", result.blank);
    }

    this.#apply("lightHours", result.lightHours);

    if(result.faults) {

      if("value" in result.faults) {

        this.store.update({ faults: [ ...result.faults.value.errors, ...result.faults.value.warnings ] });
      } else {

        this.#tolerate("faults", result.faults.error);
      }
    }
  }

  // Apply one optional reading. A value that is unavailable right now (switching signal, standby) or unsupported by this model is skipped; anything else fails
  // the poll.
  #apply<K extends "aspect" | "blank" | "input" | "lightHours" | "pictureMode">(key: K, reading: Reading<ProjectorState[K]> | undefined): void {

    if(!reading) {

      return;
    }

    if("value" in reading) {

      this.store.update({ [key]: reading.value });

      return;
    }

    this.#tolerate(key, reading.error);
  }

  #tolerate(what: string, error: unknown): void {

    if(isProjectorError(error) && [ ErrorCode.BUSY, ErrorCode.PROTO_REJECTED, ErrorCode.PROTO_UNSUPPORTED ].includes(error.code as never)) {

      this.#log.debug("Skipping %s this poll: %s", what, error.message);

      return;
    }

    throw error;
  }

  // Learn identity once, and capabilities until they have been read while the projector was on (some models only report ranges when on).
  async #learn(transport: ProjectorTransport): Promise<void> {

    let changed = false;

    if(!this.#identity.model && !this.#identity.serial) {

      try {

        const identity = await transport.identify();

        if(identity.model || identity.serial) {

          this.#identity = identity;
          changed = true;
          this.#log.info("Connected to %s%s over %s.", identity.model ?? "a Sony projector", identity.serial ? " (serial " + identity.serial + ")" : "",
            transport.protocol.toUpperCase());
        }
      } catch(error) {

        this.#tolerate("identity", error);
      }
    }

    // Probe once in any state, then again only once the projector is on: some models only report their value ranges while on.
    if(!this.#capabilitiesConfirmed && (!this.#capabilitiesProbed || (this.store.get("power") === "on"))) {

      this.#capabilitiesProbed = true;

      try {

        const capabilities = await transport.capabilities();

        this.#capabilitiesConfirmed = this.store.get("power") === "on";

        if(JSON.stringify(capabilities) !== JSON.stringify(this.#capabilities)) {

          this.#capabilities = capabilities;
          changed = true;
        }
      } catch(error) {

        this.#tolerate("capabilities", error);
      }
    }

    if(changed) {

      this.#learned();
    }
  }

  #learned(): void {

    for(const listener of this.#learnedListeners) {

      try {

        listener();
      } catch(error) {

        this.#log.error("Unable to apply what was learned about the projector: %s", describeError(error));
      }
    }
  }

  #own(key: StateKey): void {

    this.#ownChanges.set(key, Date.now());
  }

  // Log changes that did not come from HomeKit, such as the projector's own IR remote, so the log explains why HomeKit state moved.
  #noticeChange(key: StateKey, value: unknown, previous: unknown): void {

    if((previous === null) || (previous === "unknown") || !this.#isEnabled(Option.LOG_EXTERNAL)) {

      return;
    }

    const ownedAt = this.#ownChanges.get(key === "reachable" ? "power" : key);

    if((ownedAt !== undefined) && ((Date.now() - ownedAt) < OWN_CHANGE_WINDOW_MS)) {

      return;
    }

    if(key === "power") {

      if((value === "warming") || ((value === "on") && (previous === "standby"))) {

        this.#log.info("Turned on outside HomeKit.");
      } else if((value === "cooling") || ((value === "standby") && (previous === "on"))) {

        this.#log.info("Turned off outside HomeKit.");
      }

      return;
    }

    const described = LABELS[key];

    if(described && (typeof value === "string")) {

      this.#log.info("%s changed to %s outside HomeKit.", described.name, described.label(value));
    }
  }

  async #sleep(ms: number): Promise<void> {

    if(this.#signal.aborted || (ms <= 0)) {

      return;
    }

    await new Promise<void>((resolve) => {

      const done = (): void => {

        clearTimeout(timer);
        this.#wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);

      this.#wake = done;
    });
  }
}

