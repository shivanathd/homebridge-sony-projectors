/* probe.test.ts: The settings UI's connection test. */
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { probeProjector } from "./probe.ts";
import { startFakeAdcp } from "./protocol/fake-adcp.helpers.ts";

const cleanups: (() => Promise<void>)[] = [];

after(async () => Promise.all(cleanups.map(async (cleanup) => cleanup())));

describe("probeProjector", () => {

  test("reports identity, protocol, capabilities, power and lamp hours", async () => {

    const fake = await startFakeAdcp({ password: "Projector", state: { power: "on", timer: 1240 } });

    cleanups.push(async () => fake.close());

    const result = await probeProjector({ host: fake.host, password: "Projector", port: fake.port, protocol: "adcp" });

    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.equal(result.protocol, "adcp");
    assert.equal(result.identity.model, "VPL-VW290ES");
    assert.equal(result.power, "on");
    assert.equal(result.lightHours, 1240);
    assert.equal(result.id, "127-0-0-1");
    assert.deepEqual(result.capabilities.inputs, [ "hdmi1", "hdmi2" ]);
  });

  test("a wrong password comes back as a coded, explained failure", async () => {

    const fake = await startFakeAdcp({ password: "Projector" });

    cleanups.push(async () => fake.close());

    const result = await probeProjector({ host: fake.host, password: "nope", port: fake.port, protocol: "adcp" });

    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.code, "SPJ-AUTH-FAILED");
    assert.match(result.hint, /password/i);
  });

  test("invalid input is rejected before any connection is made", async () => {

    const result = await probeProjector({ host: "bad host; rm" });

    assert.ok(!result.ok);
    assert.equal(result.code, "SPJ-CONFIG");
  });

  test("never echoes the password back", async () => {

    const result = await probeProjector({ host: "127.0.0.1", password: "Sup3rSecret", port: 1, protocol: "adcp" });

    assert.doesNotMatch(JSON.stringify(result), /Sup3rSecret/);
  });
});
