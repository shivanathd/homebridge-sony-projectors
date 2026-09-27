/* schema.test.ts: config.schema.json agrees with the code that reads the config. */
import { DEFAULTS, LIMITS, PLATFORM_NAME } from "./settings.ts";
import assert from "node:assert/strict";
import { parseConfig } from "./config.ts";
import { readFileSync } from "node:fs";
import { test } from "node:test";

interface Schema {

  customUi: boolean;
  layout: unknown[];
  pluginAlias: string;
  pluginType: string;
  schema: { properties: { projectors: { items: { properties: Record<string, { maximum?: number; minimum?: number; oneOf?: { enum: string[] }[];
    pattern?: string; }>; }; }; }; };
  singular: boolean;
}

const schema = JSON.parse(readFileSync(new URL("../config.schema.json", import.meta.url), "utf8")) as Schema;
const projector = schema.schema.properties.projectors.items.properties;

test("identifies the platform", () => {

  assert.equal(schema.pluginAlias, PLATFORM_NAME);
  assert.equal(schema.pluginType, "platform");
  assert.equal(schema.singular, true);
  assert.equal(schema.customUi, true);
});

test("protocol choices match what the parser accepts", () => {

  const choices = projector["protocol"]!.oneOf!.flatMap((choice) => choice.enum);

  assert.deepEqual(choices, [ "auto", "adcp", "sdcp" ]);

  for(const protocol of choices) {

    assert.deepEqual(parseConfig({ projectors: [{ host: "pj", protocol }] }).issues, [], protocol);
  }
});

test("numeric limits match the parser's limits", () => {

  assert.equal(projector["pollInterval"]!.minimum, LIMITS.minPollIntervalSeconds);
  assert.equal(projector["pollInterval"]!.maximum, LIMITS.maxPollIntervalSeconds);
  assert.equal(projector["port"]!.maximum, 65535);
  assert.ok(DEFAULTS.adcpPort <= projector["port"]!.maximum);
});

test("the host pattern agrees with the parser", () => {

  const pattern = new RegExp(projector["host"]!.pattern!);

  for(const host of [ "192.168.1.50", "projector.local", "fe80::1" ]) {

    assert.ok(pattern.test(host), host);
    assert.equal(parseConfig({ projectors: [{ host }] }).projectors.length, 1, host);
  }

  for(const host of [ "bad host", "x;y", "-leading" ]) {

    assert.ok(!pattern.test(host), host);
  }
});
