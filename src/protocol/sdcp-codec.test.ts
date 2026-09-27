/* sdcp-codec.test.ts: SDCP (PJ Talk) framing and code tables. */
import { Action, FrameReader, Item, decodeFrame, encodeRequest, faultNames, fromCode, toCode } from "./sdcp-codec.ts";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

describe("encodeRequest", () => {

  test("a GET has the 10-byte header and zero data length", () => {

    assert.equal(encodeRequest(Action.GET, Item.POWER_STATUS).toString("hex"), "020a534f4e590101020" + "0");
  });

  test("a SET carries a 2-byte big-endian value and a binary length byte", () => {

    assert.equal(encodeRequest(Action.SET, Item.POWER, 1).toString("hex"), "020a534f4e59000130020001");
  });

  test("uses the configured community", () => {

    assert.equal(encodeRequest(Action.GET, Item.INPUT, undefined, "ABCD").subarray(2, 6).toString("ascii"), "ABCD");
  });

  test("rejects a community that is not exactly 4 ASCII characters", () => {

    assert.throws(() => encodeRequest(Action.GET, Item.INPUT, undefined, "SONY1"), /community/i);
  });
});

describe("decodeFrame", () => {

  test("decodes an OK reply with a 2-byte value", () => {

    const frame = decodeFrame(Buffer.from("020a534f4e5901010202" + "0003", "hex"));

    assert.deepEqual(frame, { data: Buffer.from("0003", "hex"), item: Item.POWER_STATUS, ok: true });
  });

  test("decodes an NG reply", () => {

    const frame = decodeFrame(Buffer.from("020a534f4e5900010202" + "0201", "hex"));

    assert.equal(frame.ok, false);
    assert.equal(frame.data.readUInt16BE(0), 0x0201);
  });
});

describe("FrameReader", () => {

  test("assembles a frame split across many chunks, and ignores trailing bytes", () => {

    const reader = new FrameReader();
    const bytes = Buffer.from("020a534f4e5901800104" + "56504c2d" + "ff", "hex");
    let frame: Buffer | null = null;

    for(const byte of bytes) {

      frame ??= reader.push(Buffer.from([byte]));
    }

    assert.ok(frame);
    assert.equal(frame.length, 14);
  });

  test("returns null until a whole frame has arrived", () => {

    const reader = new FrameReader();

    assert.equal(reader.push(Buffer.from("020a534f4e59", "hex")), null);
  });
});

describe("code tables", () => {

  test("translate to and from the ADCP-style tokens the rest of the plugin uses", () => {

    assert.equal(fromCode("input", 0x0002), "hdmi1");
    assert.equal(toCode("input", "hdmi2"), 0x0003);
    assert.equal(fromCode("pictureMode", 0x0006), "brt_cinema");
    assert.equal(toCode("pictureMode", "reference"), 0x0002);
    assert.equal(fromCode("aspect", 0x000d), "2.35_1_zoom");
    assert.equal(toCode("aspect", "v_stretch"), 0x000b);
    assert.equal(fromCode("power", 0x0002), "warming");
    assert.equal(fromCode("power", 0x0005), "cooling");
  });

  test("unknown values", () => {

    assert.equal(fromCode("input", 0x00ff), "unknown_00ff");
    assert.equal(toCode("input", "hdmi9"), undefined);
  });

  test("fault bitmask", () => {

    assert.deepEqual(faultNames(0), []);
    assert.deepEqual(faultNames(0x0009), [ "lamp_error", "temp_error" ]);
  });
});
