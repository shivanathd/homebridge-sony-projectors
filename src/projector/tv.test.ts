/* tv.test.ts: The Television accessory against a real HAP stack, a real controller and the fake projector. */
import { Categories, FeatureOptions, HAPStatus } from "homebridge-plugin-utils";
import { after, describe, test } from "node:test";
import { capturingLog, waitUntil } from "homebridge-plugin-utils/testing";
import { featureOptionCategories, featureOptions } from "../options.ts";
import type { FakeAdcpOptions } from "../protocol/fake-adcp.helpers.ts";
import type { FakeApi } from "../fake-api.helpers.ts";
import type { HomebridgePluginLogging } from "homebridge-plugin-utils";
import { ProjectorCache } from "./cache.ts";
import type { ProjectorConfig } from "../config.ts";
import { ProjectorController } from "./controller.ts";
import { TelevisionAccessory } from "./tv.ts";
import assert from "node:assert/strict";
import { createFakeApi } from "../fake-api.helpers.ts";
import { createServer } from "node:net";
import { startFakeAdcp } from "../protocol/fake-adcp.helpers.ts";

const TIMINGS = { authPauseMs: 100, backoffCeilingMs: 50, faultsEveryMs: 0, lightHoursEveryMs: 0, pollMs: 30, standbyPollMs: 30, transitionPollMs: 20 };
const cleanups: (() => unknown)[] = [];

after(async () => Promise.all(cleanups.map(async (cleanup) => cleanup())));

interface Rig {

  fake: Awaited<ReturnType<typeof startFakeAdcp>> | null;
  controller: ProjectorController;
  fakeApi: FakeApi;
  log: ReturnType<typeof capturingLog>;
  tv: TelevisionAccessory;
}

async function rig({ configured = [], fakeOptions = {}, unreachable = false }: { configured?: string[]; fakeOptions?: FakeAdcpOptions; unreachable?: boolean } =
  {}): Promise<Rig> {

  const fake = unreachable ? null : await startFakeAdcp({ transitionMs: 40, ...fakeOptions });
  let port = fake?.port ?? 0;

  if(!fake) {

    const server = createServer();

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const fakeApi = createFakeApi();
  const abort = new AbortController();
  const log = capturingLog();
  const options = new FeatureOptions(featureOptionCategories, featureOptions, configured);
  const config: ProjectorConfig = { adcpPort: port, community: "SONY", host: "127.0.0.1", id: "127-0-0-1", name: "Theater", password: "", pollIntervalSeconds: 10,
    protocol: "adcp", sdcpPort: 1 };
  const controller = new ProjectorController({ config, isEnabled: (option) => options.test(option, config.id), log, pacingMs: 0, signal: abort.signal,
    timings: TIMINGS });
  const context = { api: fakeApi.api, cache: new ProjectorCache(fakeApi.storagePath, log), config, controller,
    enabled: (option: string) => options.test(option, config.id), log, value: (option: string) => options.value(option, config.id) };
  const tv = new TelevisionAccessory(context);

  cleanups.push(() => abort.abort(), () => fakeApi.cleanup(), async () => fake?.close());
  controller.start();

  return { controller, fake, fakeApi, log, tv };
}

describe("TelevisionAccessory", () => {

  test("is a Television with information, inputs linked to it, and a remote", async () => {

    const { fakeApi, tv } = await rig();
    const { Characteristic, Service } = fakeApi.api.hap;
    const television = tv.accessory.getService(Service.Television)!;
    const inputs = tv.accessory.services.filter((service) => service.UUID === Service.InputSource.UUID);

    assert.equal(tv.accessory.category, Categories.TELEVISION);
    assert.equal(tv.accessory.getService(Service.AccessoryInformation)?.getCharacteristic(Characteristic.Manufacturer).value, "Sony");
    assert.equal(television.getCharacteristic(Characteristic.ConfiguredName).value, "Theater");
    assert.deepEqual(inputs.map((input) => input.getCharacteristic(Characteristic.ConfiguredName).value), [ "HDMI 1", "HDMI 2" ]);
    assert.deepEqual(inputs.map((input) => input.getCharacteristic(Characteristic.Identifier).value), [ 1, 2 ]);
    assert.equal(television.linkedServices.length, 2);
  });

  test("reads come from the cache and writes turn the projector on", async () => {

    const { controller, fake, fakeApi, tv } = await rig();
    const { Characteristic, Service } = fakeApi.api.hap;
    const active = tv.accessory.getService(Service.Television)!.getCharacteristic(Characteristic.Active);

    await waitUntil(() => controller.store.get("reachable"), { description: "reachable", timeoutMs: 2000 });
    assert.equal(await active.handleGetRequest(), Characteristic.Active.INACTIVE);

    await active.handleSetRequest(Characteristic.Active.ACTIVE);
    assert.equal(fake!.state.power, "startup");
    assert.equal(active.value, Characteristic.Active.ACTIVE);
  });

  test("an unreachable projector reads as No Response and rejects writes with a communication failure", async () => {

    const { fakeApi, tv } = await rig({ unreachable: true });
    const { Characteristic, Service } = fakeApi.api.hap;
    const active = tv.accessory.getService(Service.Television)!.getCharacteristic(Characteristic.Active);
    const isCommunicationFailure = (error: unknown): boolean => (error === HAPStatus.SERVICE_COMMUNICATION_FAILURE) ||
      ((error as { hapStatus?: number }).hapStatus === HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    await assert.rejects(active.handleGetRequest(), isCommunicationFailure);
    await assert.rejects(active.handleSetRequest(Characteristic.Active.ACTIVE), isCommunicationFailure);
  });

  test("selecting an input switches the projector; external input changes move the tile", async () => {

    const { controller, fake, fakeApi, tv } = await rig({ fakeOptions: { state: { power: "on" } } });
    const { Characteristic, Service } = fakeApi.api.hap;
    const identifier = tv.accessory.getService(Service.Television)!.getCharacteristic(Characteristic.ActiveIdentifier);

    await waitUntil(() => controller.store.get("input") === "hdmi1", { description: "input known", timeoutMs: 2000 });
    await identifier.handleSetRequest(2);
    assert.equal(fake!.state.input, "hdmi2");

    fake!.state.input = "hdmi1";
    await waitUntil(() => identifier.value === 1, { description: "tile follows the projector", timeoutMs: 2000 });
  });

  test("Apple TV Remote buttons map to projector keys, and Play/Pause mutes the picture by default", async () => {

    const { controller, fake, fakeApi, tv } = await rig({ fakeOptions: { state: { power: "on" } } });
    const { Characteristic, Service } = fakeApi.api.hap;
    const television = tv.accessory.getService(Service.Television)!;
    const key = television.getCharacteristic(Characteristic.RemoteKey);

    await waitUntil(() => controller.store.get("blank") === false, { description: "blank known", timeoutMs: 2000 });
    await key.handleSetRequest(Characteristic.RemoteKey.ARROW_UP);
    await key.handleSetRequest(Characteristic.RemoteKey.SELECT);
    await key.handleSetRequest(Characteristic.RemoteKey.BACK);
    await key.handleSetRequest(Characteristic.RemoteKey.INFORMATION);
    await key.handleSetRequest(Characteristic.RemoteKey.PLAY_PAUSE);
    await television.getCharacteristic(Characteristic.PowerModeSelection).handleSetRequest(Characteristic.PowerModeSelection.SHOW);

    assert.deepEqual(fake!.state.keys, [ "up", "enter", "return", "menu", "menu" ]);
    assert.equal(fake!.state.blank, "on");
  });

  test("remote buttons can be remapped or disabled with feature options", async () => {

    const { controller, fake, fakeApi, tv } = await rig({ configured: [ "Enable.Remote.PlayPause=none", "Enable.Remote.Info=return" ],
      fakeOptions: { state: { power: "on" } } });
    const { Characteristic, Service } = fakeApi.api.hap;
    const key = tv.accessory.getService(Service.Television)!.getCharacteristic(Characteristic.RemoteKey);

    await waitUntil(() => controller.store.get("reachable"), { description: "reachable", timeoutMs: 2000 });
    await key.handleSetRequest(Characteristic.RemoteKey.PLAY_PAUSE);
    await key.handleSetRequest(Characteristic.RemoteKey.INFORMATION);

    assert.deepEqual(fake!.state.keys, ["return"]);
    assert.equal(fake!.state.blank, "off");
  });

  test("renaming or hiding an input in the Home app is remembered", async () => {

    const { fakeApi, tv } = await rig();
    const { Characteristic, Service } = fakeApi.api.hap;
    const hdmi2 = tv.accessory.services.find((service) => (service.UUID === Service.InputSource.UUID) && (service.subtype === "input.hdmi2"))!;

    await hdmi2.getCharacteristic(Characteristic.ConfiguredName).handleSetRequest("Apple TV");
    await hdmi2.getCharacteristic(Characteristic.TargetVisibilityState).handleSetRequest(Characteristic.TargetVisibilityState.HIDDEN);

    assert.equal(hdmi2.getCharacteristic(Characteristic.CurrentVisibilityState).value, Characteristic.CurrentVisibilityState.HIDDEN);
    assert.deepEqual(new ProjectorCache(fakeApi.storagePath, capturingLog()).get("127-0-0-1").inputs, { hdmi2: { hidden: true, name: "Apple TV" } });
  });
});
