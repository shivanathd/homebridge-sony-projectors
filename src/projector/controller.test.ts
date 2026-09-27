/* controller.test.ts: The projector controller against the fake ADCP projector. */
import { ErrorCode, isProjectorError } from "../protocol/errors.ts";
import type { FakeAdcp, FakeAdcpOptions } from "../protocol/fake-adcp.helpers.ts";
import { after, describe, test } from "node:test";
import { assertNoUnhandledRejections, capturingLog, logCount, loggedAt, waitUntil } from "homebridge-plugin-utils/testing";
import type { ProjectorConfig } from "../config.ts";
import { ProjectorController } from "./controller.ts";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { startFakeAdcp } from "../protocol/fake-adcp.helpers.ts";

const TIMINGS = { authPauseMs: 150, backoffCeilingMs: 60, faultsEveryMs: 0, lightHoursEveryMs: 0, pollMs: 40, standbyPollMs: 40, transitionPollMs: 20 };
const cleanups: (() => Promise<void> | void)[] = [];

after(async () => {

  // Tear down in reverse order of setup, one at a time.
  for(const cleanup of cleanups.reverse()) {

    // eslint-disable-next-line no-await-in-loop
    await cleanup();
  }
});

async function closedPort(): Promise<number> {

  const server = createServer();

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = server.address() as { port: number };

  await new Promise<void>((resolve) => server.close(() => resolve()));

  return port;
}

function projectorConfig(port: number, extra: Partial<ProjectorConfig> = {}): ProjectorConfig {

  return { adcpPort: port, community: "SONY", host: "127.0.0.1", id: "127-0-0-1", name: "Theater", password: "", pollIntervalSeconds: 10, protocol: "adcp",
    sdcpPort: 1, ...extra };
}

async function setup(fakeOptions: FakeAdcpOptions = {}, extra: Partial<ProjectorConfig> = {}, options: Record<string, boolean> = {}):
Promise<{ abort: AbortController; controller: ProjectorController; fake: FakeAdcp; log: ReturnType<typeof capturingLog> }> {

  const fake = await startFakeAdcp({ transitionMs: 60, ...fakeOptions });
  const abort = new AbortController();
  const log = capturingLog();
  const controller = new ProjectorController({

    config: projectorConfig(fake.port, extra), isEnabled: (option) => options[option] ?? true, log, pacingMs: 0, signal: abort.signal, timings: TIMINGS
  });

  cleanups.push(async () => fake.close(), () => abort.abort());
  controller.start();

  return { abort, controller, fake, log };
}

describe("ProjectorController: polling", () => {

  test("converges on the projector's state and learns its identity and capabilities", async () => {

    const { controller } = await setup({ state: { input: "hdmi2", pictureMode: "game", power: "on", timer: 900 } });

    await waitUntil(() => controller.store.get("pictureMode") === "game", { description: "state converges", timeoutMs: 2000 });

    assert.equal(controller.store.get("reachable"), true);
    assert.equal(controller.store.get("power"), "on");
    assert.equal(controller.store.get("input"), "hdmi2");
    await waitUntil(() => controller.store.get("lightHours") === 900, { description: "light hours", timeoutMs: 2000 });
    await waitUntil(() => controller.identity.model === "VPL-VW290ES", { description: "identity", timeoutMs: 2000 });
    assert.ok(controller.capabilities.pictureModes.includes("reference"));
  });

  test("changes made outside HomeKit are logged once, as such", async () => {

    const { controller, fake, log } = await setup({ state: { power: "on" } });

    await waitUntil(() => controller.store.get("input") === "hdmi1", { description: "initial input", timeoutMs: 2000 });
    fake.state.input = "hdmi2";
    await waitUntil(() => controller.store.get("input") === "hdmi2", { description: "external change", timeoutMs: 2000 });

    assert.equal(logCount(log.entries, "info", "Input changed to HDMI 2 outside HomeKit"), 1);
  });

  test("an unreachable projector is marked unreachable and logged once, not on every poll", async () => {

    const log = capturingLog();
    const abort = new AbortController();
    const controller = new ProjectorController({ config: projectorConfig(await closedPort()), isEnabled: () => true, log, pacingMs: 0, signal: abort.signal,
      timings: TIMINGS });

    cleanups.push(() => abort.abort());
    controller.start();
    await sleep(400);

    assert.equal(controller.store.get("reachable"), false);
    assert.equal(logCount(log.entries, "warn", "SPJ-NET-UNREACHABLE"), 1);
  });

  test("a wrong password is an error, logged once, and polling backs off", async () => {

    const { controller, fake, log } = await setup({ password: "Projector" }, { password: "wrong" });

    await sleep(400);

    assert.equal(logCount(log.entries, "error", "SPJ-AUTH-FAILED"), 1);
    assert.ok(fake.authAttempts <= 4, "auth attempts " + String(fake.authAttempts));
    assert.equal(controller.store.get("reachable"), false);
  });

  test("stops talking to the projector once aborted", async () => {

    const { abort, controller, fake } = await setup({ state: { power: "on" } });

    await waitUntil(() => controller.store.get("reachable"), { description: "reachable", timeoutMs: 2000 });
    abort.abort();
    await sleep(50);

    const count = fake.received.length;

    await sleep(200);
    assert.equal(fake.received.length, count);
  });
});

describe("ProjectorController: commands", () => {

  test("power on tracks warm-up through to on", async () => {

    const { controller, fake } = await setup();

    await waitUntil(() => controller.store.get("power") === "standby", { description: "standby", timeoutMs: 2000 });
    await controller.setPower(true);

    assert.equal(controller.store.get("power"), "warming");
    assert.equal(fake.state.power, "startup");
    await waitUntil(() => controller.store.get("power") === "on", { description: "on", timeoutMs: 2000 });
  });

  test("power toggles during cool-down are refused with SPJ-BUSY without touching the projector", async () => {

    const { controller, fake } = await setup({ state: { power: "cooling1" } }, {}, {});

    await waitUntil(() => controller.store.get("power") === "cooling", { description: "cooling", timeoutMs: 2000 });

    const before = fake.received.filter((line) => line.startsWith("power ")).length;

    await assert.rejects(controller.setPower(true), (error: unknown) => isProjectorError(error) && (error.code === ErrorCode.BUSY));
    assert.equal(fake.received.filter((line) => line.startsWith("power ")).length, before);
  });

  test("S1 regression: commands to an unreachable projector reject cleanly and never become unhandled rejections", async () => {

    await assertNoUnhandledRejections(async () => {

      const log = capturingLog();
      const abort = new AbortController();
      const controller = new ProjectorController({ config: projectorConfig(await closedPort()), isEnabled: () => true, log, pacingMs: 0, signal: abort.signal,
        timings: TIMINGS });

      controller.start();

      await assert.rejects(controller.setPower(true), (error: unknown) => isProjectorError(error) && (error.code === ErrorCode.NET_UNREACHABLE));
      await assert.rejects(controller.setInput("hdmi2"));
      await assert.rejects(controller.remoteAction("menu"));
      assert.ok(loggedAt(log.entries, "error", "Unable to turn on"));
      abort.abort();
      await sleep(50);
    });
  });

  test("input, picture mode, aspect and picture mute update the projector and the cache", async () => {

    const { controller, fake } = await setup({ state: { power: "on" } });

    await waitUntil(() => controller.store.get("power") === "on", { description: "on", timeoutMs: 2000 });
    await controller.setInput("hdmi2");
    await controller.setPictureMode("reference");
    await controller.setAspect("2.35_1_zoom");
    await controller.setBlank(true);

    assert.deepEqual([ fake.state.input, fake.state.pictureMode, fake.state.aspect, fake.state.blank ], [ "hdmi2", "reference", "2.35_1_zoom", "on" ]);
    assert.deepEqual([ controller.store.get("input"), controller.store.get("pictureMode"), controller.store.get("aspect"), controller.store.get("blank") ],
      [ "hdmi2", "reference", "2.35_1_zoom", true ]);
  });

  test("a rejected command leaves the cache unchanged", async () => {

    const { controller } = await setup({ state: { power: "on" }, unsupported: ["aspect"] });

    await waitUntil(() => controller.store.get("input") === "hdmi1", { description: "on", timeoutMs: 2000 });
    await assert.rejects(controller.setAspect("stretch"));
    assert.equal(controller.store.get("aspect"), null);
  });

  test("remote actions: keys, the picture-mute toggle and 'none'", async () => {

    const { controller, fake } = await setup({ state: { power: "on" } });

    await waitUntil(() => controller.store.get("blank") === false, { description: "blank known", timeoutMs: 2000 });
    await controller.remoteAction("menu");
    await controller.remoteAction("blank");
    await controller.remoteAction("none");

    assert.deepEqual(fake.state.keys, ["menu"]);
    assert.equal(fake.state.blank, "on");
  });

  test("commands from HomeKit are not reported as outside changes", async () => {

    const { controller, log } = await setup({ state: { power: "on" } });

    await waitUntil(() => controller.store.get("input") === "hdmi1", { description: "on", timeoutMs: 2000 });
    await controller.setInput("hdmi2");
    await sleep(150);

    assert.equal(logCount(log.entries, "info", "outside HomeKit"), 0);
    assert.ok(loggedAt(log.entries, "info", "Switching input to HDMI 2"));
  });
});

describe("ProjectorController: review regressions", () => {

  test("each steady-state poll uses one connection", async () => {

    const { controller, fake } = await setup({ password: "Projector", state: { power: "on" } }, { password: "Projector" });

    await waitUntil(() => controller.store.get("input") === "hdmi1", { description: "converged", timeoutMs: 2000 });
    await sleep(100);

    const connections = fake.connections;
    const polls = fake.received.filter((line) => line === "power_status ?").length;

    await sleep(300);

    const newPolls = fake.received.filter((line) => line === "power_status ?").length - polls;

    // A poll straddling either end of the window can shift the count by one; the bug this guards against (one connection per reading) would be 5x.
    assert.ok(newPolls >= 3, "polls " + String(newPolls));
    assert.ok(Math.abs((fake.connections - connections) - newPolls) <= 1, "connections " + String(fake.connections - connections) + " for " + String(newPolls) +
      " polls");
  });

  test("aborting during protocol detection opens no further connections", async () => {

    let sdcpConnections = 0;
    const sdcp = createServer((socket) => {

      sdcpConnections++;
      socket.destroy();
    });

    await new Promise<void>((resolve) => sdcp.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => new Promise<void>((resolve) => sdcp.close(() => resolve())));

    // An ADCP port that accepts but never answers keeps detection busy until the command timeout.
    const silent = await startFakeAdcp({ silent: true });

    cleanups.push(async () => silent.close());

    const abort = new AbortController();
    const controller = new ProjectorController({ commandTimeoutMs: 300, config: projectorConfig(silent.port, { protocol: "auto",
      sdcpPort: (sdcp.address() as { port: number }).port }), isEnabled: () => true, log: capturingLog(), pacingMs: 0, signal: abort.signal, timings: TIMINGS });

    controller.start();
    await sleep(50);
    abort.abort();
    await sleep(700);

    assert.equal(sdcpConnections, 0);
  });

  test("HomeKit writes fail fast while the projector is known to be unreachable", async () => {

    const log = capturingLog();
    const abort = new AbortController();
    const controller = new ProjectorController({ config: projectorConfig(await closedPort()), isEnabled: () => true, log, pacingMs: 0, signal: abort.signal,
      timings: TIMINGS });

    cleanups.push(() => abort.abort());
    controller.start();
    await waitUntil(() => loggedAt(log.entries, "warn", "SPJ-NET-UNREACHABLE"), { description: "outage noticed", timeoutMs: 2000 });

    const started = performance.now();

    await assert.rejects(controller.setPower(true), (error: unknown) => isProjectorError(error) && (error.code === ErrorCode.NET_UNREACHABLE));
    // Well under the 5 s network timeout (and HAP's 3 s slow-write warning); generous enough for a loaded CI runner.
    assert.ok((performance.now() - started) < 1000);
  });
});
