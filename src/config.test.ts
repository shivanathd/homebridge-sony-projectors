/* config.test.ts: Config parsing is forgiving: bad entries are skipped or corrected with an explanation, never a crash. */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "./config.ts";

describe("parseConfig", () => {

  test("a minimal projector gets sensible defaults", () => {

    const { issues, projectors } = parseConfig({ projectors: [{ host: "192.168.8.50" }] });

    assert.deepEqual(issues, []);
    assert.deepEqual(projectors, [{

      adcpPort: 53595, community: "SONY", host: "192.168.8.50", id: "192-168-8-50", name: "Projector", password: "", pollIntervalSeconds: 10, protocol: "auto",
      sdcpPort: 53484
    }]);
  });

  test("no projectors is not an error, just nothing to do", () => {

    assert.deepEqual(parseConfig({}), { debug: false, issues: [], options: [], projectors: [] });
    assert.deepEqual(parseConfig(undefined).projectors, []);
  });

  test("entries without a host are skipped with an explanation", () => {

    const { issues, projectors } = parseConfig({ projectors: [ { name: "Den" }, { host: "  " }, "nonsense" ] });

    assert.equal(projectors.length, 0);
    assert.equal(issues.length, 3);
    assert.match(issues[0]!, /Den.*host/);
  });

  test("hosts with characters that cannot be an address are rejected", () => {

    const { issues, projectors } = parseConfig({ projectors: [{ host: "10.0.0.1; rm -rf /" }] });

    assert.equal(projectors.length, 0);
    assert.match(issues[0]!, /not a valid/);
  });

  test("duplicate hosts keep the first entry", () => {

    const { issues, projectors } = parseConfig({ projectors: [ { host: "pj.local", name: "Theater" }, { host: "PJ.local", name: "Den" } ] });

    assert.deepEqual(projectors.map((projector) => projector.name), ["Theater"]);
    assert.match(issues[0]!, /more than once/);
  });

  test("explicit protocol and port", () => {

    const [projector] = parseConfig({ projectors: [{ host: "pj", port: 50000, protocol: "sdcp" }] }).projectors;

    assert.equal(projector?.protocol, "sdcp");
    assert.equal(projector?.sdcpPort, 50000);
    assert.equal(projector?.adcpPort, 53595);
  });

  test("invalid values are corrected and explained", () => {

    const { issues, projectors } = parseConfig({ projectors: [{ community: "TOOLONG", host: "pj", pollInterval: 1, port: 70000, protocol: "telnet" }] });
    const [projector] = projectors;

    assert.equal(projector?.protocol, "auto");
    assert.equal(projector?.community, "SONY");
    assert.equal(projector?.pollIntervalSeconds, 3);
    assert.equal(projector?.adcpPort, 53595);
    assert.equal(issues.length, 4);
  });

  test("a port with protocol auto is ignored, because it would be ambiguous", () => {

    const { issues, projectors } = parseConfig({ projectors: [{ host: "pj", port: 1234 }] });

    assert.equal(projectors[0]?.adcpPort, 53595);
    assert.match(issues[0]!, /port/i);
  });

  test("names are sanitized for HomeKit", () => {

    assert.equal(parseConfig({ projectors: [{ host: "pj", name: "  Living-Room: Sony!! " }] }).projectors[0]?.name, "Living-Room Sony");
  });

  test("options and debug pass through, keeping only strings", () => {

    const parsed = parseConfig({ debug: true, options: [ "Enable.Picture.Switches", 42, "Disable.Remote" ] });

    assert.deepEqual(parsed.options, [ "Enable.Picture.Switches", "Disable.Remote" ]);
    assert.equal(parsed.debug, true);
  });
});
