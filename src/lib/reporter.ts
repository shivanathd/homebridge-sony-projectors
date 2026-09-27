/* reporter.ts: Turn a stream of background failures into a few useful log lines.
 *
 * A projector that is unplugged fails every poll. Logging each one would bury everything else in the Homebridge log, and logging none would hide the problem.
 * The reporter logs the first failure with its code and fix, stays quiet while the same failure repeats, logs a short summary every interval, and announces
 * recovery once.
 */
import { ErrorCode, isProjectorError } from "../protocol/errors.ts";
import type { HomebridgePluginLogging } from "homebridge-plugin-utils";

// Failures a user must act on are errors. Everything else (network blips, a projector that is simply off at the wall) is a warning.
const ERROR_LEVEL = new Set<string>([ ErrorCode.AUTH_FAILED, ErrorCode.AUTH_REQUIRED, ErrorCode.COMMUNITY, ErrorCode.CONFIG ]);

export interface ErrorReporterOptions {

  now?: () => number;
  summaryEveryMs?: number;
}

interface Episode {

  code: string;
  count: number;
  lastSummaryAt: number;
  startedAt: number;
}

// Explain an error in one line: what happened, then what to do.
export function describeError(error: unknown): string {

  if(isProjectorError(error)) {

    return error.message + " " + error.hint;
  }

  return (error instanceof Error) ? error.message : String(error);
}

function codeOf(error: unknown): string {

  return isProjectorError(error) ? error.code : "unexpected";
}

function duration(ms: number): string {

  const minutes = Math.round(ms / 60000);

  return (minutes < 1) ? "under a minute" : ((minutes === 1) ? "1 minute" : String(minutes) + " minutes");
}

export class ErrorReporter {

  #episode: Episode | null = null;
  readonly #log: HomebridgePluginLogging;
  readonly #now: () => number;
  readonly #summaryEveryMs: number;

  constructor(log: HomebridgePluginLogging, { now = Date.now, summaryEveryMs = 600000 }: ErrorReporterOptions = {}) {

    this.#log = log;
    this.#now = now;
    this.#summaryEveryMs = summaryEveryMs;
  }

  public get failing(): boolean {

    return this.#episode !== null;
  }

  // The code of the failure currently being reported, if any.
  public get code(): string | null {

    return this.#episode?.code ?? null;
  }

  public failure(context: string, error: unknown): void {

    const now = this.#now();
    const code = codeOf(error);
    const episode = this.#episode;

    if(episode?.code === code) {

      episode.count++;

      if((now - episode.lastSummaryAt) >= this.#summaryEveryMs) {

        episode.lastSummaryAt = now;
        this.#log.warn("%s still failing (%s): %d attempts over %s.", context, code, episode.count, duration(now - episode.startedAt));
      }

      return;
    }

    this.#episode = { code, count: (episode?.count ?? 0) + 1, lastSummaryAt: now, startedAt: episode?.startedAt ?? now };

    const level = ERROR_LEVEL.has(code) ? "error" : "warn";

    this.#log[level]("%s failed: %s", context, describeError(error));
  }

  public success(): void {

    const episode = this.#episode;

    if(!episode) {

      return;
    }

    this.#episode = null;
    this.#log.info("The projector is responding again after %d failed attempts over %s.", episode.count, duration(this.#now() - episode.startedAt));
  }
}

