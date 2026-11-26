import { type GltfBufferView, type GltfJson } from "./gltf.js";
/** Collects typed arrays into one binary buffer, each starting on a four-byte boundary. */
export declare class BinaryBuilder {
    readonly views: GltfBufferView[];
    private readonly parts;
    private length;
    /** Adds the bytes of `data` and returns the index of its buffer view. */
    add(data: Float32Array | Uint16Array | Uint32Array, target: number): number;
    finish(): Uint8Array;
}
/** Packs a glTF document and its binary buffer into one GLB file. */
export declare function encodeGlb(json: GltfJson, bin: Uint8Array): Uint8Array;
