/* sdcp.test.ts: SdcpTransport against the fake SDCP projector. */
import { ErrorCode, isProjectorError } from "./errors.ts";
import { after, describe, test } from "node:test";
import type { FakeSdcp } from "./fake-sdcp.helpers.ts";
import { SdcpTransport } from "./sdcp.ts";
import assert from "node:assert/strict";
import { startFakeSdcp } from "./fake-sdcp.helpers.ts";

const fakes: FakeSdcp[] = [];
const transports: SdcpTransport[] = [];

after(async () => {

  transports.forEach((transport) => transport.close());
  await Promise.all(fakes.map(async (fake) => fake.close()));
});

async function setup(options: Parameters<typeof startFakeSdcp>[0] = {}, community?: string): Promise<{ fake: FakeSdcp; transport: SdcpTransport }> {

  const fake = await startFakeSdcp(options);
  const transport = new SdcpTransport({ commandTimeoutMs: 300, community, host: fake.host, pacingMs: 0, port: fake.port });

  fakes.push(fake);
  transports.push(transport);

  return { fake, transport };
}

const hasCode = (code: string) => (error: unknown): boolean => isProjectorError(error) && (error.code === code);

describe("SdcpTransport", () => {

  test("power round-trip", async () => {

    const { fake, transport } = await setup();

    assert.equal(await transport.getPower(), "standby");
    await transport.setPower(true);
    assert.equal(fake.state.power, 3);
    assert.equal(await transport.getPower(), "on");
  });

  test("input, picture mode, aspect and picture muting use the shared tokens", async () => {

    const { fake, transport } = await setup({ fragment: true, state: { power: 3 } });

    await transport.setInput("hdmi2");
    await transport.setPictureMode("game");
    await transport.setAspect("2.35_1_zoom");
    await transport.setBlank(true);

    assert.deepEqual([ fake.state.input, fake.state.pictureMode, fake.state.aspect, fake.state.muted ], [ 0x0003, 0x0005, 0x000d, 1 ]);
    assert.equal(await transport.getInput(), "hdmi2");
    assert.equal(await transport.getPictureMode(), "game");
    assert.equal(await transport.getAspect(), "2.35_1_zoom");
    assert.equal(await transport.getBlank(), true);
  });

  test("picture commands in standby are SPJ-BUSY", async () => {

    const { transport } = await setup();

    await assert.rejects(transport.getInput(), hasCode(ErrorCode.BUSY));
  });

  test("a wrong community is SPJ-COMMUNITY", async () => {

    const { transport } = await setup({}, "ABCD");

    await assert.rejects(transport.getPower(), hasCode(ErrorCode.COMMUNITY));
  });

  test("values the table does not know are refused without touching the network", async () => {

    const { transport } = await setup({ state: { power: 3 } });

    await assert.rejects(transport.setInput("hdmi3"), hasCode(ErrorCode.PROTO_REJECTED));
  });

  test("identity, lamp hours, faults and capabilities", async () => {

    const { transport } = await setup({ state: { errorBits: 0x0008, lampHours: 2100 } });

    assert.deepEqual(await transport.identify(), { model: "VPL-VW285ES", serial: "05012895" });
    assert.equal(await transport.getLightHours(), 2100);
    assert.deepEqual(await transport.getFaults(), { errors: ["temp_error"], warnings: [] });

    const capabilities = await transport.capabilities();

    assert.deepEqual(capabilities.inputs, [ "hdmi1", "hdmi2" ]);
    assert.equal(capabilities.remote, false);
    await assert.rejects(transport.sendKey("menu"), hasCode(ErrorCode.PROTO_UNSUPPORTED));
  });

  test("a lost reply during capability discovery fails discovery instead of disabling the feature", async () => {

    const { transport } = await setup({ drop: [0x0030] });

    await assert.rejects(transport.capabilities(), hasCode(ErrorCode.NET_TIMEOUT));
  });
});
