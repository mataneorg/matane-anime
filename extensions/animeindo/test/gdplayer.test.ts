import { pbkdf2Sync } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { pbkdf2Sha256, readGdplayerVars } from '../src/gdplayer';
import { readGdriveplayerPlaylist } from '../src/gdriveplayer';
import { fixture } from './harness';

// These helpers run in the sandbox, whose globals are stood in for here (Node has no `base64` or `timers`).
beforeAll(() => {
  Object.assign(globalThis, {
    timers: { sleep: () => Promise.resolve() },
    base64: { decodeBytes: (text: string) => new Uint8Array(Buffer.from(text, 'base64')) },
  });
});

describe('gdplayer helpers', () => {
  it('reads the player values out of the AAEncoded and packed script, without running it', () => {
    const vars = readGdplayerVars(fixture('gdplayer_embed.html.txt'));
    expect(vars).toMatchObject({ __ts: '1791552484', __nc: '820a5cb8b6e33e2b01ae53d2e1a86f97' });
    expect(Buffer.from(vars?.['apx'] ?? '', 'base64').toString()).toBe('https://gdplayer.to/api-config/');
    expect(vars?.['__sg']).toMatch(/^[0-9a-f]{32,}$/);
    expect(readGdplayerVars('<html></html>')).toBeUndefined();
  });

  it('PBKDF2-HMAC-SHA256 matches Node for the 48 bytes the player derives', async () => {
    const password = new TextEncoder().encode(
      'V8xK2mP9qR4wT6yA3bN7cJ5dF1gH0eL17915524840a5cb8b6e33e2b01ae53d2e1a86f97',
    );
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 3);
    const started = Date.now();
    const mine = await pbkdf2Sha256(password, salt, 10_000, 48);
    console.log('pbkdf2 in V8:', Date.now() - started, 'ms');
    expect(Buffer.from(mine).toString('hex')).toBe(pbkdf2Sync(password, salt, 10_000, 48, 'sha256').toString('hex'));
    const small = await pbkdf2Sha256(new TextEncoder().encode('pw'), new Uint8Array([1, 2, 3]), 3, 20);
    expect(Buffer.from(small).toString('hex')).toBe(
      pbkdf2Sync('pw', Buffer.from([1, 2, 3]), 3, 20, 'sha256').toString('hex'),
    );
  });

  it('reads the gdriveplayer playlist from its XOR loader', () => {
    const url = readGdriveplayerPlaylist(fixture('gdriveplayer_embed.html.txt'), 'https://gdriveplayer.to');
    expect(url).toMatch(/^https:\/\/gdriveplayer\.to\/hlsplaylist\.php\?s=[^"]+idhls=.+\.m3u8$/);
    expect(readGdriveplayerPlaylist('<html></html>', 'https://gdriveplayer.to')).toBeUndefined();
  });
});
