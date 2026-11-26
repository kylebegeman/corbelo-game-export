import type { NormalMode } from "./types.js";
/**
 * A triangle is degenerate, and dropped, when two of its corners weld to one vertex or when its
 * three corners lie on one line: twice its area is under this fraction of its longest edge squared.
 */
export declare const DEGENERATE_AREA_RATIO = 1e-10;
/** Without face ids, triangles within this angle of each other count as one flat face. */
export declare const FLAT_FACE_ANGLE_DEGREES = 1;
export interface MeshOptions {
    /** Reverse triangle winding, for a conversion that mirrored the positions. */
    reverseWinding: boolean;
    /** Metres. */
    weldTolerance: number;
    creaseAngle: number;
    normals: NormalMode;
}
export interface BuiltMesh {
    /** x, y, z per written vertex, before the pivot is taken off. */
    positions: Float64Array;
    /** Unit normal per written vertex. */
    normals: Float32Array;
    /** Three written-vertex numbers per kept triangle. */
    indices: Uint32Array;
    vertices: number;
    triangles: number;
    degenerateTrianglesDropped: number;
    openEdges: number;
    nonManifoldEdges: number;
}
/**
 * Welds, drops degenerate triangles, counts open and non-manifold edges, splits vertices along
 * hard edges and computes vertex normals. Positions are already in glTF space.
 */
export declare function buildMesh(points: Float64Array, indices: ArrayLike<number> | undefined, faceIds: ArrayLike<number> | undefined, options: MeshOptions): BuiltMesh;
