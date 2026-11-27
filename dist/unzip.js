import { refuse } from "./errors.js";
import { crc32 } from "./zip.js";
const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
const FLAG_ENCRYPTED = 0x0001;
/**
 * Reads the files out of a ZIP archive. Folders are left out, files keep the order of the
 * archive's directory, and every file is checked against the CRC-32 the archive holds for it.
 *
 * Refused as `BAD_ZIP`: what is not a ZIP, an archive in parts or with the 64-bit extension,
 * an encrypted file, a way of packing other than stored and deflate, a name that would leave
 * the folder it is unpacked into, two files of one name, and a file whose bytes are not the
 * ones the archive says.
 */
export function readZip(archive, options = {}) {
    if (!(archive instanceof Uint8Array))
        refuse("BAD_ZIP", "readZip needs the archive as a Uint8Array.");
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    // The end record is the last thing in the file, before a comment of at most 65,535 bytes.
    let end = -1;
    for (let at = archive.length - 22; at >= 0 && at >= archive.length - 22 - 0xffff; at -= 1) {
        if (view.getUint32(at, true) === END && at + 22 + view.getUint16(at + 20, true) === archive.length) {
            end = at;
            break;
        }
    }
    if (end < 0)
        refuse("BAD_ZIP", "This is not a ZIP archive: it has no end record.");
    const count = view.getUint16(end + 10, true);
    const size = view.getUint32(end + 12, true);
    const directory = view.getUint32(end + 16, true);
    if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 || view.getUint16(end + 8, true) !== count)
        refuse("BAD_ZIP", "The archive is one part of several. Give it as one file.");
    if (count === 0xffff || size === 0xffffffff || directory === 0xffffffff)
        refuse("BAD_ZIP", "The archive uses the 64-bit extension, which is not read here.");
    if (directory + size > end)
        refuse("BAD_ZIP", "The archive's directory runs past its end.");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const entries = [];
    const seen = new Set();
    let at = directory;
    for (let index = 0; index < count; index += 1) {
        if (at + 46 > end || view.getUint32(at, true) !== CENTRAL)
            refuse("BAD_ZIP", `Entry ${index} of the archive's directory is not where the archive says.`);
        const flags = view.getUint16(at + 8, true);
        const method = view.getUint16(at + 10, true);
        const sum = view.getUint32(at + 16, true);
        const packed = view.getUint32(at + 20, true);
        const bytes = view.getUint32(at + 24, true);
        const nameLength = view.getUint16(at + 28, true);
        const next = at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
        const local = view.getUint32(at + 42, true);
        if (next > end)
            refuse("BAD_ZIP", `Entry ${index} of the archive's directory runs past its end.`);
        let name;
        try {
            name = decoder.decode(archive.subarray(at + 46, at + 46 + nameLength));
        }
        catch {
            return refuse("BAD_ZIP", `The name of entry ${index} of the archive is not UTF-8.`);
        }
        at = next;
        // A folder: a name that ends in "/" and holds nothing.
        if (name.endsWith("/") && bytes === 0)
            continue;
        const parts = name.split("/");
        if (name === "" || name.includes("\\") || name.includes(":") || /[\u0000-\u001f]/.test(name) || parts.some((part) => part === "" || part === "." || part === "..")) {
            refuse("BAD_ZIP", `The archive holds a file named ${JSON.stringify(name)}, which is not a path that stays in the folder it is unpacked into.`);
        }
        if (seen.has(name.toLowerCase()))
            refuse("BAD_ZIP", `The archive holds two files named "${name}".`);
        seen.add(name.toLowerCase());
        if ((flags & FLAG_ENCRYPTED) !== 0)
            refuse("BAD_ZIP", `"${name}" is encrypted, which is not read here.`);
        if (packed === 0xffffffff || bytes === 0xffffffff || local === 0xffffffff)
            refuse("BAD_ZIP", `"${name}" uses the 64-bit extension, which is not read here.`);
        if (local + 30 > directory || view.getUint32(local, true) !== LOCAL)
            refuse("BAD_ZIP", `"${name}" is not where the archive's directory says.`);
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        if (start + packed > directory)
            refuse("BAD_ZIP", `"${name}" runs past the end of the archive's files.`);
        const data = archive.subarray(start, start + packed);
        let content;
        if (method === STORED) {
            if (packed !== bytes)
                refuse("BAD_ZIP", `"${name}" is stored, and the archive gives it two sizes.`);
            content = data.slice();
        }
        else if (method === DEFLATED) {
            if (options.inflate === undefined)
                refuse("BAD_ZIP", `"${name}" is compressed, and no inflate function was given to unpack it.`);
            try {
                content = options.inflate(data, bytes);
            }
            catch (error) {
                return refuse("BAD_ZIP", `"${name}" could not be unpacked: ${error.message}`);
            }
            if (!(content instanceof Uint8Array) || content.length !== bytes)
                refuse("BAD_ZIP", `"${name}" unpacked to another size than the archive says.`);
        }
        else {
            return refuse("BAD_ZIP", `"${name}" is packed in a way that is not read here (method ${method}). Stored and deflate are.`);
        }
        if (crc32(content) !== sum)
            refuse("BAD_ZIP", `"${name}" is damaged: its bytes do not match the checksum the archive holds for it.`);
        entries.push({ name, bytes: content });
    }
    return entries;
}
