/* detect.ts: Build the right transport for a projector, detecting the protocol when the user leaves it on "auto". */
import { ErrorCode, ProjectorError, isProjectorError } from "./errors.ts";
import type { ProjectorTransport, Protocol } from "./types.ts";
import { AdcpTransport } from "./adcp.ts";
import { DEFAULTS } from "../settings.ts";
import { SdcpTransport } from "./sdcp.ts";

export interface ConnectionSettings {

  adcpPort?: number;
  commandTimeoutMs?: number;
  community?: string;
  debug?: (message: string) => void;
  host: string;
  pacingMs?: number;
  password?: string;
  sdcpPort?: number;
}

export function createTransport(settings: ConnectionSettings, protocol: Protocol): ProjectorTransport {

  const common = { commandTimeoutMs: settings.commandTimeoutMs, debug: settings.debug, host: settings.host, pacingMs: settings.pacingMs };

  return (protocol === "adcp") ? new AdcpTransport({ ...common, password: settings.password, port: settings.adcpPort ?? DEFAULTS.adcpPort }) :
    new SdcpTransport({ ...common, community: settings.community, port: settings.sdcpPort ?? DEFAULTS.sdcpPort });
}

// Errors that prove an ADCP projector is on the other end, even though the command failed.
const SPEAKS_ADCP = new Set<string>([ ErrorCode.AUTH_FAILED, ErrorCode.AUTH_REQUIRED, ErrorCode.BUSY ]);

// Errors that prove an SDCP projector is on the other end.
const SPEAKS_SDCP = new Set<string>([ ErrorCode.BUSY, ErrorCode.COMMUNITY ]);

async function probe(transport: ProjectorTransport, proof: Set<string>): Promise<ProjectorError | null> {

  try {

    await transport.getPower();

    return null;
  } catch(error) {

    if(isProjectorError(error) && proof.has(error.code)) {

      return null;
    }

    return isProjectorError(error) ? error : new ProjectorError(ErrorCode.PROTO_INVALID, String(error));
  } finally {

    transport.close();
  }
}

export async function detectProtocol(settings: ConnectionSettings): Promise<Protocol> {

  const adcpError = await probe(createTransport(settings, "adcp"), SPEAKS_ADCP);

  if(!adcpError) {

    return "adcp";
  }

  const sdcpError = await probe(createTransport(settings, "sdcp"), SPEAKS_SDCP);

  if(!sdcpError) {

    return "sdcp";
  }

  throw new ProjectorError(ErrorCode.NET_UNREACHABLE, settings.host + ": no projector answered on ADCP (" + adcpError.detail + ") or SDCP (" + sdcpError.detail +
    ").");
}
