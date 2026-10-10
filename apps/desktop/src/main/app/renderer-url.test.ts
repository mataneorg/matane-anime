import { describe, expect, it } from 'vitest';
import { devServerUrl, isPermissionAllowed, isTrustedRendererUrl } from './renderer-url';

const DEV = 'http://localhost:5173';

describe('devServerUrl', () => {
  it('is used only by an unpackaged build', () => {
    expect(devServerUrl(DEV, false)).toBe(DEV);
    expect(devServerUrl(DEV, true)).toBeUndefined();
    expect(devServerUrl('', false)).toBeUndefined();
    expect(devServerUrl(undefined, false)).toBeUndefined();
  });
});

describe('isTrustedRendererUrl', () => {
  it('trusts the packaged file and the dev server origin, nothing that merely starts like it', () => {
    expect(isTrustedRendererUrl('file:///opt/app/out/renderer/index.html', undefined)).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:5173/#/library', DEV)).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:5173.evil.example/', DEV)).toBe(false);
    expect(isTrustedRendererUrl('http://localhost:5174/', DEV)).toBe(false);
    expect(isTrustedRendererUrl('http://localhost:5173/', undefined)).toBe(false);
    expect(isTrustedRendererUrl('https://example.com/', DEV)).toBe(false);
    expect(isTrustedRendererUrl('not a url', DEV)).toBe(false);
  });
});

describe('isPermissionAllowed', () => {
  it('lets the renderer go fullscreen and copy, and refuses everything else, everywhere else', () => {
    const page = 'file:///opt/app/out/renderer/index.html';
    expect(isPermissionAllowed('fullscreen', page, undefined)).toBe(true);
    expect(isPermissionAllowed('clipboard-sanitized-write', page, undefined)).toBe(true);
    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal']) {
      expect(isPermissionAllowed(permission, page, undefined), permission).toBe(false);
    }
    expect(isPermissionAllowed('fullscreen', 'https://site.example/player', undefined)).toBe(false);
  });
});
