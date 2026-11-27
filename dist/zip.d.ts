/** One file of an archive. */
export interface ZipEntry {
    /** The path inside the archive, with `/` between folders. */
    name: string;
    bytes: Uint8Array;
}
/** The most a ZIP without the 64-bit extension holds: this many files, and this many bytes in all. */
export declare const ZIP_MAX_ENTRIES = 65535;
export declare const ZIP_MAX_BYTES = 4294967295;
/** CRC-32 as ZIP, gzip and PNG use it. */
export declare function crc32(data: Uint8Array): number;
/**
 * Writes files into one ZIP archive. Files are stored as they are, not compressed: a GLB is
 * mostly numbers that compress little, and storing needs no compressor. Files keep the order
 * they are given in, and the same files always give the same bytes.
 */
export declare function writeZip(entries: readonly ZipEntry[]): Uint8Array;
