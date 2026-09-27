/* queue.test.ts: The command queue serializes, paces, prioritizes and shuts down cleanly. */
import { ErrorCode, isProjectorError } from "./errors.ts";
import { describe, test } from "node:test";
import { CommandQueue } from "./queue.ts";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

describe("CommandQueue", () => {

  test("runs one job at a time, in order", async () => {

    const queue = new CommandQueue({ pacingMs: 0 });
    const events: string[] = [];
    const job = (name: string) => async () => {

      events.push("start " + name);
      await sleep(10);
      events.push("end " + name);

      return name;
    };

    const results = await Promise.all([ queue.run(job("a")), queue.run(job("b")), queue.run(job("c")) ]);

    assert.deepEqual(results, [ "a", "b", "c" ]);
    assert.deepEqual(events, [ "start a", "end a", "start b", "end b", "start c", "end c" ]);
  });

  test("keeps at least pacingMs between the end of one job and the start of the next", async () => {

    const queue = new CommandQueue({ pacingMs: 40 });
    const starts: number[] = [];

    await Promise.all([ 1, 2, 3 ].map(() => queue.run(async () => {

      starts.push(performance.now());
    })));

    assert.ok((starts[1]! - starts[0]!) >= 38, "gap 1 " + String(starts[1]! - starts[0]!));
    assert.ok((starts[2]! - starts[1]!) >= 38, "gap 2 " + String(starts[2]! - starts[1]!));
  });

  test("a failing job rejects its own caller and does not block the queue", async () => {

    const queue = new CommandQueue({ pacingMs: 0 });
    const failing = queue.run(async () => {

      throw new Error("nope");
    });
    const next = queue.run(async () => "ok");

    await assert.rejects(failing, /nope/);
    assert.equal(await next, "ok");
  });

  test("priority jobs jump ahead of waiting normal jobs", async () => {

    const queue = new CommandQueue({ pacingMs: 0 });
    const order: string[] = [];
    const job = (name: string) => async () => {

      order.push(name);
      await sleep(5);
    };

    const first = queue.run(job("poll-1"));
    const second = queue.run(job("poll-2"));
    const key = queue.run(job("key"), { priority: true });

    await Promise.all([ first, second, key ]);

    assert.deepEqual(order, [ "poll-1", "key", "poll-2" ]);
  });

  test("close() rejects waiting jobs with SPJ-ABORTED and refuses new ones", async () => {

    const queue = new CommandQueue({ pacingMs: 0 });
    const running = queue.run(async () => sleep(20).then(() => "done"));
    const waiting = assert.rejects(queue.run(async () => "never"), (error: unknown) => isProjectorError(error) && (error.code === ErrorCode.ABORTED));

    queue.close();

    assert.equal(await running, "done");
    await waiting;
    await assert.rejects(queue.run(async () => "late"), (error: unknown) => isProjectorError(error) && (error.code === ErrorCode.ABORTED));
  });
});
