/**
 * A triangle is degenerate, and dropped, when two of its corners weld to one vertex or when its
 * three corners lie on one line: twice its area is under this fraction of its longest edge squared.
 */
export const DEGENERATE_AREA_RATIO = 1e-10;
/** Without face ids, triangles within this angle of each other count as one flat face. */
export const FLAT_FACE_ANGLE_DEGREES = 1;
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
export function tangentFor(nx, ny, nz, out, at) {
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    let tx;
    let ty;
    let tz;
    if (ax <= ay && ax <= az) {
        // X axis cross normal.
        tx = 0;
        ty = -nz;
        tz = ny;
    }
    else if (ay <= az) {
        // Y axis cross normal.
        tx = nz;
        ty = 0;
        tz = -nx;
    }
    else {
        // Z axis cross normal.
        tx = -ny;
        ty = nx;
        tz = 0;
    }
    const length = Math.hypot(tx, ty, tz);
    out[at] = tx / length + 0;
    out[at + 1] = ty / length + 0;
    out[at + 2] = tz / length + 0;
    out[at + 3] = 1;
}
function tableSize(entries) {
    let size = 16;
    while (size < entries * 2)
        size *= 2;
    return size;
}
function mix(a, b, c) {
    return (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77) ^ Math.imul(c, 0xc2b2ae3d)) | 0;
}
/**
 * Welds corners by position. Returns the welded vertex of every corner and the welded positions.
 * Two points weld when they are within `tolerance` of each other; a later point joins the
 * earliest vertex it matches, so the result does not depend on anything but the input order.
 */
function weld(points, indices, cornerCount, tolerance) {
    const cornerVertex = new Uint32Array(cornerCount);
    const welded = new Float64Array(cornerCount * 3);
    const sourceVertex = indices === undefined ? undefined : new Int32Array(points.length / 3).fill(-1);
    const size = tableSize(cornerCount);
    const mask = size - 1;
    const head = new Int32Array(size).fill(-1);
    const next = new Int32Array(cornerCount);
    const cell = tolerance > 0 ? tolerance * 2 : 0;
    const toleranceSquared = tolerance * tolerance;
    // With no tolerance, points weld only when exactly equal, so they are hashed by their bits.
    const bits = new Float64Array(3);
    const words = new Int32Array(bits.buffer);
    let count = 0;
    for (let corner = 0; corner < cornerCount; corner += 1) {
        const source = indices === undefined ? corner : indices[corner];
        if (sourceVertex !== undefined && sourceVertex[source] >= 0) {
            cornerVertex[corner] = sourceVertex[source];
            continue;
        }
        // `+ 0` makes negative zero equal to zero in the exact-match hash.
        const x = points[source * 3] + 0;
        const y = points[source * 3 + 1] + 0;
        const z = points[source * 3 + 2] + 0;
        let found = -1;
        let ownBucket;
        if (cell === 0) {
            bits[0] = x;
            bits[1] = y;
            bits[2] = z;
            ownBucket = mix(words[0] ^ words[1], words[2] ^ words[3], words[4] ^ words[5]) & mask;
            for (let v = head[ownBucket]; v >= 0; v = next[v]) {
                if (welded[v * 3] === x && welded[v * 3 + 1] === y && welded[v * 3 + 2] === z && (found < 0 || v < found))
                    found = v;
            }
        }
        else {
            ownBucket = mix(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)) & mask;
            const x0 = Math.floor((x - tolerance) / cell);
            const x1 = Math.floor((x + tolerance) / cell);
            const y0 = Math.floor((y - tolerance) / cell);
            const y1 = Math.floor((y + tolerance) / cell);
            const z0 = Math.floor((z - tolerance) / cell);
            const z1 = Math.floor((z + tolerance) / cell);
            // Each axis spans one or two cells. Counting steps, not cell numbers, keeps the loops
            // finite for coordinates too large to tell neighbouring cells apart.
            for (let ix = x1 > x0 ? 1 : 0; ix >= 0; ix -= 1) {
                for (let iy = y1 > y0 ? 1 : 0; iy >= 0; iy -= 1) {
                    for (let iz = z1 > z0 ? 1 : 0; iz >= 0; iz -= 1) {
                        for (let v = head[mix(x0 + ix, y0 + iy, z0 + iz) & mask]; v >= 0; v = next[v]) {
                            const dx = welded[v * 3] - x;
                            const dy = welded[v * 3 + 1] - y;
                            const dz = welded[v * 3 + 2] - z;
                            if (dx * dx + dy * dy + dz * dz <= toleranceSquared && (found < 0 || v < found))
                                found = v;
                        }
                    }
                }
            }
        }
        if (found < 0) {
            found = count;
            count += 1;
            welded[found * 3] = x;
            welded[found * 3 + 1] = y;
            welded[found * 3 + 2] = z;
            next[found] = head[ownBucket];
            head[ownBucket] = found;
        }
        cornerVertex[corner] = found;
        if (sourceVertex !== undefined)
            sourceVertex[source] = found;
    }
    return { cornerVertex, welded, count };
}
/** Edges of a triangle list, each with how many triangles use it and the first two that do. */
function buildEdges(triangleVertex, triangles) {
    const size = tableSize(triangles * 3);
    const mask = size - 1;
    const slot = new Int32Array(size).fill(-1);
    const low = new Uint32Array(triangles * 3);
    const high = new Uint32Array(triangles * 3);
    const uses = new Uint32Array(triangles * 3);
    const first = new Int32Array(triangles * 3);
    const second = new Int32Array(triangles * 3);
    let count = 0;
    for (let t = 0; t < triangles; t += 1) {
        for (let k = 0; k < 3; k += 1) {
            const a = triangleVertex[t * 3 + k];
            const b = triangleVertex[t * 3 + ((k + 1) % 3)];
            const lo = a < b ? a : b;
            const hi = a < b ? b : a;
            let at = mix(lo, hi, 0) & mask;
            while (slot[at] >= 0 && (low[slot[at]] !== lo || high[slot[at]] !== hi))
                at = (at + 1) & mask;
            let edge = slot[at];
            if (edge < 0) {
                edge = count;
                count += 1;
                slot[at] = edge;
                low[edge] = lo;
                high[edge] = hi;
                first[edge] = t;
            }
            else if (uses[edge] === 1) {
                second[edge] = t;
            }
            uses[edge] += 1;
        }
    }
    return { count, low, high, uses, first, second };
}
function find(parent, item) {
    let root = item;
    while (parent[root] !== root)
        root = parent[root];
    while (parent[item] !== root) {
        const up = parent[item];
        parent[item] = root;
        item = up;
    }
    return root;
}
/** Joins two sets. The smaller root number stays the root, which keeps results independent of visiting order. */
function union(parent, a, b) {
    const rootA = find(parent, a);
    const rootB = find(parent, b);
    if (rootA < rootB)
        parent[rootB] = rootA;
    else if (rootB < rootA)
        parent[rootA] = rootB;
}
function identity(length) {
    const parent = new Int32Array(length);
    for (let i = 0; i < length; i += 1)
        parent[i] = i;
    return parent;
}
function cornerOf(triangleVertex, triangle, vertex) {
    const at = triangle * 3;
    return triangleVertex[at] === vertex ? at : triangleVertex[at + 1] === vertex ? at + 1 : at + 2;
}
/**
 * Welds, drops degenerate triangles, counts open and non-manifold edges, splits vertices along
 * hard edges and computes vertex normals. Positions are already in glTF space.
 */
export function buildMesh(points, indices, faceIds, options) {
    const cornerCount = indices === undefined ? points.length / 3 : indices.length;
    const inputTriangles = cornerCount / 3;
    const { cornerVertex, welded } = weld(points, indices, cornerCount, options.weldTolerance);
    // Keep the triangles that have an area, with their unit normal and area.
    const triangleVertex = new Uint32Array(cornerCount);
    const faceNormal = new Float64Array(cornerCount);
    const area = new Float64Array(inputTriangles);
    const face = faceIds === undefined ? undefined : new Float64Array(inputTriangles);
    let triangles = 0;
    for (let t = 0; t < inputTriangles; t += 1) {
        const a = cornerVertex[t * 3];
        const b = cornerVertex[t * 3 + (options.reverseWinding ? 2 : 1)];
        const c = cornerVertex[t * 3 + (options.reverseWinding ? 1 : 2)];
        if (a === b || b === c || a === c)
            continue;
        const ux = welded[b * 3] - welded[a * 3];
        const uy = welded[b * 3 + 1] - welded[a * 3 + 1];
        const uz = welded[b * 3 + 2] - welded[a * 3 + 2];
        const vx = welded[c * 3] - welded[a * 3];
        const vy = welded[c * 3 + 1] - welded[a * 3 + 1];
        const vz = welded[c * 3 + 2] - welded[a * 3 + 2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const doubleArea = Math.hypot(nx, ny, nz);
        const longest = Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, (vx - ux) ** 2 + (vy - uy) ** 2 + (vz - uz) ** 2);
        if (!(doubleArea > DEGENERATE_AREA_RATIO * longest))
            continue;
        triangleVertex[triangles * 3] = a;
        triangleVertex[triangles * 3 + 1] = b;
        triangleVertex[triangles * 3 + 2] = c;
        faceNormal[triangles * 3] = nx / doubleArea;
        faceNormal[triangles * 3 + 1] = ny / doubleArea;
        faceNormal[triangles * 3 + 2] = nz / doubleArea;
        area[triangles] = doubleArea / 2;
        if (face !== undefined)
            face[triangles] = faceIds[t];
        triangles += 1;
    }
    const edges = buildEdges(triangleVertex, triangles);
    const creaseCos = Math.cos((options.creaseAngle * Math.PI) / 180);
    const flatCos = Math.cos((FLAT_FACE_ANGLE_DEGREES * Math.PI) / 180);
    const faceWeighted = options.normals === "face-weighted";
    // Corners joined across soft edges share one written vertex.
    const cornerGroup = identity(triangles * 3);
    // Without face ids, the flat faces are found by joining triangles that lie in one plane.
    const flatGroup = faceWeighted && face === undefined ? identity(triangles) : undefined;
    let openEdges = 0;
    let nonManifoldEdges = 0;
    for (let edge = 0; edge < edges.count; edge += 1) {
        const uses = edges.uses[edge];
        if (uses === 1)
            openEdges += 1;
        if (uses > 2)
            nonManifoldEdges += 1;
        if (uses !== 2)
            continue;
        const t1 = edges.first[edge];
        const t2 = edges.second[edge];
        const dot = faceNormal[t1 * 3] * faceNormal[t2 * 3] +
            faceNormal[t1 * 3 + 1] * faceNormal[t2 * 3 + 1] +
            faceNormal[t1 * 3 + 2] * faceNormal[t2 * 3 + 2];
        if (flatGroup !== undefined && dot >= flatCos)
            union(flatGroup, t1, t2);
        const soft = (face !== undefined && face[t1] === face[t2]) || dot >= creaseCos;
        if (!soft)
            continue;
        const lo = edges.low[edge];
        const hi = edges.high[edge];
        union(cornerGroup, cornerOf(triangleVertex, t1, lo), cornerOf(triangleVertex, t2, lo));
        union(cornerGroup, cornerOf(triangleVertex, t1, hi), cornerOf(triangleVertex, t2, hi));
    }
    // Area of the whole face each triangle belongs to, for face-weighted normals.
    let faceArea;
    if (faceWeighted) {
        faceArea = new Float64Array(triangles);
        if (face !== undefined) {
            const areaOfFace = new Map();
            for (let t = 0; t < triangles; t += 1)
                areaOfFace.set(face[t], (areaOfFace.get(face[t]) ?? 0) + area[t]);
            for (let t = 0; t < triangles; t += 1)
                faceArea[t] = areaOfFace.get(face[t]);
        }
        else {
            const areaOfRoot = new Float64Array(triangles);
            for (let t = 0; t < triangles; t += 1)
                areaOfRoot[find(flatGroup, t)] += area[t];
            for (let t = 0; t < triangles; t += 1)
                faceArea[t] = areaOfRoot[find(flatGroup, t)];
        }
    }
    // Number the written vertices in the order corners first reach them, and sum weighted normals.
    const vertexOfGroup = new Int32Array(triangles * 3).fill(-1);
    const outIndices = new Uint32Array(triangles * 3);
    const weldedOfVertex = new Uint32Array(triangles * 3);
    const firstTriangle = new Uint32Array(triangles * 3);
    const sum = new Float64Array(triangles * 9);
    let vertices = 0;
    for (let t = 0; t < triangles; t += 1) {
        for (let k = 0; k < 3; k += 1) {
            const corner = t * 3 + k;
            const group = find(cornerGroup, corner);
            let vertex = vertexOfGroup[group];
            const at = triangleVertex[corner];
            if (vertex < 0) {
                vertex = vertices;
                vertices += 1;
                vertexOfGroup[group] = vertex;
                weldedOfVertex[vertex] = at;
                firstTriangle[vertex] = t;
            }
            outIndices[corner] = vertex;
            const to = triangleVertex[t * 3 + ((k + 1) % 3)];
            const from = triangleVertex[t * 3 + ((k + 2) % 3)];
            const ux = welded[to * 3] - welded[at * 3];
            const uy = welded[to * 3 + 1] - welded[at * 3 + 1];
            const uz = welded[to * 3 + 2] - welded[at * 3 + 2];
            const vx = welded[from * 3] - welded[at * 3];
            const vy = welded[from * 3 + 1] - welded[at * 3 + 1];
            const vz = welded[from * 3 + 2] - welded[at * 3 + 2];
            const angle = Math.atan2(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx), ux * vx + uy * vy + uz * vz);
            const weight = angle * (faceArea === undefined ? area[t] : faceArea[t]);
            sum[vertex * 3] += faceNormal[t * 3] * weight;
            sum[vertex * 3 + 1] += faceNormal[t * 3 + 1] * weight;
            sum[vertex * 3 + 2] += faceNormal[t * 3 + 2] * weight;
        }
    }
    const positions = new Float64Array(vertices * 3);
    const normals = new Float32Array(vertices * 3);
    const tangents = new Float32Array(vertices * 4);
    for (let vertex = 0; vertex < vertices; vertex += 1) {
        const at = weldedOfVertex[vertex] * 3;
        positions[vertex * 3] = welded[at];
        positions[vertex * 3 + 1] = welded[at + 1];
        positions[vertex * 3 + 2] = welded[at + 2];
        let nx = sum[vertex * 3];
        let ny = sum[vertex * 3 + 1];
        let nz = sum[vertex * 3 + 2];
        let length = Math.hypot(nx, ny, nz);
        if (!(length > 0)) {
            // Faces that cancel out leave no direction; fall back to the first triangle's own normal.
            const t = firstTriangle[vertex] * 3;
            nx = faceNormal[t];
            ny = faceNormal[t + 1];
            nz = faceNormal[t + 2];
            length = 1;
        }
        normals[vertex * 3] = nx / length;
        normals[vertex * 3 + 1] = ny / length;
        normals[vertex * 3 + 2] = nz / length;
        tangentFor(nx / length, ny / length, nz / length, tangents, vertex * 4);
    }
    return {
        positions,
        normals,
        tangents,
        indices: outIndices,
        vertices,
        triangles,
        degenerateTrianglesDropped: inputTriangles - triangles,
        openEdges,
        nonManifoldEdges,
    };
}
