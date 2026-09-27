/* fake-api.helpers.ts: A Homebridge API double for tests, built on the real HAP-NodeJS and homebridge's real PlatformAccessory class.
 *
 * Only the platform-facing surface is faked (registration, lifecycle events, storage path). Services, characteristics, validation and HapStatusError are the real
 * implementations, so tests exercise exactly what Homebridge would run.
 */
import * as hap from "@homebridge/hap-nodejs";
import type { API, PlatformAccessory } from "homebridge";
import { mkdtempSync, rmSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";

// homebridge does not export PlatformAccessory, so load it from its file. Tests only; the plugin receives it as api.platformAccessory at runtime.
const { PlatformAccessory: PlatformAccessoryClass } = await import(new URL("../node_modules/homebridge/dist/platformAccessory.js", import.meta.url).href) as {

  PlatformAccessory: new (name: string, uuid: string, category?: number) => PlatformAccessory;
};

export interface FakeApi {

  readonly api: API;
  cleanup(): void;
  readonly external: PlatformAccessory[];
  launch(): void;
  readonly registered: PlatformAccessory[];
  shutdown(): void;
  readonly storagePath: string;
  readonly unregistered: PlatformAccessory[];
  readonly updated: PlatformAccessory[];
}

export function createFakeApi({ serverVersion = "2.4.0" }: { serverVersion?: string } = {}): FakeApi {

  const events = new EventEmitter();
  const storagePath = mkdtempSync(join(tmpdir(), "hbsp-"));
  const external: PlatformAccessory[] = [];
  const registered: PlatformAccessory[] = [];
  const unregistered: PlatformAccessory[] = [];
  const updated: PlatformAccessory[] = [];

  const api = {

    hap,
    on: (event: string, listener: () => void) => events.on(event, listener),
    platformAccessory: PlatformAccessoryClass,
    publishExternalAccessories: (_plugin: string, accessories: PlatformAccessory[]) => external.push(...accessories),
    registerPlatformAccessories: (_plugin: string, _platform: string, accessories: PlatformAccessory[]) => registered.push(...accessories),
    serverVersion,
    unregisterPlatformAccessories: (_plugin: string, _platform: string, accessories: PlatformAccessory[]) => {

      unregistered.push(...accessories);

      for(const accessory of accessories) {

        const index = registered.indexOf(accessory);

        if(index !== -1) {

          registered.splice(index, 1);
        }
      }
    },
    updatePlatformAccessories: (accessories: PlatformAccessory[]) => updated.push(...accessories),
    user: { storagePath: () => storagePath },
    version: 2.7
  } as unknown as API;

  return {

    api,
    cleanup: () => rmSync(storagePath, { force: true, recursive: true }),
    external,
    launch: () => events.emit("didFinishLaunching"),
    registered,
    shutdown: () => events.emit("shutdown"),
    storagePath,
    unregistered,
    updated
  };
}

export { PlatformAccessoryClass };
