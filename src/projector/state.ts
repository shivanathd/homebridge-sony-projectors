/* state.ts: The cached state of one projector.
 *
 * HomeKit reads come from here and never wait on the network. The poll loop and command handlers write here, and listeners (the HomeKit services) are told only
 * about fields whose value actually changed.
 */
import type { PowerState } from "../protocol/types.ts";

export interface ProjectorState {

  aspect: string | null;
  blank: boolean | null;
  faults: readonly string[];
  input: string | null;
  lightHours: number | null;
  pictureMode: string | null;
  power: PowerState;
  reachable: boolean;
}

export type StateKey = keyof ProjectorState;

export type ChangeListener = <K extends StateKey>(key: K, value: ProjectorState[K], previous: ProjectorState[K]) => void;

function same(a: unknown, b: unknown): boolean {

  if(Array.isArray(a) && Array.isArray(b)) {

    return (a.length === b.length) && a.every((entry, index) => entry === b[index]);
  }

  return a === b;
}

export class StateStore {

  readonly #listeners: ChangeListener[] = [];
  readonly #state: ProjectorState = { aspect: null, blank: null, faults: [], input: null, lightHours: null, pictureMode: null, power: "unknown", reachable: false };

  public get<K extends StateKey>(key: K): ProjectorState[K] {

    return this.#state[key];
  }

  public snapshot(): ProjectorState {

    return { ...this.#state };
  }

  public onChange(listener: ChangeListener): void {

    this.#listeners.push(listener);
  }

  public update(partial: Partial<ProjectorState>): void {

    for(const key of Object.keys(partial) as StateKey[]) {

      const value = partial[key];
      const previous = this.#state[key];

      if((value === undefined) || same(value, previous)) {

        continue;
      }

      (this.#state as unknown as Record<StateKey, unknown>)[key] = value;

      for(const listener of this.#listeners) {

        try {

          listener(key, value as never, previous as never);
        } catch {

          // A listener bug must not stop state tracking or other listeners. Listeners log their own failures.
        }
      }
    }
  }
}
