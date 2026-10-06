import type { CloudflareStatus } from '@matane-anime/shared';
import { create } from 'zustand';

/** The state of the Cloudflare verification per extension, pushed by main. Transient, so not in Query. */
interface NetworkState {
  cloudflare: Record<string, CloudflareStatus['state']>;
  setCloudflare: (status: CloudflareStatus) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  cloudflare: {},
  setCloudflare: ({ extensionId, state }) =>
    set((previous) => ({ cloudflare: { ...previous.cloudflare, [extensionId]: state } })),
}));
