/* log.ts: Per-projector logging. */
import type { HomebridgePluginLogging, Logger } from "homebridge-plugin-utils";
import { prefixedLog } from "homebridge-plugin-utils";

// Prefix every line with the projector's name. Debug lines go to Homebridge's debug channel (visible with Homebridge debug mode) unless the plugin's own debug
// option is on, in which case they are promoted to info so a user can capture a trace without turning on debug for the whole of Homebridge.
export function projectorLog(base: Logger, name: () => string, debugEnabled: () => boolean): HomebridgePluginLogging {

  const log = prefixedLog(base, name);

  return {

    debug: (message: string, ...parameters: unknown[]): void => {

      if(debugEnabled()) {

        log.info("[debug] " + message, ...parameters);
      } else {

        log.debug(message, ...parameters);
      }
    },
    error: log.error,
    info: log.info,
    warn: log.warn
  };
}
