/* sdcp-codec.ts: Sony SDCP (PJ Talk) framing and value tables.
 *
 * A request is a 10-byte header followed by optional data:
 *
 *   VERSION(0x02) CATEGORY(0x0A) COMMUNITY(4 ASCII) ACTION(0x00 set / 0x01 get) ITEM(2, big-endian) LENGTH(1) DATA(LENGTH bytes)
 *
 * A reply uses the same layout. The action byte becomes 0x01 for OK or 0x00 for NG, and an NG reply carries a 2-byte error code as its data.
 *
 * Sources: Sony VPL-VW320/VW520 protocol manual (section 4), cross-checked against pySDCP and sony_projector_protocol (both MIT).
 */
import type { PowerState } from "./types.ts";

export const Action = { GET: 0x01, SET: 0x00 } as const;

export const Item = {

  ASPECT: 0x0020,
  ERROR_STATUS: 0x0101,
  INPUT: 0x0001,
  LAMP_TIMER: 0x0113,
  MODEL_NAME: 0x8001,
  PICTURE_MODE: 0x0002,
  PICTURE_MUTING: 0x0030,
  POWER: 0x0130,
  POWER_STATUS: 0x0102,
  SERIAL_NUMBER: 0x8002
} as const;

// NG reply error codes.
export const NgCode = {

  COMMUNITY: 0x0201,
  INVALID_DATA: 0x0104,
  INVALID_ITEM: 0x0101,
  INVALID_REQUEST: 0x0102,
  NOT_APPLICABLE: 0x0180
} as const;

const HEADER_BYTES = 10;

export function encodeRequest(action: number, item: number, value?: number, community = "SONY"): Buffer {

  if(!/^[\x20-\x7e]{4}$/.test(community)) {

    throw new Error("The SDCP community must be exactly 4 ASCII characters.");
  }

  const frame = Buffer.alloc(HEADER_BYTES + ((value === undefined) ? 0 : 2));

  frame[0] = 0x02;
  frame[1] = 0x0a;
  frame.write(community, 2, "ascii");
  frame[6] = action;
  frame.writeUInt16BE(item, 7);

  // The length is a binary byte. The 2017 sony-sdcp-com library wrote it in decimal, which only worked by accident for short payloads.
  frame[9] = (value === undefined) ? 0 : 2;

  if(value !== undefined) {

    frame.writeUInt16BE(value, 10);
  }

  return frame;
}

export interface SdcpFrame {

  data: Buffer;
  item: number;
  ok: boolean;
}

export function decodeFrame(frame: Buffer): SdcpFrame {

  const length = frame[9] ?? 0;

  return { data: frame.subarray(HEADER_BYTES, HEADER_BYTES + length), item: frame.readUInt16BE(7), ok: frame[6] === 0x01 };
}

// Accumulate TCP chunks until one whole frame (header plus its declared data) is available.
export class FrameReader {

  #buffer = Buffer.alloc(0);

  public push(chunk: Buffer): Buffer | null {

    this.#buffer = Buffer.concat([ this.#buffer, chunk ]);

    if(this.#buffer.length < HEADER_BYTES) {

      return null;
    }

    const total = HEADER_BYTES + (this.#buffer[9] ?? 0);

    return (this.#buffer.length >= total) ? this.#buffer.subarray(0, total) : null;
  }
}

const TABLES = {

  aspect: { "1.85_1_zoom": 0x000c, "2.35_1_zoom": 0x000d, normal: 0x0001, squeeze: 0x000f, stretch: 0x000e, "v_stretch": 0x000b },
  input: { hdmi1: 0x0002, hdmi2: 0x0003 },
  pictureMode: {

    "brt_cinema": 0x0006, "brt_tv": 0x0007, "cinema_film1": 0x0000, "cinema_film2": 0x0001, game: 0x0005, photo: 0x0004, reference: 0x0002, tv: 0x0003, user: 0x0008
  }
} as const satisfies Record<string, Record<string, number>>;

const POWER: Record<number, PowerState> = { 0: "standby", 1: "warming", 2: "warming", 3: "on", 4: "cooling", 5: "cooling" };

export type Table = keyof typeof TABLES | "power";

export function fromCode(table: Table, code: number): string {

  if(table === "power") {

    return POWER[code] ?? "unknown";
  }

  const entry = Object.entries(TABLES[table]).find(([ , value ]) => value === code);

  return entry?.[0] ?? ("unknown_" + code.toString(16).padStart(4, "0"));
}

export function toCode(table: keyof typeof TABLES, token: string): number | undefined {

  return (TABLES[table] as Record<string, number>)[token];
}

export function tokens(table: keyof typeof TABLES): string[] {

  return Object.entries(TABLES[table]).sort(([ , a ], [ , b ]) => a - b).map(([name]) => name);
}

const FAULT_BITS: [number, string][] = [ [ 0x0001, "lamp_error" ], [ 0x0002, "fan_error" ], [ 0x0004, "cover_error" ], [ 0x0008, "temp_error" ],
  [ 0x0010, "power_error" ] ];

export function faultNames(bitmask: number): string[] {

  return FAULT_BITS.filter(([bit]) => (bitmask & bit) !== 0).map(([ , name ]) => name);
}
