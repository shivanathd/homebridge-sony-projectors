/* platform.ts: The Homebridge dynamic platform. Lifecycle only; everything projector-specific lives in src/projector and src/protocol.
 *
 * Startup order follows Homebridge's contract: configureAccessory() is called for each cached accessory first, and only collects it. Real work starts at
 * didFinishLaunching. On shutdown one AbortController is aborted, which stops every poll loop and closes every connection.
 */
import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from "homebridge";
import { APIEvent, Categories, FeatureOptions } from "homebridge-plugin-utils";
import { Option, featureOptionCategories, featureOptions } from "./options.ts";
import { PLATFORM_NAME, PLUGIN_NAME } from "./settings.ts";
import type { AccessoryContext } from "./projector/context.ts";
import { CompanionAccessory } from "./projector/companion.ts";
import { ErrorCode } from "./protocol/errors.ts";
import { ProjectorCache } from "./projector/cache.ts";
import { ProjectorController } from "./projector/controller.ts";
import { TelevisionAccessory } from "./projector/tv.ts";
import { describeError } from "./lib/reporter.ts";
import { parseConfig } from "./config.ts";
import { projectorLog } from "./lib/log.ts";

export class SonyProjectorsPlatform implements DynamicPlatformPlugin {

  readonly #abort = new AbortController();
  readonly #api: API;
  readonly #cached = new Map<string, PlatformAccessory>();
  readonly #config: PlatformConfig;
  readonly #log: Logging;

  constructor(log: Logging, config: PlatformConfig, api: API) {

    this.#api = api;
    this.#config = config;
    this.#log = log;

    api.on(APIEvent.DID_FINISH_LAUNCHING, () => {

      try {

        this.#launch();
      } catch(error) {

        this.#log.error("Unable to start: %s", describeError(error));
      }
    });

    api.on(APIEvent.SHUTDOWN, () => this.#abort.abort());
  }

  public configureAccessory(accessory: PlatformAccessory): void {

    this.#cached.set(accessory.UUID, accessory);
  }

  #launch(): void {

    const parsed = parseConfig(this.#config);
    const options = new FeatureOptions(featureOptionCategories, featureOptions, parsed.options);
    const keep = new Set<string>();
    const external: PlatformAccessory[] = [];

    for(const issue of parsed.issues) {

      this.#log.warn("[%s] %s", ErrorCode.CONFIG, issue);
    }

    if(!parsed.projectors.length) {

      this.#log.info("No projectors are configured yet. Add one in the plugin settings to get started.");
      this.#removeStale(keep);

      return;
    }

    const cache = new ProjectorCache(this.#api.user.storagePath(), this.#log);

    cache.retain(parsed.projectors.map((projector) => projector.id));

    for(const config of parsed.projectors) {

      if(!options.test(Option.DEVICE, config.id)) {

        this.#log.info("%s (%s) is hidden from HomeKit by a feature option.", config.name, config.host);

        continue;
      }

      const log = projectorLog(this.#log, () => config.name, () => parsed.debug);
      const controller = new ProjectorController({ config, initial: cache.get(config.id), isEnabled: (option): boolean => options.test(option, config.id), log,
        signal: this.#abort.signal });

      controller.onLearned(() => cache.update(config.id, { capabilities: controller.capabilities, identity: controller.identity, protocol: controller.protocol }));

      const context: AccessoryContext = { api: this.#api, cache, config, controller, enabled: (option) => options.test(option, config.id), log,
        value: (option) => options.value(option, config.id) };

      external.push(new TelevisionAccessory(context).accessory);

      if(CompanionAccessory.wanted(context)) {

        keep.add(this.#companion(context).UUID);
      }

      controller.start();
    }

    if(external.length) {

      this.#api.publishExternalAccessories(PLUGIN_NAME, external);
    }

    this.#removeStale(keep);
  }

  // Reuse the cached companion if Homebridge restored one, otherwise create and register it.
  #companion(context: AccessoryContext): PlatformAccessory {

    const uuid = this.#api.hap.uuid.generate(PLUGIN_NAME + ":" + context.config.id + ":companion");
    const cached = this.#cached.get(uuid);
    const accessory = cached ?? new this.#api.platformAccessory(context.config.name + " Controls", uuid, Categories.OTHER);

    new CompanionAccessory(context, accessory);

    if(cached) {

      this.#api.updatePlatformAccessories([accessory]);
    } else {

      this.#api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    return accessory;
  }

  #removeStale(keep: Set<string>): void {

    const stale = [...this.#cached.values()].filter((accessory) => !keep.has(accessory.UUID));

    if(stale.length) {

      this.#log.info("Removing %d accessor%s that %s no longer configured.", stale.length, (stale.length === 1) ? "y" : "ies", (stale.length === 1) ? "is" : "are");
      this.#api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
  }
}
