import { refuse } from "./errors.js";

/** One file of an archive. */
export interface ZipEntry {
  /** The path inside the archive, with `/` between folders. */
  name: string;
  bytes: Uint8Array;
}

/** The most a ZIP without the 64-bit extension holds: this many files, and this many bytes in all. */
export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_BYTES = 0xffffffff;

/** Every file is dated 1 January 1980, the first day a ZIP can say, so the same files give the same archive. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
/** Names are UTF-8. */
const FLAG_UTF8 = 0x0800;
const VERSION_NEEDED = 20;

let table: Uint32Array | undefined;

/** CRC-32 as ZIP, gzip and PNG use it. */
export function crc32(data: Uint8Array): number {
  if (table === undefined) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[n] = value;
    }
  }
  let crc = 0xffffffff;
  for (let at = 0; at < data.length; at += 1) crc = table[(crc ^ data[at]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Writes files into one ZIP archive. Files are stored as they are, not compressed: a GLB is
 * mostly numbers that compress little, and storing needs no compressor. Files keep the order
 * they are given in, and the same files always give the same bytes.
 */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  if (!Array.isArray(entries)) refuse("BAD_PACK", "writeZip needs a list of { name, bytes }.");
  if (entries.length > ZIP_MAX_ENTRIES) refuse("BAD_PACK", `A ZIP holds at most ${ZIP_MAX_ENTRIES} files. Got ${entries.length}.`);
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  const names = entries.map((entry, at) => {
    if (typeof entry !== "object" || entry === null || typeof entry.name !== "string" || !(entry.bytes instanceof Uint8Array)) {
      refuse("BAD_PACK", `File ${at} of the archive must be { name, bytes } with bytes as a Uint8Array.`);
    }
    const parts = entry.name.split("/");
    if (entry.name === "" || entry.name.includes("\\") || /[\u0000-\u001f]/.test(entry.name) || parts.some((part: string) => part === "" || part === "." || part === "..")) {
      refuse("BAD_PACK", `"${entry.name}" is not a path a ZIP can hold safely: use names with "/" between folders, and no "..", "." or empty part.`);
    }
    if (seen.has(entry.name.toLowerCase())) refuse("BAD_PACK", `Two files of the archive are named "${entry.name}".`);
    seen.add(entry.name.toLowerCase());
    const name = encoder.encode(entry.name);
    if (name.length > 0xffff) refuse("BAD_PACK", `The file name "${entry.name.slice(0, 40)}..." is too long for a ZIP.`);
    return name;
  });
  let size = 22;
  for (const [at, entry] of entries.entries()) size += 30 + 46 + names[at]!.length * 2 + entry.bytes.length;
  if (size > ZIP_MAX_BYTES) refuse("BAD_PACK", `The archive would be ${size} bytes, more than the ${ZIP_MAX_BYTES} a ZIP without the 64-bit extension holds.`);

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  const sums: number[] = [];
  let at = 0;
  for (const [index, entry] of entries.entries()) {
    const name = names[index]!;
    const sum = crc32(entry.bytes);
    offsets.push(at);
    sums.push(sum);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, VERSION_NEEDED, true);
    view.setUint16(at + 6, FLAG_UTF8, true);
    view.setUint16(at + 8, 0, true);
    view.setUint16(at + 10, DOS_TIME, true);
    view.setUint16(at + 12, DOS_DATE, true);
    view.setUint32(at + 14, sum, true);
    view.setUint32(at + 18, entry.bytes.length, true);
    view.setUint32(at + 22, entry.bytes.length, true);
    view.setUint16(at + 26, name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(name, at + 30);
    out.set(entry.bytes, at + 30 + name.length);
    at += 30 + name.length + entry.bytes.length;
  }
  const directory = at;
  for (const [index, entry] of entries.entries()) {
    const name = names[index]!;
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, VERSION_NEEDED, true);
    view.setUint16(at + 6, VERSION_NEEDED, true);
    view.setUint16(at + 8, FLAG_UTF8, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, DOS_TIME, true);
    view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, sums[index]!, true);
    view.setUint32(at + 20, entry.bytes.length, true);
    view.setUint32(at + 24, entry.bytes.length, true);
    view.setUint16(at + 28, name.length, true);
    // No extra field, no comment, disk 0, no attributes.
    view.setUint32(at + 42, offsets[index]!, true);
    out.set(name, at + 46);
    at += 46 + name.length;
  }
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - directory, true);
  view.setUint32(at + 16, directory, true);
  return out;
}
