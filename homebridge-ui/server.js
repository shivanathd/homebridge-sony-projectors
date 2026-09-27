/* server.js: Settings UI backend. Homebridge starts it when the plugin's settings open and stops it when they close.
 *
 * /getOptions  serves the feature options catalog to the options editor (one source of truth: src/options.ts).
 * /probe       tests a projector connection and reports its model, protocol and capabilities, or a coded error with its fix.
 */
import { featureOptionCategories, featureOptions } from "../dist/options.js";
import { HomebridgePluginUiServer } from "@homebridge/plugin-ui-utils";
import { probeProjector } from "../dist/probe.js";

class PluginUiServer extends HomebridgePluginUiServer {

  constructor() {

    super();

    this.onRequest("/getOptions", () => ({ categories: featureOptionCategories, options: featureOptions }));
    this.onRequest("/probe", async (settings) => probeProjector((settings && (typeof settings === "object")) ? settings : {}));

    this.ready();
  }
}

(() => new PluginUiServer())();
