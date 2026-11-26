import { type GltfJson } from "./gltf.js";
import type { EngineProfile } from "./profiles.js";
import type { JsonValue, PackFacts, Vec3 } from "./types.js";
export interface GlbDocument {
    json: GltfJson;
    /** The binary chunk. Empty when the file has none. */
    bin: Uint8Array;
}
export type AccessorArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array;
/** Splits a GLB file into its JSON document and binary chunk. */
export declare function readGlb(glb: Uint8Array): GlbDocument;
/**
 * Reads one accessor into a typed array of its component type, all components in a row.
 * Handles byte offsets and interleaved views. Sparse accessors and external buffers are refused.
 */
export declare function readAccessor(document: GlbDocument, index: number): AccessorArray;
export interface PackMaterial {
    name: string;
    baseColorFactor: [number, number, number, number];
    metallicFactor: number;
    roughnessFactor: number;
}
/** One primitive of a body's mesh: the triangles that share a material. */
export interface PackSurface {
    material: PackMaterial | null;
    /** Where its vertices start in the body's `positions` and `normals`. */
    firstVertex: number;
    vertices: number;
    /** Where its triangles start in the body's `indices`. */
    firstTriangle: number;
    triangles: number;
}
export interface PackBody {
    /** Node name. */
    name: string;
    /** Node translation in metres. */
    translation: Vec3;
    /** x, y, z per vertex, relative to the node: every surface's vertices, one surface after another. */
    positions: Float32Array;
    /** One per vertex. Empty when a primitive of the mesh has none. */
    normals: Float32Array;
    /** Three vertex numbers per triangle, counted in `positions`: every surface's triangles, in the same order. */
    indices: Uint32Array;
    /** The material of the first surface. A body with several colours has one for each: see `surfaces`. */
    material: PackMaterial | null;
    /** One per primitive of the mesh, in the file's order. A body has one for each of its colours. */
    surfaces: PackSurface[];
}
export interface PackContents {
    generator: string | null;
    /** Null when the file was not written by this package. */
    profile: EngineProfile | null;
    facts: PackFacts | null;
    provenance: JsonValue | null;
    bodies: PackBody[];
}
/**
 * Reads a GLB written by this package back into plain arrays: one entry per mesh node of the
 * scene, with every primitive of its mesh, plus the facts, profile and provenance from the
 * scene extras.
 */
export declare function readPack(glb: Uint8Array | GlbDocument): PackContents;
