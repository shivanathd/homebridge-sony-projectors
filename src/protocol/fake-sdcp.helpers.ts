/* fake-sdcp.helpers.ts: A fake Sony SDCP (PJ Talk) projector for tests. */
import type { AddressInfo, Server, Socket } from "node:net";
import { FrameReader, Item, NgCode, decodeFrame } from "./sdcp-codec.ts";
import { createServer } from "node:net";

export interface FakeSdcpState {

  aspect: number;
  errorBits: number;
  input: number;
  lampHours: number;
  muted: number;
  pictureMode: number;
  power: number;
}

export interface FakeSdcp {

  close(): Promise<void>;
  readonly host: string;
  readonly port: number;
  readonly state: FakeSdcpState;
}

export async function startFakeSdcp({ community = "SONY", fragment = false, state: initial = {} }: { community?: string; fragment?: boolean;
  state?: Partial<FakeSdcpState>; } = {}): Promise<FakeSdcp> {

  const state: FakeSdcpState = { aspect: 0x0001, errorBits: 0, input: 0x0002, lampHours: 1500, muted: 0, pictureMode: 0x0000, power: 0, ...initial };
  const sockets = new Set<Socket>();

  const reply = (item: number, ok: boolean, data: Buffer): Buffer => {

    const frame = Buffer.alloc(10 + data.length);

    frame[0] = 0x02;
    frame[1] = 0x0a;
    frame.write(community, 2, "ascii");
    frame[6] = ok ? 0x01 : 0x00;
    frame.writeUInt16BE(item, 7);
    frame[9] = data.length;
    data.copy(frame, 10);

    return frame;
  };

  const word = (value: number): Buffer => {

    const data = Buffer.alloc(2);

    data.writeUInt16BE(value, 0);

    return data;
  };

  const settable: Partial<Record<number, keyof FakeSdcpState>> = {

    [Item.ASPECT]: "aspect", [Item.INPUT]: "input", [Item.PICTURE_MODE]: "pictureMode", [Item.PICTURE_MUTING]: "muted"
  };

  const handle = (request: Buffer): Buffer => {

    const { data, item } = decodeFrame(request);
    const isGet = request[6] === 0x01;

    if(request.subarray(2, 6).toString("ascii") !== community) {

      return reply(item, false, word(NgCode.COMMUNITY));
    }

    switch(item) {

      case Item.POWER_STATUS:

        return reply(item, true, word(state.power));

      case Item.POWER:

        state.power = (data.readUInt16BE(0) === 1) ? 3 : 0;

        return reply(item, true, Buffer.alloc(0));

      case Item.LAMP_TIMER:

        return reply(item, true, word(state.lampHours));

      case Item.ERROR_STATUS:

        return reply(item, true, word(state.errorBits));

      case Item.MODEL_NAME:

        return reply(item, true, Buffer.from("VPL-VW285ES\0\0\0\0\0", "ascii"));

      case Item.SERIAL_NUMBER:

        return reply(item, true, Buffer.from([ 0x00, 0x4c, 0x7d, 0x9f ]));

      default: {

        const key = settable[item];

        if(!key) {

          return reply(item, false, word(NgCode.INVALID_ITEM));
        }

        if(state.power !== 3) {

          return reply(item, false, word(NgCode.NOT_APPLICABLE));
        }

        if(isGet) {

          return reply(item, true, word(state[key]));
        }

        state[key] = data.readUInt16BE(0);

        return reply(item, true, Buffer.alloc(0));
      }
    }
  };

  const server: Server = createServer((socket) => {

    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => { /* The client went away. */ });

    let reader = new FrameReader();

    socket.on("data", (chunk: Buffer) => {

      const request = reader.push(chunk);

      if(!request) {

        return;
      }

      reader = new FrameReader();

      const response = handle(request);

      if(!fragment) {

        socket.write(response);

        return;
      }

      for(let index = 0; index < response.length; index++) {

        setTimeout(() => !socket.destroyed && socket.write(response.subarray(index, index + 1)), index);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {

    close: async (): Promise<void> => {

      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    host: "127.0.0.1",
    port: (server.address() as AddressInfo).port,
    state
  };
}
