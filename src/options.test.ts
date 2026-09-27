/* options.test.ts: The catalog is valid for homebridge-plugin-utils and the typed option names match it. */
import { FeatureOptions, buildCatalogIndex } from "homebridge-plugin-utils";
import { Option, featureOptionCategories, featureOptions } from "./options.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("the catalog builds without errors", () => {

  assert.doesNotThrow(() => buildCatalogIndex(featureOptionCategories, featureOptions));
});

test("every typed option name exists in the catalog", () => {

  const catalog = buildCatalogIndex(featureOptionCategories, featureOptions);

  for(const name of Object.values(Option)) {

    assert.ok(name.toLowerCase() in catalog.defaults, name);
  }
});

test("defaults: Remote on, extras off, Play/Pause toggles picture mute", () => {

  const options = new FeatureOptions(featureOptionCategories, featureOptions, []);

  assert.equal(options.test(Option.REMOTE), true);
  assert.equal(options.test(Option.PICTURE_SWITCHES), false);
  assert.equal(options.test(Option.SENSOR_READY), false);
  assert.equal(options.value(Option.REMOTE_PLAY_PAUSE), "blank");
  assert.equal(options.value(Option.REMOTE_BACK), "return");
});

test("a per-projector override beats the global setting", () => {

  const options = new FeatureOptions(featureOptionCategories, featureOptions, [ "Enable.Picture.Switches", "Disable.Picture.Switches.192-168-8-50" ]);

  assert.equal(options.test(Option.PICTURE_SWITCHES, "192-168-8-51"), true);
  assert.equal(options.test(Option.PICTURE_SWITCHES, "192-168-8-50"), false);
});
