/* index.ts: Plugin entry point. */
import type { API } from "homebridge";
import { PLATFORM_NAME } from "./settings.ts";
import { SonyProjectorsPlatform } from "./platform.ts";

export default (api: API): void => {

  api.registerPlatform(PLATFORM_NAME, SonyProjectorsPlatform);
};
