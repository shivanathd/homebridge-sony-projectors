/* errors.test.ts: Error codes, hints and classification of low-level socket failures. */
import { ErrorCode, ProjectorError, fromSocketError, isProjectorError } from "./errors.ts";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

describe("ProjectorError", () => {

  test("carries a stable code and an actionable hint", () => {

    const error = new ProjectorError(ErrorCode.AUTH_FAILED, "password rejected");

    assert.equal(error.code, "SPJ-AUTH-FAILED");
    assert.match(error.hint, /password/i);
    assert.equal(error.name, "ProjectorError");
    assert.ok(isProjectorError(error));
    assert.ok(!isProjectorError(new Error("plain")));
  });

  test("every code has a non-empty hint", () => {

    for(const code of Object.values(ErrorCode)) {

      assert.ok(new ProjectorError(code, "x").hint.length > 10, code);
    }
  });

  test("the message is prefixed with the code so users can search the Troubleshooting guide", () => {

    assert.match(new ProjectorError(ErrorCode.BUSY, "cooling down").message, /^\[SPJ-BUSY\] cooling down$/);
  });
});

describe("fromSocketError", () => {

  test("maps connection refused and unreachable hosts to SPJ-NET-UNREACHABLE", () => {

    for(const code of [ "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN" ]) {

      const error = fromSocketError(Object.assign(new Error("boom"), { code }), "10.0.0.5:53595");

      assert.equal(error.code, ErrorCode.NET_UNREACHABLE, code);
      assert.match(error.message, /10\.0\.0\.5:53595/);
    }
  });

  test("maps resets to SPJ-NET-CLOSED and anything else to SPJ-NET-UNREACHABLE", () => {

    assert.equal(fromSocketError(Object.assign(new Error("x"), { code: "ECONNRESET" }), "h").code, ErrorCode.NET_CLOSED);
    assert.equal(fromSocketError(new Error("weird"), "h").code, ErrorCode.NET_UNREACHABLE);
  });

  test("passes an existing ProjectorError through unchanged", () => {

    const original = new ProjectorError(ErrorCode.NET_TIMEOUT, "slow");

    assert.equal(fromSocketError(original, "h"), original);
  });
});
