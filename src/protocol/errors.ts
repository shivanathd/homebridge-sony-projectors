/* errors.ts: Typed, coded errors for everything that can go wrong talking to a projector.
 *
 * Every failure a user can see carries a stable SPJ-* code. The code is printed in the log line, and docs/Troubleshooting.md is organized by code, so a user can go
 * straight from a log line to the fix.
 */

export const ErrorCode = {

  ABORTED: "SPJ-ABORTED",
  AUTH_FAILED: "SPJ-AUTH-FAILED",
  AUTH_REQUIRED: "SPJ-AUTH-REQUIRED",
  BUSY: "SPJ-BUSY",
  COMMUNITY: "SPJ-COMMUNITY",
  CONFIG: "SPJ-CONFIG",
  NET_CLOSED: "SPJ-NET-CLOSED",
  NET_TIMEOUT: "SPJ-NET-TIMEOUT",
  NET_UNREACHABLE: "SPJ-NET-UNREACHABLE",
  PROTO_INVALID: "SPJ-PROTO-INVALID",
  PROTO_REJECTED: "SPJ-PROTO-REJECTED",
  PROTO_UNSUPPORTED: "SPJ-PROTO-UNSUPPORTED"
} as const;

export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

// What to do about each error, written for the person reading the Homebridge log.
const HINTS: Record<ErrorCode, string> = {

  [ErrorCode.ABORTED]: "The command was cancelled because Homebridge is shutting down or the projector was reconfigured. No action is needed.",
  [ErrorCode.AUTH_FAILED]: "The projector rejected the ADCP password. Use the projector's web administrator password (factory default: Projector). After several " +
    "failed attempts the projector locks out for about 30 seconds, even for the correct password.",
  [ErrorCode.AUTH_REQUIRED]: "The projector requires ADCP authentication, but no password is configured. Add the projector's web administrator password to this " +
    "projector's settings.",
  [ErrorCode.BUSY]: "The projector is warming up, cooling down, or the feature is unavailable in its current state. Wait a moment and try again.",
  [ErrorCode.COMMUNITY]: "The projector rejected the SDCP community string. It must match the projector's PJ Talk community setting (factory default: SONY).",
  [ErrorCode.CONFIG]: "The plugin configuration is invalid. Fix the setting named in this message in the plugin settings.",
  [ErrorCode.NET_CLOSED]: "The projector closed the connection unexpectedly. If this keeps happening, check for another control system connected to the " +
    "projector, and check its host allow-list setting.",
  [ErrorCode.NET_TIMEOUT]: "The projector did not answer in time. Check that it is powered, connected to the network, and that Remote Start or Network " +
    "Management is On so it listens while in standby.",
  [ErrorCode.NET_UNREACHABLE]: "Could not reach the projector. Check the IP address, that the projector is plugged in and on the network, that Remote Start or " +
    "Network Management is On, and that ADCP (or PJ Talk) is enabled in its network settings.",
  [ErrorCode.PROTO_INVALID]: "The projector sent a reply the plugin did not understand. Turn on debug logging and open an issue with the log attached.",
  [ErrorCode.PROTO_REJECTED]: "The projector refused the command's value. The value may not be valid for this model or input signal.",
  [ErrorCode.PROTO_UNSUPPORTED]: "This projector model does not support the command. Features the projector reports as unsupported when the plugin connects " +
    "are not offered; if you see this for a feature that is offered, please open an issue with your model."
};

export class ProjectorError extends Error {

  public readonly code: ErrorCode;
  public readonly detail: string;
  public readonly hint: string;

  constructor(code: ErrorCode, detail: string, options?: ErrorOptions) {

    super("[" + code + "] " + detail, options);

    this.code = code;
    this.detail = detail;
    this.hint = HINTS[code];
    this.name = "ProjectorError";
  }
}

export function isProjectorError(error: unknown): error is ProjectorError {

  return error instanceof ProjectorError;
}

// Socket error codes that mean nothing is listening or the host cannot be found.
const UNREACHABLE_CODES = new Set([ "EAI_AGAIN", "ECONNREFUSED", "EHOSTDOWN", "EHOSTUNREACH", "ENETDOWN", "ENETUNREACH", "ENOTFOUND" ]);

// Socket error codes that mean an established connection was torn down.
const CLOSED_CODES = new Set([ "ECONNABORTED", "ECONNRESET", "EPIPE" ]);

// Turn whatever a socket threw into a ProjectorError, naming the endpoint so the log line is self-explanatory.
export function fromSocketError(error: unknown, endpoint: string): ProjectorError {

  if(isProjectorError(error)) {

    return error;
  }

  const code = (error as { code?: unknown } | null)?.code;
  const message = (error instanceof Error) ? error.message : String(error);

  if((typeof code === "string") && CLOSED_CODES.has(code)) {

    return new ProjectorError(ErrorCode.NET_CLOSED, endpoint + ": connection closed (" + code + ").", { cause: error });
  }

  return new ProjectorError(ErrorCode.NET_UNREACHABLE, endpoint + ": " + (((typeof code === "string") && UNREACHABLE_CODES.has(code)) ? code : message) + ".",
    { cause: error });
}
