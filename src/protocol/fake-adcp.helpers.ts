/* fake-adcp.helpers.ts: A fake Sony ADCP projector for tests.
 *
 * A real TCP server on 127.0.0.1 that speaks ADCP the way a VPL-VW290ES does: NOKEY or a SHA-256 challenge, one reply line per command, err_inactive for picture
 * commands while the projector is not on, and timed warm-up and cool-down. Options make it misbehave on purpose (fragmented replies, silence, garbage) so the
 * transport's failure handling can be tested without hardware.
 */
import type { AddressInfo, Server, Socket } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";

export interface FakeAdcpState {

  aspect: string;
  blank: "off" | "on";
  errors: string[];
  input: string;
  keys: string[];
  pictureMode: string;
  power: "cooling1" | "on" | "standby" | "startup";
  timer: number;
  warnings: string[];
}

export interface FakeAdcpOptions {

  // Reply with this greeting instead of NOKEY or a challenge.
  greeting?: string;

  // Advertise value ranges through `--info`. Off simulates older firmware.
  info?: boolean;

  // Commands that answer err_cmd, as if this model did not have them.
  unsupported?: string[];

  // Write each reply one byte at a time.
  fragment?: boolean;
  password?: string;

  // Listen on this port instead of a random free one.
  port?: number;

  // Accept connections but never send anything.
  silent?: boolean;
  state?: Partial<FakeAdcpState>;
  transitionMs?: number;
}

export interface FakeAdcp {

  readonly authAttempts: number;
  close(): Promise<void>;
  readonly connections: number;
  readonly host: string;
  readonly port: number;
  readonly received: string[];
  readonly state: FakeAdcpState;
}

const RANGES: Record<string, string[]> = {

  aspect: [ "normal", "v_stretch", "1.85_1_zoom", "2.35_1_zoom", "stretch", "squeeze" ],
  input: [ "hdmi1", "hdmi2" ],
  key: [ "up", "down", "left", "right", "enter", "return", "menu" ],
  "picture_mode": [ "cinema_film1", "cinema_film2", "reference", "tv", "photo", "game", "brt_cinema", "brt_tv", "user" ]
};

const STATE_KEY: Record<string, "aspect" | "blank" | "input" | "pictureMode"> = { aspect: "aspect", blank: "blank", input: "input", "picture_mode": "pictureMode" };

export async function startFakeAdcp(options: FakeAdcpOptions = {}): Promise<FakeAdcp> {

  const state: FakeAdcpState = {

    aspect: "normal", blank: "off", errors: [], input: "hdmi1", keys: [], pictureMode: "cinema_film1", power: "standby", timer: 1240, warnings: [],
    ...options.state
  };
  const received: string[] = [];
  const sockets = new Set<Socket>();
  const timers = new Set<NodeJS.Timeout>();
  let authAttempts = 0;
  let connections = 0;

  const later = (fn: () => void): void => {

    const timer = setTimeout(() => {

      timers.delete(timer);
      fn();
    }, options.transitionMs ?? 50);

    timers.add(timer);
  };

  const handle = (line: string): string => {

    const match = /^([a-z0-9_]+)\s*(.*)$/.exec(line.trim());
    const command = match?.[1] ?? "";
    const argument = (match?.[2] ?? "").trim();

    if(options.unsupported?.includes(command)) {

      return "err_cmd";
    }

    if(argument.endsWith("--info")) {

      const range = RANGES[command];

      return (options.info !== false) && range ? JSON.stringify({ range: range.map((value) => "\"" + value + "\""), type: "string" }) : "err_cmd";
    }

    const query = argument === "?";
    const value = argument.replace(/^"(.*)"$/, "$1");

    switch(command) {

      case "power_status":

        return "\"" + state.power + "\"";

      case "power":

        if(value === "on") {

          if(state.power.startsWith("cooling")) {

            return "err_inactive";
          }

          if(state.power === "standby") {

            state.power = "startup";
            later(() => state.power = "on");
          }

          return "ok";
        }

        if(value === "off") {

          if(state.power === "startup") {

            return "err_inactive";
          }

          if(state.power === "on") {

            state.power = "cooling1";
            later(() => state.power = "standby");
          }

          return "ok";
        }

        return "err_val";

      case "aspect":
      case "blank":
      case "input":
      case "picture_mode": {

        if(state.power !== "on") {

          return "err_inactive";
        }

        const key = STATE_KEY[command]!;

        if(query) {

          return "\"" + state[key] + "\"";
        }

        const valid = (command === "blank") ? [ "on", "off" ] : RANGES[command]!;

        if(!valid.includes(value)) {

          return "err_val";
        }

        (state as unknown as Record<string, string>)[key] = value;

        return "ok";
      }

      case "key":

        if(!RANGES["key"]!.includes(value)) {

          return "err_val";
        }

        state.keys.push(value);

        return "ok";

      case "timer":

        return JSON.stringify([{ "light_src": state.timer }]);

      case "error":

        return JSON.stringify(state.errors.length ? state.errors : ["no_err"]);

      case "warning":

        return JSON.stringify(state.warnings.length ? state.warnings : ["no_warn"]);

      case "modelname":

        return "\"VPL-VW290ES\"";

      case "serialnum":

        return "\"5012345\"";

      case "version":

        return "[{\"main\":\"1.020\"}]";

      case "mac_address":

        return "\"04:5d:4b:12:34:56\"";

      default:

        return "err_cmd";
    }
  };

  const server: Server = createServer((socket) => {

    connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => { /* The client went away; nothing to do. */ });

    if(options.silent) {

      return;
    }

    const write = (text: string): void => {

      const data = text + "\r\n";

      if(!options.fragment) {

        socket.write(data);

        return;
      }

      const bytes = Buffer.from(data, "latin1");

      for(let index = 0; index < bytes.length; index++) {

        setTimeout(() => !socket.destroyed && socket.write(bytes.subarray(index, index + 1)), index);
      }
    };

    const challenge = options.password ? randomBytes(8).toString("hex") : undefined;
    let authenticated = !challenge;
    let buffer = "";

    write(options.greeting ?? challenge ?? "NOKEY");

    socket.on("data", (chunk) => {

      buffer += chunk.toString("utf8");

      for(let index = buffer.indexOf("\r\n"); index !== -1; index = buffer.indexOf("\r\n")) {

        const line = buffer.slice(0, index);

        buffer = buffer.slice(index + 2);

        if(!authenticated) {

          authAttempts++;

          if(line === createHash("sha256").update(challenge! + options.password!).digest("hex")) {

            authenticated = true;
            write("ok");
          } else {

            write("err_auth");
            socket.end();
          }

          continue;
        }

        received.push(line);
        write(handle(line));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));

  return {

    get authAttempts(): number {

      return authAttempts;
    },
    close: async (): Promise<void> => {

      timers.forEach(clearTimeout);

      for(const socket of sockets) {

        socket.destroy();
      }

      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    get connections(): number {

      return connections;
    },
    host: "127.0.0.1",
    port: (server.address() as AddressInfo).port,
    received,
    state
  };
}
