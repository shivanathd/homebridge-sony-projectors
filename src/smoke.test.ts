/* smoke.test.ts: Proves the test runner, type stripping and module resolution work. */
import { DEFAULTS, PLATFORM_NAME, PLUGIN_NAME } from "./settings.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("settings constants are wired up", () => {

  assert.equal(PLUGIN_NAME, "homebridge-sony-projectors");
  assert.equal(PLATFORM_NAME, "SonyProjectors");
  assert.equal(DEFAULTS.adcpPort, 53595);
});
