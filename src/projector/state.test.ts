/* state.test.ts: The state store only reports real changes. */
import { StateStore } from "./state.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("starts unknown and unreachable", () => {

  const store = new StateStore();

  assert.equal(store.get("power"), "unknown");
  assert.equal(store.get("reachable"), false);
  assert.equal(store.get("input"), null);
});

test("update emits one change per field that actually changed", () => {

  const store = new StateStore();
  const changes: string[] = [];

  store.onChange((key, value, previous) => changes.push(key + ":" + String(previous) + "->" + String(value)));
  store.update({ power: "on", reachable: true });
  store.update({ power: "on", reachable: true });
  store.update({ input: "hdmi2", power: "on" });

  assert.deepEqual(changes, [ "power:unknown->on", "reachable:false->true", "input:null->hdmi2" ]);
});

test("arrays compare by content", () => {

  const store = new StateStore();
  let count = 0;

  store.onChange(() => count++);
  store.update({ faults: ["err_temp"] });
  store.update({ faults: ["err_temp"] });
  store.update({ faults: [] });

  assert.equal(count, 2);
});

test("a throwing listener does not stop other listeners or the update", () => {

  const store = new StateStore();
  const seen: string[] = [];

  store.onChange(() => {

    throw new Error("listener bug");
  });
  store.onChange((key) => seen.push(key));

  assert.doesNotThrow(() => store.update({ blank: true }));
  assert.deepEqual(seen, ["blank"]);
  assert.equal(store.get("blank"), true);
});

test("snapshot is a copy", () => {

  const store = new StateStore();
  const snapshot = store.snapshot();

  store.update({ power: "on" });
  assert.equal(snapshot.power, "unknown");
});
