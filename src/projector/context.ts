/* context.ts: What a projector's HomeKit accessories need, and the shared handler wrapper. */
import { ErrorCode, isProjectorError } from "../protocol/errors.ts";
import type { API } from "homebridge";
import { HAPStatus } from "homebridge-plugin-utils";
import type { HomebridgePluginLogging } from "homebridge-plugin-utils";
import type { ProjectorCache } from "./cache.ts";
import type { ProjectorConfig } from "../config.ts";
import type { ProjectorController } from "./controller.ts";

export interface AccessoryContext {

  api: API;
  cache: ProjectorCache;
  config: ProjectorConfig;
  controller: ProjectorController;

  // Feature options, already resolved for this projector.
  enabled: (option: string) => boolean;
  log: HomebridgePluginLogging;
  value: (option: string) => string | null | undefined;
}

// Run a HomeKit-initiated command. The controller has already logged any failure with its fix. A projector that is merely busy (warming up, cooling down) is not
// an error for HomeKit: the tile is re-synced to the real state. Anything else tells HomeKit the command failed, so the Home app shows it did not happen instead of
// pretending it did.
export async function runFromHomeKit(api: API, command: () => Promise<void>, resync: () => void): Promise<void> {

  try {

    await command();
  } catch(error) {

    if(isProjectorError(error) && (error.code === ErrorCode.BUSY)) {

      setTimeout(resync, 50);

      return;
    }

    throw new api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
}
