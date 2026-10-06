// Channel names only (no zod), so the sandboxed preload can allowlist them cheaply.
export const INVOKE_CHANNELS = [
  'app.getInfo',
  'app.getLocale',
  'window.minimize',
  'window.toggleMaximize',
  'window.close',
  'window.isMaximized',
  'settings.get',
  'settings.set',
  // Playback spike (phase 0). Only answered when the app runs with MATANE_SPIKE=1 or in development.
  'spike.fixtures',
  'spike.start',
  'spike.stats',
  'spike.reset',
  'spike.report',
] as const;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const EVENT_CHANNELS = ['window.maximizeChanged', 'settings.changed'] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];
