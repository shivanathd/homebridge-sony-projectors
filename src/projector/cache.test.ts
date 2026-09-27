/* cache.test.ts: The projector cache survives restarts and tolerates corruption. */
import { CACHE_FILE, ProjectorCache } from "./cache.ts";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { capturingLog } from "homebridge-plugin-utils/testing";
import { join } from "node:path";
import { tmpdir } from "node:os";

const directory = mkdtempSync(join(tmpdir(), "hbsp-cache-"));

after(() => rmSync(directory, { force: true, recursive: true }));

test("values written are read back by a new instance", () => {

  const cache = new ProjectorCache(directory, capturingLog());

  cache.update("pj", { protocol: "adcp" });
  cache.setInput("pj", "hdmi1", { name: "Apple TV" });
  cache.setInput("pj", "hdmi1", { hidden: true });

  const reloaded = new ProjectorCache(directory, capturingLog());

  assert.equal(reloaded.get("pj").protocol, "adcp");
  assert.deepEqual(reloaded.get("pj").inputs, { hdmi1: { hidden: true, name: "Apple TV" } });
});

test("retain drops projectors that are no longer configured", () => {

  const cache = new ProjectorCache(directory, capturingLog());

  cache.update("old", { protocol: "sdcp" });
  cache.retain(["pj"]);

  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(directory, CACHE_FILE), "utf8")) as object), ["pj"]);
});

test("a corrupt file is ignored with a warning", () => {

  const corrupt = mkdtempSync(join(tmpdir(), "hbsp-cache-"));
  const log = capturingLog();

  writeFileSync(join(corrupt, CACHE_FILE), "{not json");

  const cache = new ProjectorCache(corrupt, log);

  assert.deepEqual(cache.get("pj"), {});
  assert.equal(log.entries.length, 1);
  rmSync(corrupt, { force: true, recursive: true });
});
