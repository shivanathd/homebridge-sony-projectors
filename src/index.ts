/* index.ts: Plugin entry point. */
import type { API } from "homebridge";
import { PLATFORM_NAME, PLUGIN_NAME } from "./settings.ts";

export default (api: API): void => {

  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, class {} as never);
};
