/* platform.test.ts: The platform end to end: config in, accessories out, projector controlled, clean shutdown. */
import type { API, Logging } from "homebridge";
import { PLATFORM_NAME, PLUGIN_NAME } from "./settings.ts";
import { after, describe, test } from "node:test";
import { capturingLog, logCount, loggedAt, waitUntil } from "homebridge-plugin-utils/testing";
import { SonyProjectorsPlatform } from "./platform.ts";
import assert from "node:assert/strict";
import { createFakeApi } from "./fake-api.helpers.ts";
import registerPlugin from "./index.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { startFakeAdcp } from "./protocol/fake-adcp.helpers.ts";

const cleanups: (() => unknown)[] = [];

after(async () => Promise.all(cleanups.map(async (cleanup) => cleanup())));

function platformFor(config: Record<string, unknown>, fakeApi = createFakeApi()): { fakeApi: typeof fakeApi; log: ReturnType<typeof capturingLog>;
  platform: SonyProjectorsPlatform; } {

  const log = capturingLog();
  const platform = new SonyProjectorsPlatform(log as unknown as Logging, { platform: PLATFORM_NAME, ...config }, fakeApi.api);

  cleanups.push(() => fakeApi.shutdown(), () => fakeApi.cleanup());

  return { fakeApi, log, platform };
}

describe("SonyProjectorsPlatform", () => {

  test("the plugin registers the platform under its alias", () => {

    const calls: unknown[][] = [];

    registerPlugin({ registerPlatform: (...args: unknown[]) => calls.push(args) } as unknown as API);
    assert.equal(calls[0]?.[0], PLATFORM_NAME);
    assert.equal(calls[0]?.[1], SonyProjectorsPlatform);
  });

  test("does nothing, and says so, until a projector is configured", () => {

    const { fakeApi, log } = platformFor({});

    fakeApi.launch();

    assert.equal(fakeApi.external.length, 0);
    assert.ok(loggedAt(log.entries, "info", "No projectors are configured"));
  });

  test("configuration problems are logged as warnings and do not stop valid projectors", async () => {

    const fake = await startFakeAdcp();

    cleanups.push(async () => fake.close());

    const { fakeApi, log } = platformFor({ projectors: [ { name: "Broken" }, { host: fake.host, name: "Theater", port: fake.port, protocol: "adcp" } ] });

    fakeApi.launch();

    assert.ok(loggedAt(log.entries, "warn", "SPJ-CONFIG"));
    assert.equal(fakeApi.external.length, 1);
  });

  test("publishes a TV per projector that controls the real (fake) projector, and stops polling on shutdown", async () => {

    const fake = await startFakeAdcp({ transitionMs: 30 });

    cleanups.push(async () => fake.close());

    const { fakeApi } = platformFor({ projectors: [{ host: fake.host, name: "Theater", pollInterval: 3, port: fake.port, protocol: "adcp" }] });
    const { Characteristic, Service } = fakeApi.api.hap;

    fakeApi.launch();

    const tv = fakeApi.external[0]!;
    const active = tv.getService(Service.Television)!.getCharacteristic(Characteristic.Active);

    await waitUntil(() => fake.received.includes("power_status ?"), { description: "polled", timeoutMs: 3000 });
    await active.handleSetRequest(Characteristic.Active.ACTIVE);
    assert.equal(fake.state.power, "startup");

    fakeApi.shutdown();
    await sleep(50);

    const count = fake.received.length;

    await sleep(300);
    assert.equal(fake.received.length, count);
  });

  test("a hidden projector (Disable.Device) is not published", () => {

    const { fakeApi } = platformFor({ options: ["Disable.Device.10-0-0-5"], projectors: [{ host: "10.0.0.5" }] });

    fakeApi.launch();
    assert.equal(fakeApi.external.length, 0);
  });

  test("the companion accessory is registered when wanted, restored with working handlers, and removed when no longer wanted", async () => {

    const fake = await startFakeAdcp({ state: { power: "on" } });

    cleanups.push(async () => fake.close());

    const projector = { host: fake.host, name: "Theater", pollInterval: 3, port: fake.port, protocol: "adcp" };

    // First run: the companion is created and registered.
    const first = platformFor({ options: ["Enable.Controls.PictureMute"], projectors: [projector] });

    first.fakeApi.launch();
    assert.equal(first.fakeApi.registered.length, 1);

    const cached = first.fakeApi.registered[0]!;

    first.fakeApi.shutdown();

    // Second run: Homebridge restores the cached accessory. Its switch must still work.
    const second = platformFor({ options: ["Enable.Controls.PictureMute"], projectors: [projector] });
    const { Characteristic, Service } = second.fakeApi.api.hap;

    second.platform.configureAccessory(cached);
    second.fakeApi.launch();
    assert.equal(second.fakeApi.registered.length, 0, "a restored accessory is not registered twice");

    const mute = cached.getServiceById(Service.Switch, "control.pictureMute")!;

    await waitUntil(() => fake.received.includes("power_status ?"), { description: "polled", timeoutMs: 3000 });
    await mute.getCharacteristic(Characteristic.On).handleSetRequest(true);
    assert.equal(fake.state.blank, "on");
    second.fakeApi.shutdown();

    // Third run: the option is gone, so the cached companion is unregistered.
    const third = platformFor({ projectors: [projector] });

    third.platform.configureAccessory(cached);
    third.fakeApi.launch();
    assert.deepEqual(third.fakeApi.unregistered.map((accessory) => accessory.UUID), [cached.UUID]);
  });

  test("a startup failure is logged, never thrown", () => {

    const fakeApi = createFakeApi();
    const broken = { ...fakeApi.api, publishExternalAccessories: () => {

      throw new Error("boom");
    } } as unknown as API;
    const log = capturingLog();

    new SonyProjectorsPlatform(log as unknown as Logging, { platform: PLATFORM_NAME, projectors: [{ host: "10.0.0.5" }] }, broken);
    cleanups.push(() => fakeApi.shutdown(), () => fakeApi.cleanup());

    assert.doesNotThrow(() => fakeApi.launch());
    assert.equal(logCount(log.entries, "error", "boom"), 1);
    assert.ok(PLUGIN_NAME);
  });
});
