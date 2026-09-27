/* probe.ts: One-shot connection test for the settings UI.
 *
 * Runs in the Homebridge UI's server process (homebridge-ui/server.js), not in the bridge. It validates the settings with the same parser the plugin uses,
 * connects once, and reports what it found, or a coded failure with its fix. It never returns the password.
 */
import type { Capabilities, PowerState, ProjectorIdentity, Protocol } from "./protocol/types.ts";
import { ErrorCode, isProjectorError } from "./protocol/errors.ts";
import { createTransport, detectProtocol } from "./protocol/detect.ts";
import { parseConfig } from "./config.ts";

export type ProbeResult = { capabilities: Capabilities; id: string; identity: ProjectorIdentity; lightHours: number | null; ok: true; power: PowerState;
  protocol: Protocol; } | { code: string; hint: string; message: string; ok: false };

export async function probeProjector(settings: Record<string, unknown>): Promise<ProbeResult> {

  const parsed = parseConfig({ projectors: [settings] });
  const config = parsed.projectors[0];

  if(!config) {

    return { code: ErrorCode.CONFIG, hint: "Check the projector's IP address or hostname.", message: parsed.issues.join(" "), ok: false };
  }

  try {

    const connection = { adcpPort: config.adcpPort, community: config.community, host: config.host, password: config.password, sdcpPort: config.sdcpPort };
    const protocol = (config.protocol === "auto") ? await detectProtocol(connection) : config.protocol;
    const transport = createTransport(connection, protocol);

    try {

      const power = await transport.getPower();
      const identity = await transport.identify();
      const capabilities = await transport.capabilities();
      const lightHours = capabilities.lightHours ? await transport.getLightHours().catch(() => null) : null;

      return { capabilities, id: config.id, identity, lightHours, ok: true, power, protocol };
    } finally {

      transport.close();
    }
  } catch(error) {

    if(isProjectorError(error)) {

      return { code: error.code, hint: error.hint, message: error.detail, ok: false };
    }

    return { code: ErrorCode.PROTO_INVALID, hint: "Please open an issue with this message.", message: (error instanceof Error) ? error.message : String(error),
      ok: false };
  }
}
