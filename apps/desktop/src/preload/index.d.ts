import type { IpcApi } from '@matane-anime/shared';

declare global {
  interface Window {
    api: IpcApi;
  }
}
