/**
 * A point counts as on a face, not outside it, within this share of the diagonal of the box
 * around the points. Points read from 32-bit floats sit this far off a plane they were meant
 * to be on.
 */
export const HULL_FLATNESS = 1e-7;
function attempt(points, maxVertices, tolerance) {
    const count = points.length / 3;
    const px = (p) => points[p * 3];
    const py = (p) => points[p * 3 + 1];
    const pz = (p) => points[p * 3 + 2];
    // The first four corners: the two points furthest apart among those at the ends of the
    // axes, the point furthest from the line through them, and the point furthest from the plane.
    const ends = [];
    for (let axis = 0; axis < 3; axis += 1) {
        let low = 0;
        let high = 0;
        for (let p = 1; p < count; p += 1) {
            if (points[p * 3 + axis] < points[low * 3 + axis])
                low = p;
            if (points[p * 3 + axis] > points[high * 3 + axis])
                high = p;
        }
        ends.push(low, high);
    }
    let p0 = 0;
    let p1 = 0;
    let best = 0;
    for (const a of ends) {
        for (const b of ends) {
            const distance = Math.hypot(px(a) - px(b), py(a) - py(b), pz(a) - pz(b));
            if (distance > best) {
                best = distance;
                p0 = a;
                p1 = b;
            }
        }
    }
    if (!(best > tolerance))
        return null;
    const ux = (px(p1) - px(p0)) / best;
    const uy = (py(p1) - py(p0)) / best;
    const uz = (pz(p1) - pz(p0)) / best;
    let p2 = -1;
    best = tolerance;
    for (let p = 0; p < count; p += 1) {
        const x = px(p) - px(p0);
        const y = py(p) - py(p0);
        const z = pz(p) - pz(p0);
        const along = x * ux + y * uy + z * uz;
        const distance = Math.hypot(x - along * ux, y - along * uy, z - along * uz);
        if (distance > best) {
            best = distance;
            p2 = p;
        }
    }
    if (p2 < 0)
        return null;
    const faces = [];
    const plane = (a, b, c) => {
        const abx = px(b) - px(a);
        const aby = py(b) - py(a);
        const abz = pz(b) - pz(a);
        const acx = px(c) - px(a);
        const acy = py(c) - py(a);
        const acz = pz(c) - pz(a);
        let nx = aby * acz - abz * acy;
        let ny = abz * acx - abx * acz;
        let nz = abx * acy - aby * acx;
        const length = Math.hypot(nx, ny, nz);
        if (!(length > 0))
            return null;
        nx /= length;
        ny /= length;
        nz /= length;
        return { v: [a, b, c], near: [-1, -1, -1], nx, ny, nz, d: nx * px(a) + ny * py(a) + nz * pz(a), outside: [], far: -1, farDistance: 0, alive: true };
    };
    const above = (face, p) => face.nx * px(p) + face.ny * py(p) + face.nz * pz(p) - face.d;
    const base = plane(p0, p1, p2);
    if (base === null)
        return null;
    let p3 = -1;
    best = tolerance;
    for (let p = 0; p < count; p += 1) {
        const distance = Math.abs(above(base, p));
        if (distance > best) {
            best = distance;
            p3 = p;
        }
    }
    if (p3 < 0)
        return null;
    // Four faces, each wound to face away from the corner it does not use.
    const corners = above(base, p3) > 0 ? [p0, p2, p1, p3] : [p0, p1, p2, p3];
    const [a, b, c, d] = corners;
    const first = [plane(a, b, c), plane(a, d, b), plane(b, d, c), plane(c, d, a)];
    if (first.some((face) => face === null))
        return null;
    faces.push(...first);
    const link = (face) => {
        // Finds the face across each edge among the faces that are alive, by its two corners.
        for (let k = 0; k < 3; k += 1) {
            const from = faces[face].v[k];
            const to = faces[face].v[(k + 1) % 3];
            for (let other = 0; other < faces.length; other += 1) {
                if (other === face || !faces[other].alive)
                    continue;
                const at = faces[other].v.indexOf(to);
                if (at >= 0 && faces[other].v[(at + 1) % 3] === from)
                    faces[face].near[k] = other;
            }
        }
    };
    for (let face = 0; face < 4; face += 1)
        link(face);
    /** Puts a point with the face it is furthest outside of, among the faces listed. */
    const assign = (p, among) => {
        let chosen = -1;
        let distance = tolerance;
        for (const face of among) {
            const here = above(faces[face], p);
            if (here > distance) {
                distance = here;
                chosen = face;
            }
        }
        if (chosen < 0)
            return;
        const face = faces[chosen];
        face.outside.push(p);
        if (distance > face.farDistance) {
            face.farDistance = distance;
            face.far = p;
        }
    };
    const start = [0, 1, 2, 3];
    for (let p = 0; p < count; p += 1) {
        if (p !== a && p !== b && p !== c && p !== d)
            assign(p, start);
    }
    let vertices = 4;
    let capped = false;
    for (;;) {
        // The point furthest outside the hull so far goes in next, so a hull that is stopped early
        // is the best one with that many corners this order can give.
        let from = -1;
        let distance = 0;
        for (let face = 0; face < faces.length; face += 1) {
            const candidate = faces[face];
            if (candidate.alive && candidate.far >= 0 && candidate.farDistance > distance) {
                distance = candidate.farDistance;
                from = face;
            }
        }
        if (from < 0)
            break;
        if (vertices >= maxVertices) {
            capped = true;
            break;
        }
        const eye = faces[from].far;
        // The faces the point can see, found from the one it is outside of. A face the point lies
        // level with counts as seen, so the faces left around the hole all look away from it.
        const seen = [from];
        const isSeen = new Set(seen);
        for (let at = 0; at < seen.length; at += 1) {
            for (const next of faces[seen[at]].near) {
                if (next < 0)
                    return "failed";
                if (isSeen.has(next))
                    continue;
                if (above(faces[next], eye) > -tolerance) {
                    isSeen.add(next);
                    seen.push(next);
                }
            }
        }
        // The edges around the hole, by the corner each starts at. Around a hole there is one each.
        const rim = new Map();
        let edges = 0;
        for (const face of seen) {
            const { v, near } = faces[face];
            for (let k = 0; k < 3; k += 1) {
                if (isSeen.has(near[k]))
                    continue;
                if (rim.has(v[k]))
                    return "failed";
                rim.set(v[k], { to: v[(k + 1) % 3], beyond: near[k] });
                edges += 1;
            }
        }
        if (edges < 3)
            return "failed";
        // A new face from each edge of the hole to the point, linked to the face beyond the edge
        // and to the new faces on either side.
        const made = [];
        const firstCorner = rim.keys().next().value;
        let corner = firstCorner;
        for (let step = 0; step < edges; step += 1) {
            const edge = rim.get(corner);
            if (edge === undefined)
                return "failed";
            const face = plane(corner, edge.to, eye);
            if (face === null)
                return "failed";
            face.near[0] = edge.beyond;
            const beyond = faces[edge.beyond];
            const at = beyond.v.indexOf(edge.to);
            if (at < 0 || beyond.v[(at + 1) % 3] !== corner)
                return "failed";
            beyond.near[at] = faces.length;
            made.push(faces.length);
            faces.push(face);
            corner = edge.to;
        }
        if (corner !== firstCorner)
            return "failed";
        for (let at = 0; at < made.length; at += 1) {
            const face = faces[made[at]];
            face.near[1] = made[(at + 1) % made.length];
            face.near[2] = made[(at + made.length - 1) % made.length];
        }
        for (const face of seen) {
            const gone = faces[face];
            gone.alive = false;
            for (const p of gone.outside) {
                if (p !== eye)
                    assign(p, made);
            }
            gone.outside = [];
            gone.far = -1;
        }
        vertices += 1;
    }
    // Check the result: every face alive and linked both ways, and every edge convex.
    const alive = faces.filter((face) => face.alive);
    for (const face of alive) {
        for (let k = 0; k < 3; k += 1) {
            const other = faces[face.near[k]];
            if (other === undefined || !other.alive)
                return "failed";
            const at = other.v.indexOf(face.v[(k + 1) % 3]);
            if (at < 0 || other.v[(at + 1) % 3] !== face.v[k] || faces[other.near[at]] !== face)
                return "failed";
            if (above(face, other.v[(at + 2) % 3]) > tolerance * 8)
                return "failed";
        }
    }
    // Corners are numbered as the faces first reach them, faces in the order they were made.
    const numberOf = new Map();
    const indices = new Uint32Array(alive.length * 3);
    for (const [at, face] of alive.entries()) {
        for (let k = 0; k < 3; k += 1) {
            const p = face.v[k];
            let number = numberOf.get(p);
            if (number === undefined) {
                number = numberOf.size;
                numberOf.set(p, number);
            }
            indices[at * 3 + k] = number;
        }
    }
    // A closed surface with no handles has two more corners and faces together than edges.
    if (numberOf.size - (alive.length * 3) / 2 + alive.length !== 2)
        return "failed";
    const positions = new Float64Array(numberOf.size * 3);
    for (const [p, number] of numberOf) {
        positions[number * 3] = px(p);
        positions[number * 3 + 1] = py(p);
        positions[number * 3 + 2] = pz(p);
    }
    const volume = meshVolume(positions, indices);
    if (!(volume > 0))
        return "failed";
    return { positions, indices, volume, capped };
}
/**
 * The volume a closed mesh encloses. Positive when its triangles face outwards. Measured from
 * the first vertex, so a mesh far from the origin loses no accuracy.
 */
export function meshVolume(positions, indices) {
    if (positions.length < 3)
        return 0;
    const ox = positions[0];
    const oy = positions[1];
    const oz = positions[2];
    let six = 0;
    for (let at = 0; at < indices.length; at += 3) {
        const a = indices[at] * 3;
        const b = indices[at + 1] * 3;
        const c = indices[at + 2] * 3;
        const ax = positions[a] - ox;
        const ay = positions[a + 1] - oy;
        const az = positions[a + 2] - oz;
        const bx = positions[b] - ox;
        const by = positions[b + 1] - oy;
        const bz = positions[b + 2] - oz;
        const cx = positions[c] - ox;
        const cy = positions[c + 1] - oy;
        const cz = positions[c + 2] - oz;
        six += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
    return six / 6;
}
/**
 * The convex hull of points given as x, y, z each: the smallest convex shape that holds them
 * all. Returns null when the points have no volume between them: fewer than four, or all on
 * one plane.
 *
 * Points go in furthest first. With `maxVertices`, the hull stops at that many corners and may
 * leave points outside; `capped` says so. At least four corners are always used.
 *
 * The same points in the same order always give the same hull.
 */
export function convexHull(points, maxVertices = Infinity) {
    const count = Math.floor(points.length / 3);
    if (count < 4)
        return null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let at = 0; at < count * 3; at += 1) {
        const value = points[at];
        if (value < min[at % 3])
            min[at % 3] = value;
        if (value > max[at % 3])
            max[at % 3] = value;
    }
    const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    if (!(diagonal > 0) || !Number.isFinite(diagonal))
        return null;
    // Points that nearly line up can leave a hole that is not one loop. A wider idea of "on a
    // face" clears that up, at the cost of a hull that is thinner by that much.
    let tolerance = diagonal * HULL_FLATNESS;
    for (let tries = 0; tries < 4; tries += 1) {
        const hull = attempt(points, Math.max(4, maxVertices), tolerance);
        if (hull !== "failed")
            return hull;
        tolerance *= 10;
    }
    return null;
}
