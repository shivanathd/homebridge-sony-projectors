/* labels.test.ts: Friendly names for protocol tokens. */
import { aspectLabel, inputLabel, pictureModeLabel } from "./labels.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("inputs", () => {

  assert.equal(inputLabel("hdmi1"), "HDMI 1");
  assert.equal(inputLabel("hdmi2"), "HDMI 2");
  assert.equal(inputLabel("video"), "Video");
});

test("picture modes", () => {

  assert.equal(pictureModeLabel("cinema_film1"), "Cinema Film 1");
  assert.equal(pictureModeLabel("brt_cinema"), "Bright Cinema");
  assert.equal(pictureModeLabel("brt_tv"), "Bright TV");
  assert.equal(pictureModeLabel("tv"), "TV");
  assert.equal(pictureModeLabel("user3"), "User 3");
  assert.equal(pictureModeLabel("imax_enhanced"), "IMAX Enhanced");
});

test("aspect ratios", () => {

  assert.equal(aspectLabel("2.35_1_zoom"), "2.35:1 Zoom");
  assert.equal(aspectLabel("1.85_1_zoom"), "1.85:1 Zoom");
  assert.equal(aspectLabel("v_stretch"), "V Stretch");
  assert.equal(aspectLabel("normal"), "Normal");
});

test("unknown tokens degrade to title case rather than failing", () => {

  assert.equal(pictureModeLabel("some_new_mode"), "Some New Mode");
});
