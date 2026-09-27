/* poll.ts: A poll made of individual reads, for transports that cannot batch (SDCP). */
import type { PollRequest, PollResult, ProjectorTransport, Reading } from "./types.ts";

async function read<T>(get: () => Promise<T>): Promise<Reading<T>> {

  try {

    return { value: await get() };
  } catch(error) {

    return { error };
  }
}

export async function pollIndividually(transport: ProjectorTransport, request: PollRequest): Promise<PollResult> {

  const result: PollResult = { power: await transport.getPower() };

  if(request.picture) {

    result.input = await read(async () => transport.getInput());
    result.pictureMode = await read(async () => transport.getPictureMode());
    result.aspect = await read(async () => transport.getAspect());
  }

  if(request.blank) {

    result.blank = await read(async () => transport.getBlank());
  }

  if(request.lightHours) {

    result.lightHours = await read(async () => transport.getLightHours());
  }

  if(request.faults) {

    result.faults = await read(async () => transport.getFaults());
  }

  return result;
}
