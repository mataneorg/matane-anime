// Test helpers only; not exported from index.ts.
import { deflateSync } from 'fflate';
import type { ExtensionManifest } from '@matane-anime/extension-sdk/manifest';

export function manifestFor(id: string, overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id,
    name: `Extension ${id}`,
    version: '1.0.0',
    apiVersion: 1,
    type: 'anime',
    nsfw: false,
    sources: [
      { key: 'main', lang: 'en', name: 'Main' },
      { key: 'id', lang: 'id', name: 'Indonesia' },
    ],
    ...overrides,
  };
}

/** Not a real PNG; the archive does not look inside the icon. */
export function fakeIcon(seed = 1, length = 64): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 0xff);
}

export interface RawEntry {
  name: string;
  data: Uint8Array | string;
  /** 0 = stored, 8 = deflate (default). */
  method?: number;
  flags?: number;
  /** Written in the central directory (and local header) instead of the real length. */
  declaredSize?: number;
}

const encoder = new TextEncoder();

/** A minimal zip writer that can produce files fflate would never write. */
export function rawZip(entries: RawEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const method = entry.method ?? 8;
    const body = method === 8 ? deflateSync(raw) : raw;
    const size = entry.declaredSize ?? raw.length;
    const flags = entry.flags ?? 0;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);

    parts.push(local, body);
    central.push(cd);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return Buffer.concat([...parts, ...central, end]);
}

/** The three valid entries; tests replace or add to them. */
export function validEntries(manifest: ExtensionManifest = manifestFor('demo')): RawEntry[] {
  return [
    { name: 'manifest.json', data: JSON.stringify(manifest) },
    { name: 'index.js', data: 'globalThis.x = 1;' },
    { name: 'icon.png', data: fakeIcon() },
  ];
}
