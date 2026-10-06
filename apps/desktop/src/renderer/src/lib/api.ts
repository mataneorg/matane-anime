import { type IpcApi, decodeIpcError } from '@matane-anime/shared';

/**
 * `window.api.invoke` with failures turned back into `AppError`s (Electron only carries the message, so the
 * code and detail travel inside it). Use this for anything whose errors the UI shows.
 */
export const call: IpcApi['invoke'] = (async (channel: string, input?: unknown) => {
  try {
    return await (window.api.invoke as (channel: string, input?: unknown) => Promise<unknown>)(channel, input);
  } catch (error) {
    throw decodeIpcError(error);
  }
}) as IpcApi['invoke'];
