/* fake-projector.helpers.ts: Run a fake Sony ADCP projector for local development and manual testing.
 *
 *   node src/fake-projector.helpers.ts [--port 55595] [--password Projector] [--on]
 *
 * Pair it with `npm run dev`, which starts Homebridge with test/hbConfig/config.json pointed at this fake.
 */
/* eslint-disable no-console */
// This is a command-line tool, so it reports to the console.
import { parseArgs } from "node:util";
import { startFakeAdcp } from "./protocol/fake-adcp.helpers.ts";

const { values } = parseArgs({ options: { on: { type: "boolean" }, password: { type: "string" }, port: { default: "55595", type: "string" } } });
const fake = await startFakeAdcp({ password: values.password, port: Number(values.port), state: values.on ? { power: "on" } : {}, transitionMs: 3000 });

console.log("Fake VPL-VW290ES listening on %s:%d%s. Press Ctrl+C to stop.", fake.host, fake.port, values.password ? " (password required)" : "");

setInterval(() => console.log("state: %s", JSON.stringify(fake.state)), 5000).unref();
process.on("SIGINT", () => void fake.close().then(() => process.exit(0)));
