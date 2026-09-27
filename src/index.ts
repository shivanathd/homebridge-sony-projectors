/* index.ts: Plugin entry point. */
import { PLATFORM_NAME, PLUGIN_NAME } from "./settings.ts";
import type { API } from "homebridge";

export default (api: API): void => {

  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, class {} as never);
};
