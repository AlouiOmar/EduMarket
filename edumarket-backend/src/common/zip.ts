import zlib from 'node:zlib';

/**
 * Minimal ZIP support (no dependency), used by XLSX exports, course packages and SCORM imports.
 *
 * Writer: deflate entries, no ZIP64 (archives stay well below 4 GiB). Reader: central-directory based, with hard limits against
 * zip bombs and unsafe paths (absolute paths, `..`, backslashes, drive letters), encrypted entries refused, CRC and size checked.
 */
export interface ZipEntryInput { name: string; data: Buffer | string }

const DOS_EPOCH = (date = new Date()) => {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
};

export function createZip(entries: ZipEntryInput[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  const { time, day } = DOS_EPOCH();
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const compressed = zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(day, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12); central.writeUInt16LE(day, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export interface ZipLimits { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number }
export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 2000, maxEntryBytes: 50 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024 };
export class ZipError extends Error { constructor(public code: string) { super(code); } }

/** Normalized safe relative path, or null when the name is unsafe. Directory entries end with '/'. */
export function safeZipPath(name: string) {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return null;
  const parts = name.split('/');
  if (parts.some((part, index) => part === '..' || part === '.' || (part === '' && index !== parts.length - 1))) return null;
  return name;
}

export interface ZipEntry { path: string; size: number; data: Buffer }

/** Reads every file entry (directories skipped). Throws ZipError on any inconsistency or limit breach. */
export function readZip(buffer: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  const minEnd = Math.max(0, buffer.length - 22 - 0xffff);
  let endOffset = -1;
  for (let index = buffer.length - 22; index >= minEnd; index -= 1) if (buffer.readUInt32LE(index) === 0x06054b50) { endOffset = index; break; }
  if (endOffset < 0) throw new ZipError('ZIP_INVALID');
  const count = buffer.readUInt16LE(endOffset + 10);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (count === 0xffff || centralOffset === 0xffffffff) throw new ZipError('ZIP64_UNSUPPORTED');
  if (count > limits.maxEntries) throw new ZipError('ZIP_TOO_MANY_ENTRIES');
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let total = 0, cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new ZipError('ZIP_INVALID');
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10), crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20), size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const rawName = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString(flags & 0x0800 ? 'utf8' : 'latin1');
    cursor += 46 + nameLength + extraLength + commentLength;
    if (flags & 0x0001) throw new ZipError('ZIP_ENCRYPTED');
    const path = safeZipPath(rawName);
    if (!path) throw new ZipError('ZIP_UNSAFE_PATH');
    if (path.endsWith('/')) continue;
    if (seen.has(path.toLowerCase())) throw new ZipError('ZIP_DUPLICATE_ENTRY');
    seen.add(path.toLowerCase());
    if (size > limits.maxEntryBytes) throw new ZipError('ZIP_ENTRY_TOO_LARGE');
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipError('ZIP_TOO_LARGE');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new ZipError('ZIP_INVALID');
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (compressed.length !== compressedSize) throw new ZipError('ZIP_INVALID');
    let data: Buffer;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) {
      try { data = zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(size, 1) }); } catch { throw new ZipError('ZIP_INVALID'); }
    } else throw new ZipError('ZIP_UNSUPPORTED_METHOD');
    if (data.length !== size || zlib.crc32(data) !== crc) throw new ZipError('ZIP_CORRUPTED');
    entries.push({ path, size, data });
  }
  return entries;
}
