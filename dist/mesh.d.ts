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
/**
 * A corner of a mesh must lie this near the surface it is said to lie in: this share of the
 * longest edge of the surface's triangle it is found in, or twice the weld tolerance where that
 * is more.
 */
export declare const REFINEMENT_REACH = 0.001;
/** The surfaces a mesh is a finer cut of, already built, and where each of its triangles lies in them. */
export interface CoarseSurfaces {
    /** Each surface as `buildMesh` made it. */
    meshes: readonly BuiltMesh[];
    /** For each surface, the kept triangle each of its input triangles became, or -1 where it was dropped. */
    keptOf: readonly Int32Array[];
    /** The surface each input triangle of the fine mesh lies in. Undefined when there is one surface. */
    surfaceOf: ArrayLike<number> | undefined;
    /** An input triangle of that surface each input triangle of the fine mesh lies in, or in part. */
    triangleOf: ArrayLike<number>;
    /** Starts the message of a refusal: the body. */
    where: string;
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
    /** The input triangle each kept triangle is. */
    sourceTriangle: Uint32Array;
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
 *
 * With `coarse` the mesh is a finer cut of surfaces that were built before, and its shading is
 * theirs. Every corner of every triangle is found on its surface: the surface's triangle it lies
 * in, and its share of each of that triangle's written vertices. A corner takes the normal the
 * surface has there, which is the normals of those vertices mixed by their shares. Two corners at
 * one point become one written vertex where they are found on the same written vertices of the
 * surface, which is where the surface is shaded smoothly, and stay two where they are not, which
 * is along the surface's hard edges and between two surfaces. Face ids, the crease angle and the
 * normal mode then act on the surfaces only.
 */
export declare function buildMesh(points: Float64Array, indices: ArrayLike<number> | undefined, faceIds: ArrayLike<number> | undefined, options: MeshOptions, coarse?: CoarseSurfaces): BuiltMesh;
/** The triangles of a mesh that go into one primitive, with vertices of their own. */
export interface MeshPart {
    /** The group every triangle of this part is in. */
    group: number;
    /** The mesh's written vertex behind each vertex of the part. Undefined when the part is the whole mesh. */
    vertexOf: Uint32Array | undefined;
    /** Three part-vertex numbers per triangle. */
    indices: Uint32Array;
    vertices: number;
    triangles: number;
}
/**
 * Divides a built mesh into one part per group of triangles. `groupOfTriangle` names the group
 * of every input triangle; without it the whole mesh is one part in `onlyGroup`.
 *
 * Parts come in the order their first kept triangle comes. Inside a part the triangles keep
 * their order and the vertices are numbered as the triangles first reach them, which is how the
 * mesh itself is numbered, so a mesh in one group is one part that is the mesh unchanged.
 *
 * Normals were worked out on the whole mesh before this, so a vertex on the border between two
 * parts goes into both with the same position, normal and tangent.
 */
export declare function splitMesh(mesh: BuiltMesh, groupOfTriangle: ArrayLike<number> | undefined, onlyGroup: number): MeshPart[];
