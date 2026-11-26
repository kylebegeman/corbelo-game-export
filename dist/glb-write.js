import { GLB_CHUNK_BIN, GLB_CHUNK_JSON, GLB_MAGIC } from "./gltf.js";
function padded(length) {
    return (length + 3) & ~3;
}
/** Collects typed arrays into one binary buffer, each starting on a four-byte boundary. */
export class BinaryBuilder {
    views = [];
    parts = [];
    length = 0;
    /** Adds the bytes of `data` and returns the index of its buffer view. */
    add(data, target) {
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        this.views.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.length, target });
        this.parts.push(bytes);
        this.length += padded(bytes.length);
        return this.views.length - 1;
    }
    finish() {
        const out = new Uint8Array(this.length);
        let at = 0;
        for (const part of this.parts) {
            out.set(part, at);
            at += padded(part.length);
        }
        return out;
    }
}
/** Packs a glTF document and its binary buffer into one GLB file. */
export function encodeGlb(json, bin) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const jsonLength = padded(jsonBytes.length);
    const binLength = padded(bin.length);
    const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
    const view = new DataView(out.buffer);
    view.setUint32(0, GLB_MAGIC, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, out.length, true);
    view.setUint32(12, jsonLength, true);
    view.setUint32(16, GLB_CHUNK_JSON, true);
    out.fill(0x20, 20, 20 + jsonLength);
    out.set(jsonBytes, 20);
    view.setUint32(20 + jsonLength, binLength, true);
    view.setUint32(24 + jsonLength, GLB_CHUNK_BIN, true);
    out.set(bin, 28 + jsonLength);
    return out;
}
