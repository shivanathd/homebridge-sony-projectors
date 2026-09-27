/* adcp-parse.test.ts: Pure ADCP reply parsing. */
import { describe, test } from "node:test";
import { hashChallenge, isSafeToken, parseInfoRange, parseJsonList, parsePower, parseReply, parseTimer, unquote } from "./adcp-parse.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

describe("parseReply", () => {

  test("ok, values and errors", () => {

    assert.deepEqual(parseReply("ok"), { kind: "ok" });
    assert.deepEqual(parseReply("OK"), { kind: "ok" });
    assert.deepEqual(parseReply("\"on\""), { kind: "value", value: "on" });
    assert.deepEqual(parseReply("1234"), { kind: "value", value: "1234" });
    assert.deepEqual(parseReply("err_inactive"), { error: "err_inactive", kind: "error" });
    assert.deepEqual(parseReply("ERR_CMD"), { error: "err_cmd", kind: "error" });
    assert.deepEqual(parseReply("  \"hdmi1\"  "), { kind: "value", value: "hdmi1" });
  });

  test("JSON replies are passed through untouched", () => {

    assert.deepEqual(parseReply("[\"no_err\"]"), { kind: "value", value: "[\"no_err\"]" });
  });
});

describe("unquote", () => {

  test("strips one pair of surrounding quotes only", () => {

    assert.equal(unquote("\"a\""), "a");
    assert.equal(unquote("a"), "a");
    assert.equal(unquote("\"a"), "\"a");
  });
});

describe("parsePower", () => {

  test("collapses Sony's transitional states", () => {

    assert.equal(parsePower("standby"), "standby");
    assert.equal(parsePower("saving_standby"), "standby");
    assert.equal(parsePower("startup"), "warming");
    assert.equal(parsePower("on"), "on");
    assert.equal(parsePower("cooling1"), "cooling");
    assert.equal(parsePower("cooling2"), "cooling");
    assert.equal(parsePower("saving_cooling1"), "cooling");
    assert.equal(parsePower("something_else"), "unknown");
  });
});

describe("parseJsonList", () => {

  test("returns meaningful entries and drops the no-error sentinels", () => {

    assert.deepEqual(parseJsonList("[\"no_err\"]"), []);
    assert.deepEqual(parseJsonList("[]"), []);
    assert.deepEqual(parseJsonList("[\"err_lamp\",\"err_temp\"]"), [ "err_lamp", "err_temp" ]);
    assert.deepEqual(parseJsonList("[\"no_warn\"]"), []);
    assert.deepEqual(parseJsonList("[\"warn_lamp\"]"), ["warn_lamp"]);
  });

  test("tolerates a bare word and garbage", () => {

    assert.deepEqual(parseJsonList("no_err"), []);
    assert.deepEqual(parseJsonList("warn_filter"), ["warn_filter"]);
    assert.deepEqual(parseJsonList(""), []);
    assert.deepEqual(parseJsonList("[{"), ["[{"]);
  });
});

describe("parseInfoRange", () => {

  test("reads a list range from --info JSON", () => {

    assert.deepEqual(parseInfoRange("{\"type\":\"string\",\"range\":[\"hdmi1\",\"hdmi2\"]}"), [ "hdmi1", "hdmi2" ]);
    assert.deepEqual(parseInfoRange("[{\"type\":\"string\",\"range\":[\"\\\"game\\\"\",\"REFERENCE\"]}]"), [ "game", "reference" ]);
  });

  test("returns null when there is no usable list", () => {

    assert.equal(parseInfoRange("{\"type\":\"number\",\"range\":{\"min\":0,\"max\":100}}"), null);
    assert.equal(parseInfoRange("not json"), null);
    assert.equal(parseInfoRange("{\"range\":[]}"), null);
  });

  test("drops tokens that would be unsafe to send back", () => {

    assert.deepEqual(parseInfoRange("{\"range\":[\"hdmi1\",\"bad\\\"inject\",\"x y\"]}"), ["hdmi1"]);
  });
});

describe("parseTimer", () => {

  test("reads light-source hours from the known reply shapes", () => {

    assert.equal(parseTimer("[{\"light_src\":1234}]"), 1234);
    assert.equal(parseTimer("[{\"lamp\":\"812\"}]"), 812);
    assert.equal(parseTimer("{\"laser\":55}"), 55);
    assert.equal(parseTimer("1500"), 1500);
    assert.equal(parseTimer("\"1500\""), 1500);
  });

  test("returns null when no hour count can be found", () => {

    assert.equal(parseTimer("[{\"main\":\"1.104\"}]"), null);
    assert.equal(parseTimer(""), null);
    assert.equal(parseTimer("abc"), null);
  });
});

describe("hashChallenge", () => {

  test("is the lowercase hex SHA-256 of challenge + password", () => {

    assert.equal(hashChallenge("a1b2c3", "Projector"), createHash("sha256").update("a1b2c3Projector").digest("hex"));
    assert.match(hashChallenge("x", "y"), /^[0-9a-f]{64}$/);
  });
});

describe("isSafeToken", () => {

  test("allows only the characters ADCP values use", () => {

    for(const good of [ "hdmi1", "cinema_film1", "2.35_1_zoom", "brt_tv" ]) {

      assert.ok(isSafeToken(good), good);
    }

    for(const bad of [ "", "a\"b", "a\r\nb", "a b", "A", "x;y", "a".repeat(65) ]) {

      assert.ok(!isSafeToken(bad), JSON.stringify(bad));
    }
  });
});
