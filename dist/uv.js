import { tangentFor } from "./mesh.js";
/** The side of one whole texture in the world, in metres, when none is given. */
export const DEFAULT_TILE_METERS = 1;
/**
 * For each side of the box, the axis that u runs along and its sign, then the same for v.
 * Sides are numbered +X, -X, +Y, -Y, +Z, -Z in glTF space (metres, +Y up).
 *
 * On the four upright sides, u runs to the right as the side is seen from outside and v runs
 * down, so a texture stands upright. On the top, u runs along +X and v along +Z. On the bottom,
 * u runs along +X and v along -Z. No side is a mirror image.
 */
const SIDES = [
    [2, -1, 1, -1],
    [2, 1, 1, -1],
    [0, 1, 2, 1],
    [0, 1, 2, -1],
    [0, 1, 1, -1],
    [0, -1, 1, -1],
];
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
export function boxProject(mesh, offset, tileMeters) {
    const { positions, indices, triangles } = mesh;
    const sideOf = new Uint8Array(triangles);
    for (let t = 0; t < triangles; t += 1) {
        const a = indices[t * 3] * 3;
        const b = indices[t * 3 + 1] * 3;
        const c = indices[t * 3 + 2] * 3;
        const abx = positions[b] - positions[a];
        const aby = positions[b + 1] - positions[a + 1];
        const abz = positions[b + 2] - positions[a + 2];
        const acx = positions[c] - positions[a];
        const acy = positions[c + 1] - positions[a + 1];
        const acz = positions[c + 2] - positions[a + 2];
        const n = [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
        // Y wins a tie, then X, so a face at exactly 45 degrees always goes the same way.
        let axis = 1;
        if (Math.abs(n[0]) > Math.abs(n[axis]))
            axis = 0;
        if (Math.abs(n[2]) > Math.abs(n[axis]))
            axis = 2;
        sideOf[t] = axis * 2 + (n[axis] < 0 ? 1 : 0);
    }
    // One written vertex per vertex and side, numbered as the triangles first reach them.
    const numberOf = new Map();
    const from = [];
    const sides = [];
    const outIndices = new Uint32Array(indices.length);
    for (let t = 0; t < triangles; t += 1) {
        for (let k = 0; k < 3; k += 1) {
            const vertex = indices[t * 3 + k];
            const key = vertex * 6 + sideOf[t];
            let number = numberOf.get(key);
            if (number === undefined) {
                number = from.length;
                numberOf.set(key, number);
                from.push(vertex);
                sides.push(sideOf[t]);
            }
            outIndices[t * 3 + k] = number;
        }
    }
    const vertices = from.length;
    const outPositions = new Float64Array(vertices * 3);
    const normals = new Float32Array(vertices * 3);
    const tangents = new Float32Array(vertices * 4);
    const uvs = new Float32Array(vertices * 2);
    for (let vertex = 0; vertex < vertices; vertex += 1) {
        const source = from[vertex] * 3;
        const [uAxis, uSign, vAxis, vSign] = SIDES[sides[vertex]];
        for (let axis = 0; axis < 3; axis += 1) {
            outPositions[vertex * 3 + axis] = positions[source + axis];
            normals[vertex * 3 + axis] = mesh.normals[source + axis];
        }
        uvs[vertex * 2] = ((positions[source + uAxis] + offset[uAxis]) * uSign) / tileMeters + 0;
        uvs[vertex * 2 + 1] = ((positions[source + vAxis] + offset[vAxis]) * vSign) / tileMeters + 0;
        // The direction u grows in, with the part along the normal taken off.
        const nx = normals[vertex * 3];
        const ny = normals[vertex * 3 + 1];
        const nz = normals[vertex * 3 + 2];
        const along = (uAxis === 0 ? nx : uAxis === 1 ? ny : nz) * uSign;
        const tx = (uAxis === 0 ? uSign : 0) - nx * along;
        const ty = (uAxis === 1 ? uSign : 0) - ny * along;
        const tz = (uAxis === 2 ? uSign : 0) - nz * along;
        const length = Math.hypot(tx, ty, tz);
        if (length > 1e-6) {
            tangents[vertex * 4] = tx / length + 0;
            tangents[vertex * 4 + 1] = ty / length + 0;
            tangents[vertex * 4 + 2] = tz / length + 0;
            tangents[vertex * 4 + 3] = 1;
        }
        else {
            // A normal that lies along u itself: any direction across it will do.
            tangentFor(nx, ny, nz, tangents, vertex * 4);
        }
    }
    return { mesh: { ...mesh, positions: outPositions, normals, tangents, indices: outIndices, vertices }, uvs };
}
