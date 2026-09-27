/* companion.test.ts: Picture-mode and aspect switches, Picture Mute, and the automation sensors. */
import { after, describe, test } from "node:test";
import { capturingLog, waitUntil } from "homebridge-plugin-utils/testing";
import { featureOptionCategories, featureOptions } from "../options.ts";
import { CompanionAccessory } from "./companion.ts";
import type { FakeAdcpOptions } from "../protocol/fake-adcp.helpers.ts";
import { FeatureOptions } from "homebridge-plugin-utils";
import { ProjectorCache } from "./cache.ts";
import type { ProjectorConfig } from "../config.ts";
import { ProjectorController } from "./controller.ts";
import type { Service } from "homebridge";
import assert from "node:assert/strict";
import { createFakeApi } from "../fake-api.helpers.ts";
import { startFakeAdcp } from "../protocol/fake-adcp.helpers.ts";

const TIMINGS = { authPauseMs: 100, backoffCeilingMs: 50, faultsEveryMs: 0, lightHoursEveryMs: 0, pollMs: 30, standbyPollMs: 30, transitionPollMs: 20 };
const cleanups: (() => unknown)[] = [];

after(async () => Promise.all(cleanups.map(async (cleanup) => cleanup())));

async function rig(configured: string[], fakeOptions: FakeAdcpOptions = {}) {

  const fake = await startFakeAdcp({ transitionMs: 40, ...fakeOptions });
  const fakeApi = createFakeApi();
  const abort = new AbortController();
  const log = capturingLog();
  const options = new FeatureOptions(featureOptionCategories, featureOptions, configured);
  const config: ProjectorConfig = { adcpPort: fake.port, community: "SONY", host: "127.0.0.1", id: "127-0-0-1", name: "Theater", password: "",
    pollIntervalSeconds: 10, protocol: "adcp", sdcpPort: 1 };
  const controller = new ProjectorController({ config, isEnabled: (option) => options.test(option, config.id), log, pacingMs: 0, signal: abort.signal,
    timings: TIMINGS });
  const context = { api: fakeApi.api, cache: new ProjectorCache(fakeApi.storagePath, log), config, controller,
    enabled: (option: string) => options.test(option, config.id), log, value: (option: string) => options.value(option, config.id) };
  const accessory = new fakeApi.api.platformAccessory("Theater Controls", fakeApi.api.hap.uuid.generate("companion"));
  const companion = new CompanionAccessory(context, accessory);

  cleanups.push(() => abort.abort(), () => fakeApi.cleanup(), async () => fake.close());
  controller.start();

  const { Characteristic, Service: Services } = fakeApi.api.hap;
  const bySubtype = (subtype: string): Service | undefined => accessory.services.find((service) => service.subtype === subtype);

  return { Characteristic, Services, accessory, bySubtype, companion, context, controller, fake };
}

describe("CompanionAccessory", () => {

  test("is only wanted when at least one extra is enabled", async () => {

    const off = await rig([]);
    const on = await rig(["Enable.Sensors.Ready"]);

    assert.equal(CompanionAccessory.wanted(off.context), false);
    assert.equal(CompanionAccessory.wanted(on.context), true);
  });

  test("picture-mode switches select a mode and behave like radio buttons", async () => {

    const { Characteristic, bySubtype, controller, fake } = await rig(["Enable.Picture.Switches"], { state: { power: "on" } });

    await waitUntil(() => controller.store.get("pictureMode") === "cinema_film1", { description: "mode known", timeoutMs: 2000 });

    const game = bySubtype("picture.game")!;
    const film = bySubtype("picture.cinema_film1")!;

    assert.equal(game.getCharacteristic(Characteristic.ConfiguredName).value, "Game Mode");
    assert.equal(film.getCharacteristic(Characteristic.On).value, true);

    await game.getCharacteristic(Characteristic.On).handleSetRequest(true);

    assert.equal(fake.state.pictureMode, "game");
    assert.equal(game.getCharacteristic(Characteristic.On).value, true);
    assert.equal(film.getCharacteristic(Characteristic.On).value, false);

    // Turning the active mode off is not possible; the switch springs back.
    await game.getCharacteristic(Characteristic.On).handleSetRequest(false);
    await waitUntil(() => game.getCharacteristic(Characteristic.On).value === true, { description: "springs back", timeoutMs: 1000 });
    assert.equal(fake.state.pictureMode, "game");
  });

  test("aspect switches and Picture Mute", async () => {

    const { Characteristic, bySubtype, controller, fake } = await rig([ "Enable.Aspect.Switches", "Enable.Controls.PictureMute" ], { state: { power: "on" } });

    await waitUntil(() => controller.store.get("aspect") === "normal", { description: "aspect known", timeoutMs: 2000 });

    const zoom = bySubtype("aspect.2.35_1_zoom")!;

    assert.equal(zoom.getCharacteristic(Characteristic.ConfiguredName).value, "Aspect 2.35 Zoom");
    await zoom.getCharacteristic(Characteristic.On).handleSetRequest(true);
    await bySubtype("control.pictureMute")!.getCharacteristic(Characteristic.On).handleSetRequest(true);

    assert.equal(fake.state.aspect, "2.35_1_zoom");
    assert.equal(fake.state.blank, "on");
  });

  test("Ready and Cooling sensors follow power, and faults set StatusFault", async () => {

    const { Characteristic, bySubtype, controller, fake } = await rig([ "Enable.Sensors.Ready", "Enable.Sensors.Cooling" ]);
    const ready = bySubtype("sensor.ready")!;
    const cooling = bySubtype("sensor.cooling")!;
    const detected = Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;

    await waitUntil(() => controller.store.get("power") === "standby", { description: "standby", timeoutMs: 2000 });
    assert.notEqual(ready.getCharacteristic(Characteristic.OccupancyDetected).value, detected);

    await controller.setPower(true);
    await waitUntil(() => ready.getCharacteristic(Characteristic.OccupancyDetected).value === detected, { description: "ready", timeoutMs: 2000 });

    fake.state.errors = ["err_temp"];
    await waitUntil(() => ready.getCharacteristic(Characteristic.StatusFault).value === Characteristic.StatusFault.GENERAL_FAULT,
      { description: "fault", timeoutMs: 2000 });

    await controller.setPower(false);
    await waitUntil(() => cooling.getCharacteristic(Characteristic.OccupancyDetected).value === detected, { description: "cooling", timeoutMs: 2000 });
    assert.notEqual(ready.getCharacteristic(Characteristic.OccupancyDetected).value, detected);
  });

  test("services for disabled options are removed", async () => {

    const { accessory, bySubtype, context } = await rig(["Enable.Sensors.Ready"]);

    assert.ok(bySubtype("sensor.ready"));

    const disabled = { ...context, enabled: (): boolean => false };

    new CompanionAccessory(disabled, accessory).configure();
    assert.equal(bySubtype("sensor.ready"), undefined);
  });
});
