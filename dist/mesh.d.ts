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
    /** x, y, z, w per written vertex: a unit vector at a right angle to the normal, and w = 1. */
    tangents: Float32Array;
    /** Three written-vertex numbers per kept triangle. */
    indices: Uint32Array;
    vertices: number;
    triangles: number;
    degenerateTrianglesDropped: number;
    openEdges: number;
    nonManifoldEdges: number;
}
/**
 * A unit vector at a right angle to a unit normal, the same for the same normal every time.
 *
 * It is the cross product of the normal with the coordinate axis the normal leans on least, so
 * the product always has length: at least 0.81 before it is made unit length.
 *
 * The bodies carry no texture coordinates, so no direction along the surface means more than any
 * other. The tangent is written because engines store one with every normal, and an engine left
 * to make one up can fail to: Godot 4 builds it from a fixed rule that has no length for normals
 * along (1, 1, -1) and its opposite, and then stores a wrong normal for those vertices.
 */
export declare function tangentFor(nx: number, ny: number, nz: number, out: Float32Array, at: number): void;
/**
 * Welds, drops degenerate triangles, counts open and non-manifold edges, splits vertices along
 * hard edges and computes vertex normals. Positions are already in glTF space.
 */
export declare function buildMesh(points: Float64Array, indices: ArrayLike<number> | undefined, faceIds: ArrayLike<number> | undefined, options: MeshOptions): BuiltMesh;
