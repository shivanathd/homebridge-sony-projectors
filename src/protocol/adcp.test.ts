/* adcp.test.ts: AdcpTransport against the fake projector. */
import { CLOSED_PORT, startFakeAdcp } from "./fake-adcp.helpers.ts";
import { ErrorCode, isProjectorError } from "./errors.ts";
import type { FakeAdcp, FakeAdcpOptions } from "./fake-adcp.helpers.ts";
import { after, describe, test } from "node:test";
import { AdcpTransport } from "./adcp.ts";
import { DEFAULT_CAPABILITIES } from "./types.ts";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

const fakes: FakeAdcp[] = [];
const transports: AdcpTransport[] = [];

after(async () => {

  transports.forEach((transport) => transport.close());
  await Promise.all(fakes.map(async (fake) => fake.close()));
});

async function setup(options: FakeAdcpOptions = {}, transportOptions: { password?: string; commandTimeoutMs?: number } = {}):
Promise<{ fake: FakeAdcp; traces: string[]; transport: AdcpTransport }> {

  const fake = await startFakeAdcp({ transitionMs: 30, ...options });
  const traces: string[] = [];
  const transport = new AdcpTransport({ debug: (message) => traces.push(message), host: fake.host, pacingMs: 0, port: fake.port, ...transportOptions });

  fakes.push(fake);
  transports.push(transport);

  return { fake, traces, transport };
}

const hasCode = (code: string) => (error: unknown): boolean => isProjectorError(error) && (error.code === code);

describe("AdcpTransport: connection and authentication", () => {

  test("works without a password when the projector says NOKEY", async () => {

    const { transport } = await setup();

    assert.equal(await transport.getPower(), "standby");
  });

  test("answers the SHA-256 challenge when a password is configured", async () => {

    const { fake, transport } = await setup({ password: "Projector" }, { password: "Projector" });

    assert.equal(await transport.getPower(), "standby");
    assert.equal(fake.authAttempts, 1);
  });

  test("a wrong password is SPJ-AUTH-FAILED", async () => {

    const { transport } = await setup({ password: "Projector" }, { password: "wrong" });

    await assert.rejects(transport.getPower(), hasCode(ErrorCode.AUTH_FAILED));
  });

  test("a missing password is SPJ-AUTH-REQUIRED and nothing is sent", async () => {

    const { fake, transport } = await setup({ password: "Projector" });

    await assert.rejects(transport.getPower(), hasCode(ErrorCode.AUTH_REQUIRED));
    assert.equal(fake.authAttempts, 0);
  });

  test("the password and its hash never appear in debug traces", async () => {

    const { traces, transport } = await setup({ password: "Sup3rSecret" }, { password: "Sup3rSecret" });

    await transport.getPower();

    const all = traces.join("\n");

    assert.ok(traces.length > 0);
    assert.doesNotMatch(all, /Sup3rSecret/);
    assert.doesNotMatch(all, /[0-9a-f]{64}/);
  });

  test("reassembles replies that arrive one byte at a time", async () => {

    const { transport } = await setup({ fragment: true, password: "p" }, { password: "p" });

    assert.equal(await transport.getPower(), "standby");
  });

  test("a projector that never answers is SPJ-NET-TIMEOUT", async () => {

    const { transport } = await setup({ silent: true }, { commandTimeoutMs: 200 });

    await assert.rejects(transport.getPower(), hasCode(ErrorCode.NET_TIMEOUT));
  });

  test("nothing listening is SPJ-NET-UNREACHABLE", async () => {

    const transport = new AdcpTransport({ host: "127.0.0.1", pacingMs: 0, port: CLOSED_PORT });

    transports.push(transport);
    await assert.rejects(transport.getPower(), hasCode(ErrorCode.NET_UNREACHABLE));
  });

  test("an empty greeting is SPJ-PROTO-INVALID", async () => {

    const { transport } = await setup({ greeting: "" });

    await assert.rejects(transport.getPower(), hasCode(ErrorCode.PROTO_INVALID));
  });
});

describe("AdcpTransport: commands", () => {

  test("power on goes through warm-up to on", async () => {

    const { fake, transport } = await setup();

    await transport.setPower(true);
    assert.equal(await transport.getPower(), "warming");
    await sleep(60);
    assert.equal(await transport.getPower(), "on");
    assert.equal(fake.state.power, "on");
  });

  test("picture commands in standby are SPJ-BUSY", async () => {

    const { transport } = await setup();

    await assert.rejects(transport.getInput(), hasCode(ErrorCode.BUSY));
  });

  test("input, picture mode, aspect and blank round-trip when on", async () => {

    const { fake, transport } = await setup({ state: { power: "on" } });

    await transport.setInput("hdmi2");
    await transport.setPictureMode("game");
    await transport.setAspect("2.35_1_zoom");
    await transport.setBlank(true);

    assert.equal(await transport.getInput(), "hdmi2");
    assert.equal(await transport.getPictureMode(), "game");
    assert.equal(await transport.getAspect(), "2.35_1_zoom");
    assert.equal(await transport.getBlank(), true);
    assert.equal(fake.state.pictureMode, "game");
  });

  test("an invalid value is SPJ-PROTO-REJECTED and an unknown command is SPJ-PROTO-UNSUPPORTED", async () => {

    const { transport } = await setup({ state: { power: "on" }, unsupported: ["aspect"] });

    await assert.rejects(transport.setInput("hdmi9"), hasCode(ErrorCode.PROTO_REJECTED));
    await assert.rejects(transport.getAspect(), hasCode(ErrorCode.PROTO_UNSUPPORTED));
  });

  test("unsafe values are refused before anything is sent", async () => {

    const { fake, transport } = await setup({ state: { power: "on" } });

    await assert.rejects(transport.setInput("hdmi1\"\r\npower \"off"), hasCode(ErrorCode.PROTO_REJECTED));
    await assert.rejects(transport.sendKey("up down"), hasCode(ErrorCode.PROTO_REJECTED));
    assert.equal(fake.connections, 0);
  });

  test("remote keys, light hours and faults", async () => {

    const { fake, transport } = await setup({ state: { errors: ["err_temp"], power: "on", timer: 777 } });

    await transport.sendKey("menu");
    assert.deepEqual(fake.state.keys, ["menu"]);
    assert.equal(await transport.getLightHours(), 777);
    assert.deepEqual(await transport.getFaults(), { errors: ["err_temp"], warnings: [] });
  });

  test("identify reads model, serial, firmware and MAC in one session", async () => {

    const { fake, transport } = await setup();

    assert.deepEqual(await transport.identify(), { firmware: "1.020", macAddress: "04:5d:4b:12:34:56", model: "VPL-VW290ES", serial: "5012345" });
    assert.equal(fake.connections, 1);
  });
});

describe("AdcpTransport: capabilities", () => {

  test("reads value ranges from --info", async () => {

    const { transport } = await setup({ state: { power: "on" } });
    const capabilities = await transport.capabilities();

    assert.deepEqual(capabilities.inputs, [ "hdmi1", "hdmi2" ]);
    assert.ok(capabilities.pictureModes.includes("brt_cinema"));
    assert.ok(capabilities.aspects.includes("2.35_1_zoom"));
    assert.equal(capabilities.blank, true);
    assert.equal(capabilities.lightHours, true);
  });

  test("falls back to the default lists on firmware without --info, and drops what the model rejects", async () => {

    const { transport } = await setup({ info: false, state: { power: "on" }, unsupported: [ "blank", "timer" ] });
    const capabilities = await transport.capabilities();

    assert.deepEqual(capabilities.inputs, DEFAULT_CAPABILITIES.inputs);
    assert.deepEqual(capabilities.pictureModes, DEFAULT_CAPABILITIES.pictureModes);
    assert.equal(capabilities.blank, false);
    assert.equal(capabilities.lightHours, false);
  });
});

describe("AdcpTransport: poll", () => {

  test("reads power, picture settings, lamp hours and faults over a single connection", async () => {

    const { fake, transport } = await setup({ password: "Projector", state: { errors: ["err_temp"], input: "hdmi2", power: "on", timer: 321 } },
      { password: "Projector" });
    const result = await transport.poll({ blank: true, faults: true, lightHours: true, picture: true });

    assert.equal(fake.connections, 1);
    assert.equal(fake.authAttempts, 1);
    assert.equal(result.power, "on");
    assert.deepEqual(result.input, { value: "hdmi2" });
    assert.deepEqual(result.blank, { value: false });
    assert.deepEqual(result.lightHours, { value: 321 });
    assert.deepEqual(result.faults, { value: { errors: ["err_temp"], warnings: [] } });
  });

  test("readings unavailable in standby come back as per-reading errors, not a failed poll", async () => {

    const { transport } = await setup();
    const result = await transport.poll({ blank: false, faults: false, lightHours: false, picture: true });

    assert.equal(result.power, "standby");
    assert.ok(result.input && ("error" in result.input) && isProjectorError(result.input.error) && (result.input.error.code === ErrorCode.BUSY));
  });
});
