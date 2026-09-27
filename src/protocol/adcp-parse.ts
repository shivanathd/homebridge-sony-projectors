/* adcp-parse.ts: Pure functions for Sony ADCP replies. No I/O, so every edge case is unit-tested.
 *
 * ADCP is a line protocol: each command is one ASCII line ending in CRLF, and each reply is one line. A reply is `ok`, an `err_*` code, or a value, which may be
 * quoted ("on") or JSON ([{"light_src":1234}]).
 */
import type { PowerState } from "./types.ts";
import { createHash } from "node:crypto";

export type AdcpReply = { error: string; kind: "error" } | { kind: "ok" } | { kind: "value"; value: string };

export function unquote(value: string): string {

  return ((value.length >= 2) && value.startsWith("\"") && value.endsWith("\"")) ? value.slice(1, -1) : value;
}

export function parseReply(line: string): AdcpReply {

  const trimmed = line.trim();
  const lower = trimmed.toLowerCase();

  if(lower === "ok") {

    return { kind: "ok" };
  }

  if(lower.startsWith("err_")) {

    return { error: lower, kind: "error" };
  }

  return { kind: "value", value: unquote(trimmed) };
}

export function parsePower(value: string): PowerState {

  const status = value.toLowerCase();

  if((status === "standby") || (status === "saving_standby")) {

    return "standby";
  }

  if(status === "on") {

    return "on";
  }

  if(status.startsWith("startup")) {

    return "warming";
  }

  if(status.includes("cooling")) {

    return "cooling";
  }

  return "unknown";
}

// Sony answers `error ?` and `warning ?` with a JSON array, using a sentinel entry when everything is fine.
const NO_FAULT = new Set([ "", "no_err", "no_error", "no_warn", "no_warning", "none" ]);

export function parseJsonList(value: string): string[] {

  let entries: unknown;

  try {

    entries = JSON.parse(value);
  } catch {

    entries = [value];
  }

  const list = Array.isArray(entries) ? entries : [entries];

  return list.map((entry) => String(entry).trim().toLowerCase()).filter((entry) => !NO_FAULT.has(entry));
}

// The characters ADCP values use. Everything sent back to the projector is checked against this, so a value in the config or in a reply cannot smuggle in quotes
// or a line break and inject a second command.
const SAFE_TOKEN = /^[a-z0-9_.]{1,64}$/;

export function isSafeToken(value: string): boolean {

  return SAFE_TOKEN.test(value);
}

// `<command> ? --info` returns JSON describing valid values. The shape differs between firmware generations: a bare object or an array holding one, with range
// values that may or may not carry their own quotes. Returns null unless there is a non-empty list of safe tokens.
export function parseInfoRange(value: string): string[] | null {

  let info: unknown;

  try {

    info = JSON.parse(value);
  } catch {

    return null;
  }

  const object: unknown = Array.isArray(info) ? info[0] : info;
  const range = (object && (typeof object === "object")) ? (object as { range?: unknown }).range : undefined;

  if(!Array.isArray(range)) {

    return null;
  }

  const tokens = range.map((entry) => unquote(String(entry).trim()).toLowerCase()).filter(isSafeToken);

  return tokens.length ? tokens : null;
}

// Keys Sony uses for the light-source hour counter across lamp and laser models.
const HOUR_KEYS = /light|lamp|laser|src/i;

// `timer ?` reports light-source hours. Lamp models and laser models answer in different JSON shapes, so look for the first plausible hour count.
export function parseTimer(value: string): number | null {

  const trimmed = unquote(value.trim());

  if(/^\d+$/.test(trimmed)) {

    return Number(trimmed);
  }

  let parsed: unknown;

  try {

    parsed = JSON.parse(trimmed);
  } catch {

    return null;
  }

  for(const entry of Array.isArray(parsed) ? parsed : [parsed]) {

    if(!entry || (typeof entry !== "object")) {

      continue;
    }

    for(const [ key, raw ] of Object.entries(entry as Record<string, unknown>)) {

      const hours = Number.parseInt(String(raw), 10);

      if(HOUR_KEYS.test(key) && Number.isFinite(hours) && (String(hours) === String(raw).trim())) {

        return hours;
      }
    }
  }

  return null;
}

// ADCP authentication: the projector sends a random challenge and expects the lowercase hex SHA-256 of challenge + password. The password never crosses the wire.
export function hashChallenge(challenge: string, password: string): string {

  return createHash("sha256").update(challenge + password).digest("hex");
}
