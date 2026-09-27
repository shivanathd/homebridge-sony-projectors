/* cache.ts: Small persistent memory per projector, stored in Homebridge's storage directory.
 *
 * External (unbridged) TV accessories are not cached by Homebridge, so anything a user sets in the Home app on them (input names, hidden inputs) would be lost on
 * every restart. This file keeps those, plus what was learned about the projector (protocol, identity, capabilities) so HomeKit can be set up correctly before the
 * projector first answers.
 */
import type { Capabilities, ProjectorIdentity, Protocol } from "../protocol/types.ts";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { HomebridgePluginLogging } from "homebridge-plugin-utils";
import { join } from "node:path";

export interface InputPreference {

  hidden?: boolean;
  name?: string;
}

export interface CachedProjector {

  capabilities?: Capabilities;
  identity?: ProjectorIdentity;
  inputs?: Record<string, InputPreference>;
  protocol?: Protocol;
}

export const CACHE_FILE = "sony-projectors.json";

export class ProjectorCache {

  #data: Record<string, CachedProjector> = {};
  readonly #file: string;
  readonly #log: HomebridgePluginLogging;

  constructor(storagePath: string, log: HomebridgePluginLogging) {

    this.#file = join(storagePath, CACHE_FILE);
    this.#log = log;

    try {

      const parsed: unknown = JSON.parse(readFileSync(this.#file, "utf8"));

      if(parsed && (typeof parsed === "object") && !Array.isArray(parsed)) {

        this.#data = parsed as Record<string, CachedProjector>;
      }
    } catch(error) {

      // A missing file is normal on first run. Anything else means a corrupt cache, which is safe to rebuild.
      if((error as { code?: string }).code !== "ENOENT") {

        this.#log.warn("Ignoring unreadable cache file %s; it will be rebuilt.", this.#file);
      }
    }
  }

  public get(id: string): CachedProjector {

    return this.#data[id] ?? {};
  }

  public update(id: string, partial: CachedProjector): void {

    this.#data[id] = { ...this.#data[id], ...partial };
    this.#save();
  }

  public setInput(id: string, token: string, preference: InputPreference): void {

    const entry = this.get(id);

    this.update(id, { inputs: { ...entry.inputs, [token]: { ...entry.inputs?.[token], ...preference } } });
  }

  // Keep only projectors that are still configured.
  public retain(ids: readonly string[]): void {

    const keep = new Set(ids);
    const stale = Object.keys(this.#data).filter((id) => !keep.has(id));

    if(stale.length) {

      this.#data = Object.fromEntries(Object.entries(this.#data).filter(([id]) => keep.has(id)));
      this.#save();
    }
  }

  #save(): void {

    const temporary = this.#file + ".tmp";

    try {

      // Write to a temporary file and rename it over the old one, so a crash mid-write never leaves a half-written cache.
      writeFileSync(temporary, JSON.stringify(this.#data, null, 2));
      renameSync(temporary, this.#file);
    } catch(error) {

      this.#log.warn("Unable to save %s: %s", this.#file, (error instanceof Error) ? error.message : String(error));
    }
  }
}
