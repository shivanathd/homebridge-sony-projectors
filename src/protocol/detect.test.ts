/* detect.test.ts: Protocol auto-detection. */
import { ErrorCode, isProjectorError } from "./errors.ts";
import { after, describe, test } from "node:test";
import { createTransport, detectProtocol } from "./detect.ts";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { startFakeAdcp } from "./fake-adcp.helpers.ts";
import { startFakeSdcp } from "./fake-sdcp.helpers.ts";

const cleanups: (() => Promise<void>)[] = [];

after(async () => Promise.all(cleanups.map(async (cleanup) => cleanup())));

// A port with nothing listening on it.
async function closedPort(): Promise<number> {

  const server = createServer();

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = server.address() as { port: number };

  await new Promise<void>((resolve) => server.close(() => resolve()));

  return port;
}

describe("detectProtocol", () => {

  test("prefers ADCP when it answers", async () => {

    const adcp = await startFakeAdcp();
    const sdcp = await startFakeSdcp();

    cleanups.push(async () => adcp.close(), async () => sdcp.close());
    assert.equal(await detectProtocol({ adcpPort: adcp.port, host: "127.0.0.1", sdcpPort: sdcp.port }), "adcp");
  });

  test("an ADCP projector with a wrong password is still detected as ADCP", async () => {

    const adcp = await startFakeAdcp({ password: "Projector" });

    cleanups.push(async () => adcp.close());
    assert.equal(await detectProtocol({ adcpPort: adcp.port, host: "127.0.0.1", password: "nope", sdcpPort: await closedPort() }), "adcp");
  });

  test("falls back to SDCP", async () => {

    const sdcp = await startFakeSdcp();

    cleanups.push(async () => sdcp.close());
    assert.equal(await detectProtocol({ adcpPort: await closedPort(), host: "127.0.0.1", sdcpPort: sdcp.port }), "sdcp");
  });

  test("nothing answering is SPJ-NET-UNREACHABLE", async () => {

    await assert.rejects(detectProtocol({ adcpPort: await closedPort(), host: "127.0.0.1", sdcpPort: await closedPort() }),
      (error: unknown) => isProjectorError(error) && (error.code === ErrorCode.NET_UNREACHABLE));
  });
});

describe("createTransport", () => {

  test("builds the requested transport with the right port", () => {

    const adcp = createTransport({ host: "10.0.0.5" }, "adcp");
    const sdcp = createTransport({ host: "10.0.0.5" }, "sdcp");

    assert.equal(adcp.endpoint, "10.0.0.5:53595");
    assert.equal(sdcp.endpoint, "10.0.0.5:53484");
    adcp.close();
    sdcp.close();
  });
});
