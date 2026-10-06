// Channel names only (no zod), so the sandboxed preload can allowlist them cheaply.
export const INVOKE_CHANNELS = [
  'app.getInfo',
  'app.getLocale',
  'app.openExternal',
  'window.minimize',
  'window.toggleMaximize',
  'window.close',
  'window.isMaximized',
  'settings.get',
  'settings.set',
  'dialog.pickFolder',
  'network.getStatus',
  'requests.cancel',
  'extensions.list',
  'extensions.loadDevFolder',
  'extensions.removeDevFolder',
  'extensions.reload',
  'extensions.logs',
  'extensions.preferences',
  'extensions.setPreference',
  'sources.list',
  'sources.capabilities',
  'sources.filters',
  'sources.browse',
  'sources.resolveUrl',
  'sources.setPinned',
  'anime.get',
  'anime.refresh',
  'episodes.list',
  'playback.start',
  'playback.event',
  'playback.switchStream',
  'playback.close',
  'playback.keepAwake',
  // Playback spike (phase 0). Only answered when the app runs with MATANE_SPIKE=1 or in development.
  'spike.fixtures',
  'spike.start',
  'spike.stats',
  'spike.reset',
  'spike.report',
] as const;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const EVENT_CHANNELS = [
  'window.maximizeChanged',
  'settings.changed',
  /** A write touched these entities: queries tagged with them are stale. */
  'db.changed',
  'network.status',
  'extensions.log',
  'cloudflare.status',
] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];
