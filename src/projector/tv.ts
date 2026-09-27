/* tv.ts: The projector as a HomeKit Television.
 *
 * One external (unbridged) accessory per projector, because HomeKit allows one television per bridge. It carries power (Active), inputs (InputSource services
 * linked to the Television), the Apple TV Remote in Control Center (RemoteKey) and "View TV Settings" (PowerModeSelection, mapped to the projector's menu).
 */
import { Categories, HAPStatus, acquireService, notResponding } from "homebridge-plugin-utils";
import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";
import { PLUGIN_NAME, Subtype } from "../settings.ts";
import type { AccessoryContext } from "./context.ts";
import { Option } from "../options.ts";
import { inputLabel } from "../protocol/labels.ts";
import { runFromHomeKit } from "./context.ts";

// HomeKit input identifiers must stay stable across restarts, so derive them from the input itself: HDMI 1 is always 1. Inputs without a number get 100 and up.
export function inputIdentifier(token: string, index: number): number {

  const match = /^hdmi(\d+)$/.exec(token);

  return match ? Number(match[1]) : (100 + index);
}

export class TelevisionAccessory {

  public readonly accessory: PlatformAccessory;

  readonly #context: AccessoryContext;
  readonly #inputs = new Map<number, string>();
  readonly #tv: Service;
  #warnedNoRemote = false;

  constructor(context: AccessoryContext) {

    const { api, config, controller } = context;
    const { Characteristic, Service, uuid } = api.hap;

    this.#context = context;
    this.accessory = new api.platformAccessory(config.name, uuid.generate(PLUGIN_NAME + ":" + config.id + ":tv"), Categories.TELEVISION);

    const tv = acquireService(this.accessory, Service.Television, config.name);

    this.#tv = tv;
    tv.setCharacteristic(Characteristic.ConfiguredName, config.name);
    tv.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    // Reads never touch the network: they return cached state, or "No Response" while the projector cannot be reached.
    const available = notResponding({ errorClass: api.hap.HapStatusError, unavailable: () => !controller.store.get("reachable") });

    tv.getCharacteristic(Characteristic.Active)
      .onGet(available(() => this.#active()))
      .onSet(async (value: CharacteristicValue) => runFromHomeKit(api, async () => controller.setPower(value === Characteristic.Active.ACTIVE),
        () => tv.updateCharacteristic(Characteristic.Active, this.#active())));

    tv.getCharacteristic(Characteristic.ActiveIdentifier)
      .onGet(available(() => this.#activeIdentifier()))
      .onSet(async (value: CharacteristicValue) => {

        const input = this.#inputs.get(Number(value));

        if(input) {

          await runFromHomeKit(api, async () => controller.setInput(input), () => tv.updateCharacteristic(Characteristic.ActiveIdentifier, this.#activeIdentifier()));
        }
      });

    tv.getCharacteristic(Characteristic.RemoteKey).onSet(async (value: CharacteristicValue) => this.#remote(Number(value)));
    tv.getCharacteristic(Characteristic.PowerModeSelection).onSet(async () => this.#remoteAction("menu"));

    this.#updateInformation();
    this.#reconcileInputs();

    controller.store.onChange((key, value) => {

      switch(key) {

        case "power":

          tv.updateCharacteristic(Characteristic.Active, this.#active());

          break;

        case "input":

          tv.updateCharacteristic(Characteristic.ActiveIdentifier, this.#activeIdentifier());

          break;

        case "reachable":

          if(!value) {

            tv.updateCharacteristic(Characteristic.Active, new api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE));
          } else {

            tv.updateCharacteristic(Characteristic.Active, this.#active());
          }

          break;

        default:

          break;
      }
    });

    controller.onLearned(() => {

      this.#updateInformation();
      this.#reconcileInputs();
    });
  }

  #active(): number {

    const power = this.#context.controller.store.get("power");
    const { Active } = this.#context.api.hap.Characteristic;

    return ((power === "on") || (power === "warming")) ? Active.ACTIVE : Active.INACTIVE;
  }

  #activeIdentifier(): number {

    const input = this.#context.controller.store.get("input");

    for(const [ identifier, token ] of this.#inputs) {

      if(token === input) {

        return identifier;
      }
    }

    return this.#tv.getCharacteristic(this.#context.api.hap.Characteristic.ActiveIdentifier).value as number;
  }

  #updateInformation(): void {

    const { api, config, controller } = this.#context;
    const { Characteristic, Service } = api.hap;
    const { firmware, model, serial } = controller.identity;
    const information = this.accessory.getService(Service.AccessoryInformation);

    information?.setCharacteristic(Characteristic.Manufacturer, "Sony")
      .setCharacteristic(Characteristic.Model, model ?? "Projector")
      .setCharacteristic(Characteristic.SerialNumber, serial ?? config.id);

    // HomeKit only accepts dotted-number firmware versions.
    if(firmware && /^\d+(\.\d+){0,2}$/.test(firmware)) {

      information?.setCharacteristic(Characteristic.FirmwareRevision, firmware);
    }
  }

  // Make the InputSource services match the projector's inputs: add new ones, remove ones it no longer reports.
  #reconcileInputs(): void {

    const { api, cache, config, controller } = this.#context;
    const { Characteristic, Service } = api.hap;
    const tokens = controller.capabilities.inputs;
    const wanted = new Set(tokens.map((token) => Subtype.input(token)));

    for(const service of this.accessory.services.filter((candidate) => (candidate.UUID === Service.InputSource.UUID) && !wanted.has(candidate.subtype ?? ""))) {

      this.#tv.removeLinkedService(service);
      this.accessory.removeService(service);
    }

    this.#inputs.clear();

    tokens.forEach((token, index) => {

      const identifier = inputIdentifier(token, index);
      const preference = cache.get(config.id).inputs?.[token] ?? {};
      const name = preference.name ?? inputLabel(token);
      const visibility = preference.hidden ? Characteristic.CurrentVisibilityState.HIDDEN : Characteristic.CurrentVisibilityState.SHOWN;

      this.#inputs.set(identifier, token);

      acquireService(this.accessory, Service.InputSource, name, Subtype.input(token), (input) => {

        input.setCharacteristic(Characteristic.ConfiguredName, name)
          .setCharacteristic(Characteristic.InputSourceType, token.startsWith("hdmi") ? Characteristic.InputSourceType.HDMI : Characteristic.InputSourceType.OTHER)
          .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
          .setCharacteristic(Characteristic.CurrentVisibilityState, visibility)
          .setCharacteristic(Characteristic.TargetVisibilityState, visibility);

        input.getCharacteristic(Characteristic.ConfiguredName).onSet((value: CharacteristicValue) => cache.setInput(config.id, token,
          { name: (typeof value === "string") ? value : inputLabel(token) }));
        input.getCharacteristic(Characteristic.TargetVisibilityState).onSet((value: CharacteristicValue) => {

          const hidden = value === Characteristic.TargetVisibilityState.HIDDEN;

          input.updateCharacteristic(Characteristic.CurrentVisibilityState, hidden ? Characteristic.CurrentVisibilityState.HIDDEN :
            Characteristic.CurrentVisibilityState.SHOWN);
          cache.setInput(config.id, token, { hidden });
        });

        this.#tv.addLinkedService(input);
      }).setCharacteristic(Characteristic.Identifier, identifier);
    });
  }

  async #remote(key: number): Promise<void> {

    const { enabled, value } = this.#context;
    const { RemoteKey } = this.#context.api.hap.Characteristic;

    if(!enabled(Option.REMOTE)) {

      this.#context.log.debug("Ignoring a remote button: the Remote feature option is disabled.");

      return;
    }

    const actions: Partial<Record<number, string>> = {

      [RemoteKey.ARROW_UP]: "up",
      [RemoteKey.ARROW_DOWN]: "down",
      [RemoteKey.ARROW_LEFT]: "left",
      [RemoteKey.ARROW_RIGHT]: "right",
      [RemoteKey.SELECT]: "enter",
      [RemoteKey.BACK]: value(Option.REMOTE_BACK) ?? "return",
      [RemoteKey.EXIT]: "menu",
      [RemoteKey.INFORMATION]: value(Option.REMOTE_INFO) ?? "menu",
      [RemoteKey.PLAY_PAUSE]: value(Option.REMOTE_PLAY_PAUSE) ?? "blank"
    };

    await this.#remoteAction(actions[key] ?? "none");
  }

  // Remote failures are logged by the controller and not reported back to HomeKit: the Remote has no way to show an error, and a failed button press should not
  // mark the whole projector as not responding.
  async #remoteAction(action: string): Promise<void> {

    const { controller, log } = this.#context;

    if(!controller.capabilities.remote && (action !== "blank") && (action !== "none")) {

      if(!this.#warnedNoRemote) {

        this.#warnedNoRemote = true;
        log.warn("Remote buttons other than picture mute are not available on this projector (SDCP). Use ADCP if the projector supports it.");
      }

      return;
    }

    try {

      await controller.remoteAction(action);
    } catch {

      // Already logged with its fix by the controller.
    }
  }
}
