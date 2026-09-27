/* reporter.test.ts: Failures are logged once with their fix, repeated failures are summarized, recovery is announced. */
import { ErrorCode, ProjectorError } from "../protocol/errors.ts";
import { capturingLog, logCount, loggedAt } from "homebridge-plugin-utils/testing";
import { describe, test } from "node:test";
import { ErrorReporter } from "./reporter.ts";
import assert from "node:assert/strict";
import { projectorLog } from "./log.ts";

function setup(): { clock: { now: number }; log: ReturnType<typeof capturingLog>; reporter: ErrorReporter } {

  const clock = { now: 0 };
  const log = capturingLog();

  return { clock, log, reporter: new ErrorReporter(log, { now: () => clock.now, summaryEveryMs: 600000 }) };
}

const unreachable = new ProjectorError(ErrorCode.NET_UNREACHABLE, "10.0.0.5:53595: ECONNREFUSED.");

describe("ErrorReporter", () => {

  test("the first failure is logged with its code and fix; repeats are silent", () => {

    const { log, reporter } = setup();

    for(let attempt = 0; attempt < 30; attempt++) {

      reporter.failure("Polling", unreachable);
    }

    assert.equal(log.entries.length, 1);
    assert.ok(loggedAt(log.entries, "warn", "SPJ-NET-UNREACHABLE"));
    assert.ok(loggedAt(log.entries, "warn", "Check the IP address"));
  });

  test("a still-failing summary is logged every interval", () => {

    const { clock, log, reporter } = setup();

    reporter.failure("Polling", unreachable);
    clock.now = 300000;
    reporter.failure("Polling", unreachable);
    clock.now = 600000;
    reporter.failure("Polling", unreachable);

    assert.equal(log.entries.length, 2);
    assert.ok(loggedAt(log.entries, "warn", "still failing"));
    assert.ok(loggedAt(log.entries, "warn", "3 attempts"));
  });

  test("a different error is logged immediately", () => {

    const { log, reporter } = setup();

    reporter.failure("Polling", unreachable);
    reporter.failure("Polling", new ProjectorError(ErrorCode.AUTH_FAILED, "bad password"));

    assert.equal(log.entries.length, 2);
    assert.ok(loggedAt(log.entries, "error", "SPJ-AUTH-FAILED"));
  });

  test("recovery is announced once, and only after a failure", () => {

    const { clock, log, reporter } = setup();

    reporter.success();
    assert.equal(log.entries.length, 0);

    reporter.failure("Polling", unreachable);
    reporter.failure("Polling", unreachable);
    clock.now = 125000;
    reporter.success();
    reporter.success();

    assert.equal(logCount(log.entries, "info", "responding again"), 1);
    assert.ok(loggedAt(log.entries, "info", "2 failed attempts"));
    assert.equal(reporter.failing, false);
  });

  test("non-projector errors are reported without crashing", () => {

    const { log, reporter } = setup();

    reporter.failure("Polling", "a string");
    reporter.failure("Polling", undefined);

    assert.ok(log.entries.length >= 1);
  });
});

describe("projectorLog", () => {

  test("prefixes every line with the projector name", () => {

    const base = capturingLog();
    const log = projectorLog(base, () => "Theater", () => false);

    log.info("Power on.");

    assert.ok(loggedAt(base.entries, "info", "Theater: Power on."));
  });

  test("debug lines go to Homebridge's debug channel unless the plugin's debug option is on", () => {

    const base = capturingLog();
    let enabled = false;
    const log = projectorLog(base, () => "Theater", () => enabled);

    log.debug("trace 1");
    enabled = true;
    log.debug("trace 2");

    assert.ok(loggedAt(base.entries, "debug", "trace 1"));
    assert.ok(loggedAt(base.entries, "info", "trace 2"));
  });
});
