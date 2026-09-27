/* ui.mjs: Settings UI for homebridge-sony-projectors, built on the homebridge-plugin-utils webUi (the same framework homebridge-unifi-protect uses).
 *
 * First run: enter the projector's address and password, test the connection, save. After that the Feature Options tab lists each configured projector with its
 * model, protocol and lamp hours, and only offers options that projector supports.
 */
import { hasProjector, primaryProjector, projectors, withPrimaryProjector } from "./config-helpers.mjs";
import { scopeSafeId } from "homebridge-plugin-utils/featureOptions.js";
import { webUi } from "homebridge-plugin-utils/webUi.mjs";

const field = (id) => document.getElementById(id);

const showError = (title, result) => {

  const nodes = [ document.createTextNode(title), document.createElement("br") ];

  if(result?.message) {

    const detail = document.createElement("code");

    detail.className = "text-danger";
    detail.textContent = (result.code ? "[" + result.code + "] " : "") + result.message;
    nodes.push(detail, document.createElement("br"));
  }

  if(result?.hint) {

    nodes.push(document.createTextNode(result.hint));
  }

  field("probeError").replaceChildren(...nodes);
};

const firstRun = {

  isRequired: ({ config }) => !hasProjector(config),

  onStart: ({ config }) => {

    const projector = primaryProjector(config);

    field("host").value = projector?.host ?? "";
    field("password").value = projector?.password ?? "";

    return true;
  },

  onSubmit: async ({ commit, config }) => {

    const host = field("host").value.trim();
    const password = field("password").value;

    field("probeError").replaceChildren();

    if(!host) {

      showError("Please enter the projector's IP address or hostname.");
      homebridge.hideSpinner();

      return false;
    }

    try {

      const result = await homebridge.request("/probe", { host, password });

      if(!result?.ok) {

        showError("Unable to connect to the projector.", result);
        homebridge.hideSpinner();

        return false;
      }

      await commit(withPrimaryProjector(config, { host, name: result.identity?.model ?? "Projector", password }));

      return true;
    } catch(error) {

      showError("Unable to complete setup.", { message: (error instanceof Error) ? error.message : String(error) });
      homebridge.hideSpinner();

      return false;
    }
  }
};

// Each projector is a "controller" in the options editor, and also its only device, so options can be set globally or per projector.
const getControllers = async ({ config }) => ({

  controllers: projectors(config).filter((projector) => projector?.host).map((projector) => ({

    address: projector.host, name: projector.name || projector.host, serialNumber: scopeSafeId(projector.host.trim().toLowerCase())
  })),
  error: ""
});

const getDevices = async (controller, { config }) => {

  if(!controller) {

    return { devices: [], error: "" };
  }

  const projector = projectors(config).find((candidate) => scopeSafeId(String(candidate?.host ?? "").trim().toLowerCase()) === controller.serialNumber);

  if(!projector) {

    return { devices: [], error: "This projector is no longer in the plugin configuration." };
  }

  const result = await homebridge.request("/probe", projector);

  if(!result?.ok) {

    return { devices: [], error: (result?.code ? "[" + result.code + "] " : "") + (result?.message ?? "Unable to reach the projector."),
      guidance: result?.hint };
  }

  return {

    devices: [{

      capabilities: result.capabilities,
      firmwareRevision: result.identity.firmware ?? "",
      isProjector: true,
      lightHours: result.lightHours,
      manufacturer: "Sony",
      model: result.identity.model ?? "Sony projector",
      name: projector.name || result.identity.model || projector.host,
      power: result.power,
      protocol: result.protocol,
      serial: result.identity.serial ?? "",
      serialNumber: controller.serialNumber
    }],
    error: ""
  };
};

// Hide options the selected projector cannot use, using the `meta.requires` capability names from the options catalog.
const supports = (device, meta) => !device?.capabilities || !meta?.requires || (device.capabilities[meta.requires] === true);

const statRow = (label, value) => {

  const item = document.createElement("div");
  const labelSpan = document.createElement("span");
  const valueSpan = document.createElement("span");

  item.className = "stat-item";
  labelSpan.className = "stat-label";
  valueSpan.className = "stat-value";
  labelSpan.textContent = label;
  valueSpan.textContent = value ?? "";
  item.append(labelSpan, valueSpan);

  return item;
};

const infoPanel = ({ device, panel }) => {

  if(!device) {

    panel.textContent = "";

    return;
  }

  const grid = document.createElement("div");

  grid.className = "device-stats-grid";
  grid.append(

    statRow("Model", device.model),
    statRow("Serial", device.serial || "Unknown"),
    statRow("Protocol", String(device.protocol ?? "").toUpperCase()),
    statRow("Power", device.power),
    statRow("Lamp hours", ((device.lightHours === null) || (device.lightHours === undefined)) ? "Unknown" : String(device.lightHours))
  );

  panel.replaceChildren(grid);
};

const ui = new webUi({

  featureOptions: {

    getControllers,
    getDevices,
    infoPanel,
    sidebar: { controllerLabel: "Projectors", deviceLabel: "Projector" },
    ui: {

      controllerRetryEnableDelayMs: 5000,
      isController: (device) => device?.isProjector === true,
      validOption: (device, option) => supports(device, option.meta),
      validOptionCategory: (device, category) => supports(device, category.meta)
    }
  },
  firstRun,
  name: "Sony Projectors"
});

ui.show();
