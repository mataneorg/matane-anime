import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from './channels';
import { eventContract, invokeContract } from './contract';

describe('IPC contract', () => {
  it('declares exactly the channels the preload allowlists', () => {
    expect(Object.keys(invokeContract).sort()).toEqual([...INVOKE_CHANNELS].sort());
    expect(Object.keys(eventContract).sort()).toEqual([...EVENT_CHANNELS].sort());
  });

  it('has no channel declared twice', () => {
    expect(new Set(INVOKE_CHANNELS).size).toBe(INVOKE_CHANNELS.length);
    expect(new Set(EVENT_CHANNELS).size).toBe(EVENT_CHANNELS.length);
  });

  it('validates the input of settings.set as a patch', () => {
    const schema = invokeContract['settings.set'].input;
    expect(schema.parse({ accent: 'teal' })).toEqual({ accent: 'teal' });
    expect(schema.safeParse({ accent: 'chartreuse' }).success).toBe(false);
  });

  it('takes no input for the window and app queries', () => {
    expect(invokeContract['app.getInfo'].input.safeParse(undefined).success).toBe(true);
    expect(invokeContract['window.isMaximized'].input.safeParse(undefined).success).toBe(true);
    expect(invokeContract['window.isMaximized'].input.safeParse({ x: 1 }).success).toBe(false);
  });

  it('checks the spike results that the renderer reports', () => {
    const schema = invokeContract['spike.report'].input;
    const ok = {
      id: 'hls-ts',
      played: true,
      videoDecoded: true,
      canPlayType: 'maybe',
      mseSupported: true,
      ttffMs: 120,
      seekMs: 300,
      error: null,
      errorCode: null,
      notes: [],
    };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, ttffMs: 'fast' }).success).toBe(false);
  });

  it('checks the unsaved form values that the connection test takes', () => {
    const schema = invokeContract['network.testConnection'].input;
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ settings: { proxyMode: 'http', proxyPort: 8080 }, proxyPassword: 'x' }).success).toBe(
      true,
    );
    expect(schema.safeParse({ settings: { proxyMode: 'carrier-pigeon' } }).success).toBe(false);
  });

  it('never returns the proxy password to the renderer', () => {
    const output = invokeContract['network.proxyPasswordInfo'].output;
    expect(output.safeParse({ stored: true, encrypted: true }).success).toBe(true);
    expect(Object.keys(output.shape)).toEqual(['stored', 'encrypted']);
  });

  it('uses the default settings as a valid settings.changed payload', () => {
    expect(eventContract['settings.changed'].safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
});
