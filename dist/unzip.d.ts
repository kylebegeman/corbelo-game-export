import { type ZipEntry } from "./zip.js";
export interface ReadZipOptions {
    /**
     * Unpacks one deflated file: the raw deflate stream in, the file out. Without it only stored
     * files can be read, which is what `packToZip` writes. In Node this is `inflateRawSync` of
     * `node:zlib`.
     */
    inflate?: (data: Uint8Array, bytes: number) => Uint8Array;
}
/**
 * Reads the files out of a ZIP archive. Folders are left out, files keep the order of the
 * archive's directory, and every file is checked against the CRC-32 the archive holds for it.
 *
 * Refused as `BAD_ZIP`: what is not a ZIP, an archive in parts or with the 64-bit extension,
 * an encrypted file, a way of packing other than stored and deflate, a name that would leave
 * the folder it is unpacked into, two files of one name, and a file whose bytes are not the
 * ones the archive says.
 */
export declare function readZip(archive: Uint8Array, options?: ReadZipOptions): ZipEntry[];
