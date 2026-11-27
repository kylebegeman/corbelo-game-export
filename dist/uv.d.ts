import { type BuiltMesh } from "./mesh.js";
import type { Vec3 } from "./types.js";
/** The side of one whole texture in the world, in metres, when none is given. */
export declare const DEFAULT_TILE_METERS = 1;
/**
 * Texture coordinates by box projection at world scale. Each triangle is projected along the
 * axis its own face leans on most, from where it sits in the scene, and one whole texture
 * covers `tileMeters` by `tileMeters`. A vertex used by triangles projected along different
 * axes becomes one vertex for each.
 *
 * Tangents follow the coordinates: each points the way u grows, at a right angle to the normal,
 * with w = 1.
 *
 * `offset` is added to a position of the mesh to get the place in the scene.
 */
export declare function boxProject(mesh: BuiltMesh, offset: Vec3, tileMeters: number): {
    mesh: BuiltMesh;
    uvs: Float32Array;
};
