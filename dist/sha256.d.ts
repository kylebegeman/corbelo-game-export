/**
 * SHA-256 of some bytes, as 64 small hexadecimal digits. Written here so a pack can be made in
 * a browser and on a server by the same code, without waiting on anything.
 */
export declare function sha256Hex(data: Uint8Array): string;
