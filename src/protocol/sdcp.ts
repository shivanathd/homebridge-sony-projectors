/* sdcp.ts: Sony SDCP (PJ Talk) transport for projectors that predate ADCP.
 *
 * Binary request/response over TCP (default port 53484), one short-lived connection per command, serialized and paced through a CommandQueue. The protocol has no
 * real authentication: the 4-character "community" is sent in plaintext and is also broadcast by the projector, so it is a compatibility setting, not a secret.
 */
import { Action, FrameReader, Item, NgCode, decodeFrame, encodeRequest, faultNames, fromCode, toCode, tokens } from "./sdcp-codec.ts";
import type { Capabilities, Faults, PollRequest, PollResult, PowerState, ProjectorIdentity, ProjectorTransport, TransportOptions } from "./types.ts";
import { ErrorCode, ProjectorError, fromSocketError } from "./errors.ts";
import { CommandQueue } from "./queue.ts";
import { DEFAULTS } from "../settings.ts";
import { Socket } from "node:net";
import { pollIndividually } from "./poll.ts";

export interface SdcpTransportOptions extends TransportOptions {

  community?: string;
}

type TableName = "aspect" | "input" | "pictureMode";

export class SdcpTransport implements ProjectorTransport {

  public readonly endpoint: string;
  public readonly protocol = "sdcp";

  readonly #community: string;
  readonly #debug: (message: string) => void;
  readonly #host: string;
  readonly #inFlight = new Set<() => void>();
  readonly #port: number;
  readonly #queue: CommandQueue;
  readonly #timeoutMs: number;

  constructor({ commandTimeoutMs = DEFAULTS.commandTimeoutMs, community = DEFAULTS.community, debug, host, pacingMs = DEFAULTS.commandPacingMs,
    port = DEFAULTS.sdcpPort }: SdcpTransportOptions) {

    this.#community = community;
    this.#debug = debug ?? ((): void => { /* Tracing is off. */ });
    this.#host = host;
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

    return fromCode("power", await this.#getWord(Item.POWER_STATUS)) as PowerState;
  }

  public async setPower(on: boolean): Promise<void> {

    await this.#request(Action.SET, Item.POWER, on ? 1 : 0);
  }

  public async getInput(): Promise<string> {

    return fromCode("input", await this.#getWord(Item.INPUT));
  }

  public async setInput(input: string): Promise<void> {

    await this.#setToken("input", Item.INPUT, input);
  }

  public async getPictureMode(): Promise<string> {

    return fromCode("pictureMode", await this.#getWord(Item.PICTURE_MODE));
  }

  public async setPictureMode(mode: string): Promise<void> {

    await this.#setToken("pictureMode", Item.PICTURE_MODE, mode);
  }

  public async getAspect(): Promise<string> {

    return fromCode("aspect", await this.#getWord(Item.ASPECT));
  }

  public async setAspect(aspect: string): Promise<void> {

    await this.#setToken("aspect", Item.ASPECT, aspect);
  }

  public async getBlank(): Promise<boolean> {

    return (await this.#getWord(Item.PICTURE_MUTING)) === 1;
  }

  public async setBlank(on: boolean): Promise<void> {

    await this.#request(Action.SET, Item.PICTURE_MUTING, on ? 1 : 0);
  }

  public async getLightHours(): Promise<number | null> {

    return this.#getWord(Item.LAMP_TIMER);
  }

  public async getFaults(): Promise<Faults> {

    return { errors: faultNames(await this.#getWord(Item.ERROR_STATUS)), warnings: [] };
  }

  // SDCP only offers raw IR-code emulation, and Sony does not publish the codes per model, so remote keys are not offered on SDCP projectors.
  public async sendKey(key: string): Promise<void> {

    throw new ProjectorError(ErrorCode.PROTO_UNSUPPORTED, "Remote key '" + key + "' is not available over SDCP. Use ADCP if the projector supports it.");
  }

  // SDCP has one item per request, so a poll is a series of reads.
  public async poll(request: PollRequest): Promise<PollResult> {

    return pollIndividually(this, request);
  }

  public async identify(): Promise<ProjectorIdentity> {

    const identity: ProjectorIdentity = {};

    try {

      const model = (await this.#request(Action.GET, Item.MODEL_NAME)).toString("ascii").split("\0")[0]?.trim();

      if(model) {

        identity.model = model;
      }

      const serial = await this.#request(Action.GET, Item.SERIAL_NUMBER);

      if(serial.length === 4) {

        identity.serial = String(serial.readUInt32BE(0)).padStart(8, "0");
      }
    } catch(error) {

      // Older models do not answer identity items. Anything other than "not supported" is a real failure.
      if(!(error instanceof ProjectorError) || (error.code !== ErrorCode.PROTO_UNSUPPORTED)) {

        throw error;
      }
    }

    return identity;
  }

  public async capabilities(): Promise<Capabilities> {

    const supported = async (item: number): Promise<boolean> => {

      try {

        await this.#request(Action.GET, item);

        return true;
      } catch(error) {

        // Only "no such item" rules a feature out. "Not applicable now" (standby) still means the item exists, and anything else (a timeout, a reset) says
        // nothing about the model, so it fails discovery and discovery is retried on a later poll.
        if(error instanceof ProjectorError) {

          if(error.code === ErrorCode.PROTO_UNSUPPORTED) {

            return false;
          }

          if(error.code === ErrorCode.BUSY) {

            return true;
          }
        }

        throw error;
      }
    };

    return {

      aspects: tokens("aspect"),
      blank: await supported(Item.PICTURE_MUTING),
      faults: await supported(Item.ERROR_STATUS),
      inputs: tokens("input"),
      lightHours: await supported(Item.LAMP_TIMER),
      pictureModes: tokens("pictureMode"),
      remote: false
    };
  }

  async #setToken(table: TableName, item: number, token: string): Promise<void> {

    const code = toCode(table, token);

    if(code === undefined) {

      throw new ProjectorError(ErrorCode.PROTO_REJECTED, "'" + token + "' is not a valid SDCP " + table + " value.");
    }

    await this.#request(Action.SET, item, code);
  }

  async #getWord(item: number): Promise<number> {

    const data = await this.#request(Action.GET, item);

    if(data.length < 2) {

      throw new ProjectorError(ErrorCode.PROTO_INVALID, this.endpoint + ": item 0x" + item.toString(16) + " returned " + String(data.length) + " bytes.");
    }

    return data.readUInt16BE(0);
  }

  // Sets come from HomeKit, so they jump ahead of queued polls to keep the Home app responsive.
  async #request(action: number, item: number, value?: number): Promise<Buffer> {

    return this.#queue.run(async () => this.#exchange(encodeRequest(action, item, value, this.#community), item), { priority: action === Action.SET });
  }

  async #exchange(request: Buffer, item: number): Promise<Buffer> {

    const label = "0x" + item.toString(16).padStart(4, "0");

    return new Promise<Buffer>((resolve, reject) => {

      const socket = new Socket();
      const reader = new FrameReader();
      let settled = false;

      const finish = (error: ProjectorError | null, data?: Buffer): void => {

        if(settled) {

          return;
        }

        settled = true;
        clearTimeout(timer);
        this.#inFlight.delete(cancel);
        socket.destroy();

        if(error) {

          this.#debug("SDCP " + this.endpoint + " " + label + " failed: " + error.message);
          reject(error);
        } else {

          resolve(data ?? Buffer.alloc(0));
        }
      };

      const timer = setTimeout(() => finish(new ProjectorError(ErrorCode.NET_TIMEOUT, this.endpoint + ": no reply to " + label + " within " +
        String(this.#timeoutMs) + " ms.")), this.#timeoutMs);
      const cancel = (): void => finish(new ProjectorError(ErrorCode.ABORTED, this.endpoint + ": connection closed because the plugin is shutting down."));

      this.#inFlight.add(cancel);

      socket.on("data", (chunk: Buffer) => {

        const frame = reader.push(chunk);

        if(!frame) {

          return;
        }

        this.#debug("SDCP " + this.endpoint + " <- " + frame.toString("hex"));

        // Every SDCP reply starts with version 0x02 and category 0x0A; anything else is not a Sony projector speaking SDCP.
        if((frame[0] !== 0x02) || (frame[1] !== 0x0a)) {

          finish(new ProjectorError(ErrorCode.PROTO_INVALID, this.endpoint + ": the reply is not SDCP; is this the right address and port?"));

          return;
        }

        const reply = decodeFrame(frame);

        if(reply.item !== item) {

          finish(new ProjectorError(ErrorCode.PROTO_INVALID, this.endpoint + ": reply was for item 0x" + reply.item.toString(16) + ", expected " + label + "."));

          return;
        }

        if(reply.ok) {

          finish(null, reply.data);

          return;
        }

        finish(ngError(label, (reply.data.length >= 2) ? reply.data.readUInt16BE(0) : -1));
      });

      socket.on("error", (error) => finish(fromSocketError(error, this.endpoint)));
      socket.on("close", () => finish(new ProjectorError(ErrorCode.NET_CLOSED, this.endpoint + ": connection closed before a reply to " + label + ".")));
      socket.on("connect", () => {

        this.#debug("SDCP " + this.endpoint + " -> " + request.toString("hex"));
        socket.write(request);
      });

      socket.connect(this.#port, this.#host);
    });
  }
}

function ngError(label: string, code: number): ProjectorError {

  const hex = "0x" + code.toString(16).padStart(4, "0");

  switch(code) {

    case NgCode.COMMUNITY:

      return new ProjectorError(ErrorCode.COMMUNITY, "The projector rejected the SDCP community for " + label + ".");

    case NgCode.NOT_APPLICABLE:

      return new ProjectorError(ErrorCode.BUSY, label + " is not available in the projector's current state (" + hex + ").");

    case NgCode.INVALID_ITEM:
    case NgCode.INVALID_REQUEST:

      return new ProjectorError(ErrorCode.PROTO_UNSUPPORTED, "This projector does not support item " + label + " (" + hex + ").");

    default:

      return new ProjectorError(ErrorCode.PROTO_REJECTED, "The projector rejected " + label + " (" + hex + ").");
  }
}
