import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { AppError } from '@matane-anime/shared';

/**
 * A small zip writer and reader for backups: stored and deflated entries only, no zip64, no encryption.
 * It uses node:zlib so the app needs no extra dependency. The reader is strict because it opens a file the
 * user picked: every size is checked against a limit before anything is inflated.
 */

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export interface ZipLimits {
  maxEntries: number;
  /** Largest uncompressed size allowed for the entry called `name`. */
  maxEntryBytes(name: string): number;
  maxTotalBytes: number;
}

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const END_SIZE = 22;
const MAX_COMMENT = 0xffff;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
// 2000-01-01 00:00 in DOS date/time, so the same input always gives the same bytes.
const DOS_TIME = 0;
const DOS_DATE = ((2000 - 1980) << 9) | (1 << 5) | 1;

function bad(message: string): AppError {
  return new AppError('invalid_input', `This is not a valid backup file: ${message}`);
}

export function writeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const packed = deflateRawSync(entry.data, { level: 6 });
    const deflated = packed.length < entry.data.length;
    const body = deflated ? packed : entry.data;
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(deflated ? 8 : 0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8_FLAG, 8);
    header.writeUInt16LE(deflated ? 8 : 0, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);

    parts.push(local, name, body);
    central.push(header, name);
    offset += local.length + name.length + body.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(END_SIZE);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBytes, end]);
}

export function readZip(bytes: Buffer, limits: ZipLimits): ZipEntry[] {
  let endAt = -1;
  for (let at = bytes.length - END_SIZE; at >= Math.max(0, bytes.length - END_SIZE - MAX_COMMENT); at--) {
    if (bytes.readUInt32LE(at) === END_SIGNATURE) {
      endAt = at;
      break;
    }
  }
  if (endAt < 0) throw bad('it is not a zip archive.');
  const count = bytes.readUInt16LE(endAt + 10);
  const centralSize = bytes.readUInt32LE(endAt + 12);
  const centralOffset = bytes.readUInt32LE(endAt + 16);
  if (
    bytes.readUInt16LE(endAt + 4) !== 0 ||
    bytes.readUInt16LE(endAt + 6) !== 0 ||
    count !== bytes.readUInt16LE(endAt + 8)
  ) {
    throw bad('split archives are not supported.');
  }
  if (count === 0xffff || centralOffset === 0xffffffff) throw bad('zip64 archives are not supported.');
  if (count > limits.maxEntries) throw bad('it holds too many files.');
  if (centralOffset + centralSize > endAt) throw bad('the archive is damaged.');

  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let total = 0;
  let at = centralOffset;
  for (let index = 0; index < count; index++) {
    if (at + 46 > endAt || bytes.readUInt32LE(at) !== CENTRAL_SIGNATURE) throw bad('the archive is damaged.');
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const checksum = bytes.readUInt32LE(at + 16);
    const packedSize = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localOffset = bytes.readUInt32LE(at + 42);
    if (at + 46 + nameLength > endAt) throw bad('the archive is damaged.');
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;
    if (seen.has(name)) throw bad(`"${name}" appears twice.`);
    seen.add(name);
    if (flags & ENCRYPTED_FLAG) throw bad('it is encrypted.');
    if (method !== 0 && method !== 8) throw bad('it uses an unsupported compression.');
    if (packedSize === 0xffffffff || size === 0xffffffff) throw bad('zip64 archives are not supported.');
    if (size > limits.maxEntryBytes(name)) throw bad(`"${name}" is too large.`);
    total += size;
    if (total > limits.maxTotalBytes) throw bad('it is too large once unpacked.');

    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw bad('the archive is damaged.');
    }
    const start = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    if (start + packedSize > centralOffset) throw bad('the archive is damaged.');
    const body = bytes.subarray(start, start + packedSize);
    let data: Buffer;
    try {
      data = method === 0 ? Buffer.from(body) : inflateRawSync(body, { maxOutputLength: Math.max(size, 1) });
    } catch {
      throw bad(`"${name}" cannot be unpacked.`);
    }
    if (data.length !== size || crc32(data) !== checksum) throw bad(`"${name}" is damaged.`);
    entries.push({ name, data });
  }
  return entries;
}
