/* queue.ts: Serialize and pace commands to a single projector.
 *
 * Sony projectors handle one command at a time and drop commands that arrive too quickly. Every transport funnels its I/O through one CommandQueue, so a poll and a
 * button press from the Home app can never collide on the wire. Remote key presses are queued with priority so the Apple TV Remote stays responsive while a poll
 * cycle is in flight.
 */
import { ErrorCode, ProjectorError } from "./errors.ts";

interface Job {

  readonly reject: (error: unknown) => void;
  readonly resolve: (value: unknown) => void;
  readonly run: () => Promise<unknown>;
}

export interface CommandQueueOptions {

  pacingMs: number;
}

export class CommandQueue {

  #closed = false;
  #draining = false;
  #lastFinished = 0;
  readonly #normal: Job[] = [];
  readonly #pacingMs: number;
  readonly #priority: Job[] = [];

  constructor({ pacingMs }: CommandQueueOptions) {

    this.#pacingMs = Math.max(0, pacingMs);
  }

  public async run<T>(fn: () => Promise<T>, { priority = false }: { priority?: boolean } = {}): Promise<T> {

    if(this.#closed) {

      throw new ProjectorError(ErrorCode.ABORTED, "The command queue is closed.");
    }

    return new Promise<T>((resolve, reject) => {

      (priority ? this.#priority : this.#normal).push({ reject, resolve: resolve as (value: unknown) => void, run: fn });
      void this.#drain();
    });
  }

  // Reject everything still waiting. A job already on the wire is allowed to finish; its socket has its own timeout.
  public close(): void {

    this.#closed = true;

    for(const job of this.#priority.splice(0).concat(this.#normal.splice(0))) {

      job.reject(new ProjectorError(ErrorCode.ABORTED, "The command was cancelled because the connection to the projector is shutting down."));
    }
  }

  async #drain(): Promise<void> {

    if(this.#draining) {

      return;
    }

    this.#draining = true;

    try {

      // Awaiting inside this loop is the point: jobs must run strictly one after another.
      /* eslint-disable no-await-in-loop */
      for(let job = this.#next(); job; job = this.#next()) {

        const wait = this.#lastFinished + this.#pacingMs - performance.now();

        if(wait > 0) {

          await new Promise((resolve) => setTimeout(resolve, wait));
        }

        // The queue may have been closed while this job waited out the pacing gap.
        if(this.#closed) {

          job.reject(new ProjectorError(ErrorCode.ABORTED, "The command was cancelled because the connection to the projector is shutting down."));

          continue;
        }

        try {

          job.resolve(await job.run());
        } catch(error) {

          job.reject(error);
        } finally {

          this.#lastFinished = performance.now();
        }
      }
      /* eslint-enable no-await-in-loop */
    } finally {

      this.#draining = false;
    }
  }

  #next(): Job | undefined {

    return this.#priority.shift() ?? this.#normal.shift();
  }
}
