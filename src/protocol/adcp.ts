/* adcp.ts: Sony ADCP (Advanced Display Control Protocol) transport.
 *
 * Wire format: TCP (default port 53595), ASCII lines terminated by CRLF. On connect the projector sends a greeting line: "NOKEY" when authentication is off, or a
 * random challenge when it is on. With a challenge the client answers sha256hex(challenge + password) and waits for "ok" before sending commands.
 *
 * Every interaction is a short-lived "session": connect, authenticate, send one or more commands (each waiting for its reply), disconnect. There is never a socket
 * left open to go stale, and a whole poll cycle shares one handshake. Sessions are serialized and paced through a CommandQueue.
 */
import type { Capabilities, Faults, PollRequest, PollResult, PowerState, ProjectorIdentity, ProjectorTransport, Reading, TransportOptions } from "./types.ts";
import { ErrorCode, ProjectorError, fromSocketError } from "./errors.ts";
import { hashChallenge, isSafeToken, parseInfoRange, parseJsonList, parsePower, parseReply, parseTimer } from "./adcp-parse.ts";
import type { AdcpReply } from "./adcp-parse.ts";
import { CommandQueue } from "./queue.ts";
import { DEFAULTS } from "../settings.ts";
import { DEFAULT_CAPABILITIES } from "./types.ts";
import { Socket } from "node:net";

// A reply line longer than this means we are not talking to an ADCP projector.
const MAX_LINE_BYTES = 4096;

export interface AdcpTransportOptions extends TransportOptions {

  password?: string;
}

export class AdcpTransport implements ProjectorTransport {

  public readonly endpoint: string;
  public readonly protocol = "adcp";

  readonly #debug: (message: string) => void;
  readonly #host: string;
  readonly #inFlight = new Set<() => void>();
  readonly #password: string;
  readonly #port: number;
  readonly #queue: CommandQueue;
  readonly #timeoutMs: number;

  constructor({ commandTimeoutMs = DEFAULTS.commandTimeoutMs, debug, host, pacingMs = DEFAULTS.commandPacingMs, password = "", port = DEFAULTS.adcpPort }:
  AdcpTransportOptions) {

    this.#debug = debug ?? ((): void => { /* Tracing is off. */ });
    this.#host = host;
    this.#password = password;
    this.#port = port;
    this.#queue = new CommandQueue({ pacingMs });
    this.#timeoutMs = commandTimeoutMs;
    this.endpoint = host + ":" + String(port);
  }

  // Stop everything: waiting commands are rejected and a connection already on the wire is cut, so nothing talks to the projector after shutdown.
  public close(): void {

    this.#queue.close();
    [...this.#inFlight].forEach((cancel) => cancel());
  }

  public async getPower(): Promise<PowerState> {

    return parsePower(await this.#query("power_status"));
  }

  public async setPower(on: boolean): Promise<void> {

    await this.#set("power", on ? "on" : "off");
  }

  public async getInput(): Promise<string> {

    return (await this.#query("input")).toLowerCase();
  }

  public async setInput(input: string): Promise<void> {

    await this.#set("input", input);
  }

  public async getPictureMode(): Promise<string> {

    return (await this.#query("picture_mode")).toLowerCase();
  }

  public async setPictureMode(mode: string): Promise<void> {

    await this.#set("picture_mode", mode);
  }

  public async getAspect(): Promise<string> {

    return (await this.#query("aspect")).toLowerCase();
  }

  public async setAspect(aspect: string): Promise<void> {

    await this.#set("aspect", aspect);
  }

  public async getBlank(): Promise<boolean> {

    return (await this.#query("blank")).toLowerCase() === "on";
  }

  public async setBlank(on: boolean): Promise<void> {

    await this.#set("blank", on ? "on" : "off");
  }

  public async getLightHours(): Promise<number | null> {

    return parseTimer(await this.#query("timer"));
  }

  public async getFaults(): Promise<Faults> {

    const [ errors, warnings ] = await this.#session([ "error ?", "warning ?" ]);

    return { errors: parseJsonList(expectValue("error", errors)), warnings: parseJsonList(expectValue("warning", warnings)) };
  }

  // Remote keys jump the queue so the Apple TV Remote stays responsive during a poll.
  public async sendKey(key: string): Promise<void> {

    expectOk("key", (await this.#session([command("key", key)], { priority: true }))[0]);
  }

  // A whole poll in one authenticated connection. Error replies for individual readings (err_inactive in standby, err_cmd on models without the command) are
  // returned per reading; only a failure to read power rejects.
  public async poll(request: PollRequest): Promise<PollResult> {

    const reads: [keyof Omit<PollResult, "power">, string[]][] = [];

    if(request.picture) {

      reads.push([ "input", ["input ?"] ], [ "pictureMode", ["picture_mode ?"] ], [ "aspect", ["aspect ?"] ]);
    }

    if(request.blank) {

      reads.push([ "blank", ["blank ?"] ]);
    }

    if(request.lightHours) {

      reads.push([ "lightHours", ["timer ?"] ]);
    }

    if(request.faults) {

      reads.push([ "faults", [ "error ?", "warning ?" ] ]);
    }

    const replies = await this.#session([ "power_status ?", ...reads.flatMap(([ , commands ]) => commands) ]);
    const result: PollResult = { power: parsePower(expectValue("power_status", replies[0])) };
    let index = 1;

    const reading = <T>(name: string, parse: (value: string) => T): Reading<T> => {

      try {

        return { value: parse(expectValue(name, replies[index++])) };
      } catch(error) {

        return { error };
      }
    };

    for(const [key] of reads) {

      switch(key) {

        case "input":

          result.input = reading("input", (value) => value.toLowerCase());

          break;

        case "pictureMode":

          result.pictureMode = reading("picture_mode", (value) => value.toLowerCase());

          break;

        case "aspect":

          result.aspect = reading("aspect", (value) => value.toLowerCase());

          break;

        case "blank":

          result.blank = reading("blank", (value) => value.toLowerCase() === "on");

          break;

        case "lightHours":

          result.lightHours = reading("timer", parseTimer);

          break;

        case "faults": {

          const errors = reading("error", parseJsonList);
          const warnings = reading("warning", parseJsonList);

          result.faults = ("error" in errors) ? errors : ("error" in warnings) ? warnings : { value: { errors: errors.value, warnings: warnings.value } };

          break;
        }

        default:

          break;
      }
    }

    return result;
  }

  public async identify(): Promise<ProjectorIdentity> {

    const replies = await this.#session([ "modelname ?", "serialnum ?", "version ?", "mac_address ?" ]);
    const [ model, serial, version, mac ] = replies.map((reply) => ((reply.kind === "value") && reply.value) ? reply.value : undefined);
    const identity: ProjectorIdentity = {};

    // The version reply is JSON on current firmware ([{"main":"1.020"}]) and a bare string on older firmware.
    const firmware = version ? (/"main"\s*:\s*"([^"]+)"/.exec(version)?.[1] ?? version) : undefined;

    if(firmware) {

      identity.firmware = firmware;
    }

    if(mac) {

      identity.macAddress = mac.toLowerCase();
    }

    if(model) {

      identity.model = model;
    }

    if(serial) {

      identity.serial = serial;
    }

    return identity;
  }

  // Ask the projector which values it accepts. Firmware differs in the --info syntax it understands, and older firmware has none, in which case the lineup
  // defaults are used and the projector will reject anything it does not have.
  public async capabilities(): Promise<Capabilities> {

    const lists = [ "input", "picture_mode", "aspect" ] as const;
    const first = await this.#session([ ...lists.map((name) => name + " ? --info"), "blank ?", "timer ?", "error ?" ]);
    const ranges = lists.map((_name, index) => (first[index]?.kind === "value") ? parseInfoRange(first[index].value) : null);

    const retry = lists.filter((_name, index) => ranges[index] === null);

    if(retry.length) {

      const second = await this.#session(retry.map((name) => name + " --info"));

      retry.forEach((name, index) => {

        const reply = second[index];

        ranges[lists.indexOf(name)] = (reply?.kind === "value") ? parseInfoRange(reply.value) : null;
      });
    }

    // A command is only ruled out when the projector says it does not exist; err_inactive (not available right now) still counts as supported.
    const exists = (reply: AdcpReply | undefined): boolean => (reply !== undefined) && !((reply.kind === "error") && (reply.error === "err_cmd"));

    return {

      aspects: ranges[2] ?? DEFAULT_CAPABILITIES.aspects,
      blank: exists(first[3]),
      faults: exists(first[5]),
      inputs: ranges[0] ?? DEFAULT_CAPABILITIES.inputs,
      lightHours: exists(first[4]),
      pictureModes: ranges[1] ?? DEFAULT_CAPABILITIES.pictureModes,
      remote: true
    };
  }

  async #query(name: string): Promise<string> {

    return expectValue(name, (await this.#session([name + " ?"]))[0]);
  }

  // Sets come from HomeKit, so they jump ahead of queued polls to keep the Home app responsive.
  async #set(name: string, value: string): Promise<void> {

    expectOk(name, (await this.#session([command(name, value)], { priority: true }))[0]);
  }

  // Run commands in one authenticated connection. Error replies are returned, not thrown, so a batch can contain queries a model does not support; only
  // transport and authentication failures throw.
  async #session(commands: string[], { priority = false } = {}): Promise<AdcpReply[]> {

    return this.#queue.run(async () => this.#exchange(commands), { priority });
  }

  async #exchange(commands: string[]): Promise<AdcpReply[]> {

    return new Promise<AdcpReply[]>((resolve, reject) => {

      const socket = new Socket();
      const replies: AdcpReply[] = [];
      let buffer = "";
      let phase: "auth" | "commands" | "greeting" = "greeting";
      let settled = false;

      const finish = (error: ProjectorError | null): void => {

        if(settled) {

          return;
        }

        settled = true;
        clearTimeout(timer);
        this.#inFlight.delete(cancel);
        socket.destroy();

        if(error) {

          this.#debug("ADCP " + this.endpoint + " failed: " + error.message);
          reject(error);
        } else {

          resolve(replies);
        }
      };

      const timer = setTimeout(() => finish(new ProjectorError(ErrorCode.NET_TIMEOUT, this.endpoint + ": no reply within " + String(this.#timeoutMs) +
        " ms (" + phase + ").")), this.#timeoutMs);
      const cancel = (): void => finish(new ProjectorError(ErrorCode.ABORTED, this.endpoint + ": connection closed because the plugin is shutting down."));

      this.#inFlight.add(cancel);

      const send = (line: string, trace = line): void => {

        this.#debug("ADCP " + this.endpoint + " -> " + trace);
        socket.write(line + "\r\n");
      };

      const sendNext = (): void => {

        const next = commands[replies.length];

        if(next === undefined) {

          finish(null);

          return;
        }

        send(next);
      };

      const onLine = (line: string): void => {

        switch(phase) {

          case "greeting": {

            const greeting = line.trim();

            if(!greeting) {

              finish(new ProjectorError(ErrorCode.PROTO_INVALID, this.endpoint + ": empty greeting; is this an ADCP port?"));

              return;
            }

            this.#debug("ADCP " + this.endpoint + " <- " + ((greeting.toUpperCase() === "NOKEY") ? "NOKEY" : "<challenge>"));

            if(greeting.toUpperCase() === "NOKEY") {

              phase = "commands";
              sendNext();

              return;
            }

            if(!this.#password) {

              finish(new ProjectorError(ErrorCode.AUTH_REQUIRED, this.endpoint + ": the projector requires an ADCP password."));

              return;
            }

            phase = "auth";
            send(hashChallenge(greeting, this.#password), "<auth hash>");

            return;
          }

          case "auth": {

            const reply = parseReply(line);

            this.#debug("ADCP " + this.endpoint + " <- " + line.trim());

            if(reply.kind === "ok") {

              phase = "commands";
              sendNext();

              return;
            }

            finish(new ProjectorError((reply.kind === "error") && (reply.error === "err_auth") ? ErrorCode.AUTH_FAILED : ErrorCode.PROTO_INVALID,
              this.endpoint + ": authentication was not accepted (" + line.trim() + ")."));

            return;
          }

          default: {

            const reply = parseReply(line);

            this.#debug("ADCP " + this.endpoint + " <- " + line.trim());

            if((reply.kind === "error") && (reply.error === "err_auth")) {

              finish(new ProjectorError(ErrorCode.AUTH_FAILED, this.endpoint + ": the projector rejected the session's authentication."));

              return;
            }

            replies.push(reply);
            sendNext();
          }
        }
      };

      socket.on("data", (chunk: Buffer) => {

        buffer += chunk.toString("latin1");

        for(let index = buffer.indexOf("\r\n"); (index !== -1) && !settled; index = buffer.indexOf("\r\n")) {

          const line = buffer.slice(0, index);

          buffer = buffer.slice(index + 2);
          onLine(line);
        }

        if(!settled && (buffer.length > MAX_LINE_BYTES)) {

          finish(new ProjectorError(ErrorCode.PROTO_INVALID, this.endpoint + ": reply exceeded " + String(MAX_LINE_BYTES) + " bytes without a line ending."));
        }
      });

      socket.on("error", (error) => finish(fromSocketError(error, this.endpoint)));
      socket.on("close", () => finish(new ProjectorError(ErrorCode.NET_CLOSED, this.endpoint + ": connection closed during " + phase + ".")));
      socket.connect(this.#port, this.#host);
    });
  }
}

// Build a set command, refusing any value that could break out of its quotes.
function command(name: string, value: string): string {

  if(!isSafeToken(value)) {

    throw new ProjectorError(ErrorCode.PROTO_REJECTED, "Refusing to send " + name + " value " + JSON.stringify(value) + ": only a-z, 0-9, '_' and '.' are allowed.");
  }

  return name + " \"" + value + "\"";
}

function errorFor(name: string, error: string): ProjectorError {

  switch(error) {

    case "err_inactive":

      return new ProjectorError(ErrorCode.BUSY, "'" + name + "' is not available in the projector's current state.");

    case "err_cmd":

      return new ProjectorError(ErrorCode.PROTO_UNSUPPORTED, "This projector does not support '" + name + "'.");

    default:

      return new ProjectorError(ErrorCode.PROTO_REJECTED, "The projector rejected '" + name + "' (" + error + ").");
  }
}

function expectValue(name: string, reply: AdcpReply | undefined): string {

  if(reply?.kind === "value") {

    return reply.value;
  }

  if(reply?.kind === "error") {

    throw errorFor(name, reply.error);
  }

  throw new ProjectorError(ErrorCode.PROTO_INVALID, "Expected a value for '" + name + "' but the projector replied " + (reply ? "ok" : "nothing") + ".");
}

function expectOk(name: string, reply: AdcpReply | undefined): void {

  if(reply?.kind === "ok") {

    return;
  }

  if(reply?.kind === "error") {

    throw errorFor(name, reply.error);
  }

  throw new ProjectorError(ErrorCode.PROTO_INVALID, "Expected 'ok' for '" + name + "' but the projector replied " + (reply ? JSON.stringify(reply.value) : "nothing") +
    ".");
}
