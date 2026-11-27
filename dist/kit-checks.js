import { openingsAlong, resolvePlayer, STEP_MAX_RISE_METERS, walkable } from "./checks.js";
import { weldExact } from "./collision.js";
import { GameExportError, refuse } from "./errors.js";
import { readAccessor, readGlb, readPack } from "./glb-read.js";
import { cellSize, kitLayouts, kitOf, layoutJoints, mateOf, placePoint, sideAxis, sideSign, socketFrame, } from "./kit.js";
import { GENERATOR } from "./version.js";
/** How near is near enough, in metres, when the caller does not say: a tenth of a millimetre. */
export const DEFAULT_KIT_TOLERANCE_METERS = 0.0001;
/** How many lines a face is measured along, each way. Areas are exact along a line and sampled across the lines. */
export const SEAM_LINES = 512;
/** The seven kit checks, in the order the results come in. */
export const KIT_CHECK_IDS = ["on-grid", "seams", "in-cells", "layouts", "corners", "walkable", "collision-tiles"];
function round(value, digits = 6) {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale + 0;
}
function plural(count, one, many = `${one}s`) {
    return `${count} ${count === 1 ? one : many}`;
}
function geometryOf(piece) {
    const document = readGlb(piece.glb);
    const pack = readPack(document);
    const solid = (name, trim, local, translation, indices) => {
        const positions = new Float64Array(local.length);
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (let at = 0; at < local.length; at += 3) {
            // glTF space to the kit frame, then from the pivot to the low corner of the cells.
            positions[at] = local[at] + translation[0] + piece.pivotMeters[0];
            positions[at + 1] = -(local[at + 2] + translation[2]) + piece.pivotMeters[1];
            positions[at + 2] = local[at + 1] + translation[1] + piece.pivotMeters[2];
            for (let axis = 0; axis < 3; axis += 1) {
                if (positions[at + axis] < min[axis])
                    min[axis] = positions[at + axis];
                if (positions[at + axis] > max[axis])
                    max[axis] = positions[at + axis];
            }
        }
        return { name, trim, positions, indices, min, max };
    };
    const geometry = { visible: [], collision: [] };
    for (const [at, body] of pack.bodies.entries()) {
        const facts = piece.facts.bodies[at];
        const trim = facts !== undefined && (piece.trim.includes(facts.sourceName) || piece.trim.includes(facts.name));
        geometry.visible.push(solid(facts?.name ?? body.name, trim, body.positions, body.translation, body.indices));
        for (const node of facts?.collision?.nodes ?? []) {
            const primitive = document.json.meshes?.[node.mesh]?.primitives[0];
            const position = primitive?.attributes["POSITION"];
            if (primitive === undefined || position === undefined || primitive.indices === undefined)
                continue;
            geometry.collision.push(solid(node.name, trim, readAccessor(document, position), body.translation, readAccessor(document, primitive.indices)));
        }
    }
    return geometry;
}
function insideRegion(region, u, v) {
    let inside = false;
    for (let at = 0, last = region.length - 1; at < region.length; last = at, at += 1) {
        const [au, av] = region[at];
        const [bu, bv] = region[last];
        if (av > v !== bv > v && u < ((bu - au) * (v - av)) / (bv - av) + au)
            inside = !inside;
    }
    return inside;
}
/** True when a point of the socket's frame is in the face and covered by a triangle of it. */
function covered(face, u, v) {
    if (Math.abs(u) > face.halfU || Math.abs(v) > face.halfV)
        return false;
    if (face.region !== null && !insideRegion(face.region, u, v))
        return false;
    const t = face.triangles;
    for (let at = 0; at < t.length; at += 6) {
        const d0 = (t[at + 2] - t[at]) * (v - t[at + 1]) - (t[at + 3] - t[at + 1]) * (u - t[at]);
        const d1 = (t[at + 4] - t[at + 2]) * (v - t[at + 3]) - (t[at + 5] - t[at + 3]) * (u - t[at + 2]);
        const d2 = (t[at] - t[at + 4]) * (v - t[at + 5]) - (t[at + 1] - t[at + 5]) * (u - t[at + 4]);
        if ((d0 >= 0 && d1 >= 0 && d2 >= 0) || (d0 <= 0 && d1 <= 0 && d2 <= 0))
            return true;
    }
    return false;
}
const PROBES = Array.from({ length: 8 }, (_, n) => [Math.cos((n * Math.PI) / 4 + 0.3), Math.sin((n * Math.PI) / 4 + 0.3)]);
/** How many of eight places close around a point the face covers: 8 inside it, 0 outside, anything else on its outline. */
function around(face, u, v, radius) {
    let count = 0;
    for (const [du, dv] of PROBES)
        if (covered(face, u + du * radius, v + dv * radius))
            count += 1;
    return count;
}
function faceOf(solids, socket, grid, tolerance) {
    const frame = socketFrame(socket, grid);
    const axis = sideAxis(socket.side);
    const sign = sideSign(socket.side);
    const plane = frame.center[axis];
    const triangles = [];
    const seen = new Map();
    let reach = null;
    const project = (positions, vertex) => {
        const d0 = positions[vertex * 3] - frame.center[0];
        const d1 = positions[vertex * 3 + 1] - frame.center[1];
        const d2 = positions[vertex * 3 + 2] - frame.center[2];
        return [d0 * frame.u[0] + d1 * frame.u[1] + d2 * frame.u[2], d0 * frame.v[0] + d1 * frame.v[1] + d2 * frame.v[2]];
    };
    for (const { positions, indices, trim } of solids) {
        if (trim)
            continue;
        for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
            const [u, v] = project(positions, vertex);
            if (Math.abs(u) > frame.halfU + tolerance || Math.abs(v) > frame.halfV + tolerance)
                continue;
            const out = (positions[vertex * 3 + axis] - plane) * sign;
            if (reach === null || out > reach)
                reach = out;
        }
        for (let t = 0; t < indices.length; t += 3) {
            const a = indices[t];
            const b = indices[t + 1];
            const c = indices[t + 2];
            if ([a, b, c].some((vertex) => Math.abs(positions[vertex * 3 + axis] - plane) > tolerance))
                continue;
            // Only what faces out of the piece: the end of the piece, not the back of something behind it.
            const other = [(axis + 1) % 3, (axis + 2) % 3];
            const normal = (positions[b * 3 + other[0]] - positions[a * 3 + other[0]]) * (positions[c * 3 + other[1]] - positions[a * 3 + other[1]]) -
                (positions[b * 3 + other[1]] - positions[a * 3 + other[1]]) * (positions[c * 3 + other[0]] - positions[a * 3 + other[0]]);
            if (!(normal * sign > 0))
                continue;
            // Only what has some of itself in the face: the end of a wall of the storey below touches the face along a line, and is not of it.
            const corners = [a, b, c].map((vertex) => project(positions, vertex));
            const us = corners.map(([u]) => u);
            const vs = corners.map(([, v]) => v);
            if (Math.max(...us) < -frame.halfU + tolerance || Math.min(...us) > frame.halfU - tolerance || Math.max(...vs) < -frame.halfV + tolerance || Math.min(...vs) > frame.halfV - tolerance)
                continue;
            for (const [u, v] of corners) {
                triangles.push(u, v);
                if (Math.abs(u) <= frame.halfU + tolerance && Math.abs(v) <= frame.halfV + tolerance) {
                    const key = `${Math.round(u / (tolerance / 4))},${Math.round(v / (tolerance / 4))}`;
                    if (!seen.has(key))
                        seen.set(key, [u, v]);
                }
            }
        }
    }
    const face = { triangles: Float64Array.from(triangles), halfU: frame.halfU, halfV: frame.halfV, region: socket.region, vertices: Float64Array.from([...seen.values()].flat()), points: new Float64Array(0), reach };
    const points = [];
    for (const [u, v] of seen.values()) {
        if (face.region !== null && !insideRegion(face.region, u, v) && around(face, u, v, tolerance * 2) === 0)
            continue;
        if (around(face, u, v, tolerance * 2) < 8)
            points.push(u, v);
    }
    face.points = Float64Array.from(points);
    return face;
}
/** A face seen from the other side of the joint: mirrored, and for a joint between storeys turned by quarter turns too. */
function seenFrom(face, turns) {
    const map = (u, v) => {
        let x = -u;
        let y = v;
        for (let n = (((turns % 4) + 4) % 4); n > 0; n -= 1)
            [x, y] = [-y, x];
        return [x + 0, y + 0];
    };
    const each = (values) => {
        const out = new Float64Array(values.length);
        for (let at = 0; at < values.length; at += 2)
            [out[at], out[at + 1]] = map(values[at], values[at + 1]);
        return out;
    };
    const odd = turns % 2 !== 0;
    return {
        triangles: each(face.triangles),
        halfU: odd ? face.halfV : face.halfU,
        halfV: odd ? face.halfU : face.halfV,
        region: face.region === null ? null : face.region.map(([u, v]) => map(u, v)),
        vertices: each(face.vertices),
        points: each(face.points),
        reach: face.reach,
    };
}
/** The lines are set a little off the middle of their rows, so that no line runs along an edge at a round number. */
const LINE_OFFSET = 0.118034;
/** What a face covers of every line across it: for each line, the ends of the stretches it covers, in order. `fixed` is the coordinate that stays the same along a line. */
function stretches(face, fixed) {
    const along = fixed === 0 ? 1 : 0;
    const halfFixed = fixed === 0 ? face.halfU : face.halfV;
    const halfAlong = fixed === 0 ? face.halfV : face.halfU;
    const step = (halfFixed * 2) / SEAM_LINES;
    const t = face.triangles;
    const lines = [];
    for (let line = 0; line < SEAM_LINES; line += 1) {
        const at = -halfFixed + (line + 0.5 + LINE_OFFSET) * step;
        const found = [];
        for (let k = 0; k < t.length; k += 6) {
            let low = Infinity;
            let high = -Infinity;
            for (let edge = 0; edge < 3; edge += 1) {
                const p = k + edge * 2;
                const q = k + ((edge + 1) % 3) * 2;
                const f0 = t[p + fixed];
                const f1 = t[q + fixed];
                if (f0 === f1 || at < Math.min(f0, f1) || at > Math.max(f0, f1))
                    continue;
                const value = t[p + along] + ((at - f0) / (f1 - f0)) * (t[q + along] - t[p + along]);
                if (value < low)
                    low = value;
                if (value > high)
                    high = value;
            }
            low = Math.max(low, -halfAlong);
            high = Math.min(high, halfAlong);
            if (high > low)
                found.push([low, high]);
        }
        found.sort((p, q) => p[0] - q[0]);
        let merged = [];
        for (const [low, high] of found) {
            if (merged.length > 0 && low <= merged[merged.length - 1])
                merged[merged.length - 1] = Math.max(merged[merged.length - 1], high);
            else
                merged.push(low, high);
        }
        if (face.region !== null && merged.length > 0) {
            // Where the line is inside the region: between each two places it crosses the outline.
            const crossings = [];
            for (let n = 0, last = face.region.length - 1; n < face.region.length; last = n, n += 1) {
                const a = face.region[n];
                const b = face.region[last];
                if (a[fixed] > at !== b[fixed] > at)
                    crossings.push(a[along] + ((at - a[fixed]) / (b[fixed] - a[fixed])) * (b[along] - a[along]));
            }
            crossings.sort((p, q) => p - q);
            merged = both(merged, crossings);
        }
        lines.push(merged);
    }
    return lines;
}
/** The stretches two lists of stretches share. */
function both(a, b) {
    const out = [];
    let i = 0;
    let j = 0;
    while (i + 1 < a.length && j + 1 < b.length) {
        const low = Math.max(a[i], b[j]);
        const high = Math.min(a[i + 1], b[j + 1]);
        if (high > low)
            out.push(low, high);
        if (a[i + 1] < b[j + 1])
            i += 2;
        else
            j += 2;
    }
    return out;
}
function lengthOf(stretch) {
    let total = 0;
    for (let at = 0; at + 1 < stretch.length; at += 2)
        total += stretch[at + 1] - stretch[at];
    return total;
}
const covers = new WeakMap();
function coverOf(face) {
    let found = covers.get(face);
    if (found === undefined) {
        found = [stretches(face, 0), stretches(face, 1)];
        covers.set(face, found);
    }
    return found;
}
/**
 * Compares two faces in one frame. Each is measured along lines one way and then the other: a
 * sliver that runs along the lines one way is crossed by every line the other way, so the larger
 * of the two measures of what differs is taken.
 */
function compare(a, b) {
    const coverA = coverOf(a);
    const coverB = coverOf(b);
    const result = { areaA: 0, areaB: 0, shared: Infinity, mismatch: 0 };
    for (const fixed of [0, 1]) {
        const step = ((fixed === 0 ? a.halfU : a.halfV) * 2) / SEAM_LINES;
        let areaA = 0;
        let areaB = 0;
        let shared = 0;
        for (let line = 0; line < SEAM_LINES; line += 1) {
            const lineA = coverA[fixed][line];
            const lineB = coverB[fixed][line];
            areaA += lengthOf(lineA);
            areaB += lengthOf(lineB);
            shared += lengthOf(both(lineA, lineB));
        }
        result.areaA += (areaA * step) / 2;
        result.areaB += (areaB * step) / 2;
        result.shared = Math.min(result.shared, shared * step);
        result.mismatch = Math.max(result.mismatch, (areaA + areaB - 2 * shared) * step);
    }
    return result;
}
/** Looks for every outline point of one face among the points of the other. */
function matchPoints(a, b, tolerance, into) {
    for (let at = 0; at < a.points.length; at += 2) {
        const u = a.points[at];
        const v = a.points[at + 1];
        let nearest = Infinity;
        for (let n = 0; n < b.vertices.length; n += 2)
            nearest = Math.min(nearest, Math.hypot(b.vertices[n] - u, b.vertices[n + 1] - v));
        into.points += 1;
        if (nearest <= tolerance * 1.5) {
            into.coincident += 1;
            continue;
        }
        const near = around(b, u, v, tolerance * 2);
        if (near > 0 && near < 8) {
            into.onEdge += 1;
        }
        else {
            into.off += 1;
            if (Number.isFinite(nearest))
                into.maxOff = Math.max(into.maxOff, nearest);
        }
    }
}
function canMeet(a, b) {
    const up = sideAxis(a.side) === 2;
    if (up !== (sideAxis(b.side) === 2))
        return false;
    return !up || a.side !== b.side;
}
/** Clips a flat polygon, as x, y, z per corner, to where `coordinate` is at most `limit` times `sign`. */
function clip(polygon, coordinate, limit, sign) {
    const out = [];
    const count = polygon.length / 3;
    for (let at = 0; at < count; at += 1) {
        const a = at * 3;
        const b = ((at + 1) % count) * 3;
        const da = (polygon[a + coordinate] - limit) * sign;
        const db = (polygon[b + coordinate] - limit) * sign;
        if (da <= 0)
            out.push(polygon[a], polygon[a + 1], polygon[a + 2]);
        if (da <= 0 !== db <= 0) {
            const share = da / (da - db);
            for (let part = 0; part < 3; part += 1)
                out.push(polygon[a + part] + share * (polygon[b + part] - polygon[a + part]));
        }
    }
    return out;
}
/**
 * The opening at a socket: what the piece shows of itself looking in through the face, as far
 * in as `depth`, with the edges of the face shut as the cells next to it and the storey above
 * would shut them.
 */
function openingAt(solids, socket, grid, player, depth) {
    const frame = socketFrame(socket, grid);
    const axis = sideAxis(socket.side);
    const sign = sideSign(socket.side);
    const width = frame.halfU * 2;
    const height = frame.halfV * 2;
    const positions = [];
    for (const solid of solids) {
        if (solid.trim)
            continue;
        for (let t = 0; t < solid.indices.length; t += 3) {
            // In the socket's frame: across, up, and how far in front of the plane.
            let polygon = [];
            for (let k = 0; k < 3; k += 1) {
                const vertex = solid.indices[t + k] * 3;
                const d = [solid.positions[vertex] - frame.center[0], solid.positions[vertex + 1] - frame.center[1], solid.positions[vertex + 2] - frame.center[2]];
                polygon.push(d[0] * frame.u[0] + d[1] * frame.u[1] + d[2] * frame.u[2] + frame.halfU, d[0] * frame.v[0] + d[1] * frame.v[1] + d[2] * frame.v[2] + frame.halfV, d[axis] * sign);
            }
            polygon = clip(polygon, 2, 0, 1);
            polygon = clip(polygon, 2, -depth, -1);
            polygon = clip(polygon, 0, width, 1);
            polygon = clip(polygon, 0, 0, -1);
            polygon = clip(polygon, 1, height, 1);
            polygon = clip(polygon, 1, 0, -1);
            for (let k = 1; k + 1 < polygon.length / 3; k += 1) {
                positions.push(polygon[0], polygon[1], 0, polygon[k * 3], polygon[k * 3 + 1], 0, polygon[k * 3 + 3], polygon[k * 3 + 4], 0);
            }
        }
    }
    // The two sides and the top of the face, as lines.
    for (const [ax, ay, bx, by] of [[0, 0, 0, height], [width, 0, width, height], [0, height, width, height]])
        positions.push(ax, ay, 0, bx, by, 0, bx, by, 0);
    const mesh = { positions: Float64Array.from(positions), indices: Uint32Array.from({ length: positions.length / 3 }, (_, at) => at) };
    const { openings } = openingsAlong([mesh], "z", [0, 0, 0], [width, height, 0], player);
    const fitting = openings.filter((opening) => opening.fits);
    const best = (fitting.length > 0 ? fitting : openings).reduce((found, opening) => (found === undefined || (fitting.length > 0 ? opening.sillMeters < found.sillMeters : opening.widthMeters * opening.heightMeters > found.widthMeters * found.heightMeters) ? opening : found), undefined);
    return { fits: fitting.length > 0, widthMeters: best?.widthMeters ?? 0, heightMeters: best?.heightMeters ?? 0, floorMeters: best?.sillMeters ?? 0 };
}
/**
 * One passage: whether the player passes, looking through the half of the cell behind the
 * socket, and the floor the player stands on in the joint itself, half in each piece.
 */
function passageAt(solids, socket, grid, player) {
    const through = openingAt(solids, socket, grid, player, grid.moduleMeters / 2);
    const joint = openingAt(solids, socket, grid, player, Math.min(player.capsuleRadiusM, grid.moduleMeters / 2));
    return { socket: socket.name, fits: through.fits, widthMeters: through.widthMeters, heightMeters: through.heightMeters, floorMeters: through.fits && joint.fits ? joint.floorMeters : through.floorMeters };
}
/**
 * What a player could stand on, turned to the axes the player checks read: +Y up. A face that
 * looks up with something sitting on all of it, like the top of a wall under the wall of the
 * next storey, is left out: nothing stands there.
 */
function standable(solids) {
    const flat = Math.cos(Math.PI / 90);
    const under = new Map();
    const looksUp = [];
    for (const { positions, indices } of solids) {
        const up = [];
        for (let t = 0; t < indices.length; t += 3) {
            const a = indices[t] * 3;
            const b = indices[t + 1] * 3;
            const c = indices[t + 2] * 3;
            const nx = (positions[b + 1] - positions[a + 1]) * (positions[c + 2] - positions[a + 2]) - (positions[b + 2] - positions[a + 2]) * (positions[c + 1] - positions[a + 1]);
            const ny = (positions[b + 2] - positions[a + 2]) * (positions[c] - positions[a]) - (positions[b] - positions[a]) * (positions[c + 2] - positions[a + 2]);
            const nz = (positions[b] - positions[a]) * (positions[c + 1] - positions[a + 1]) - (positions[b + 1] - positions[a + 1]) * (positions[c] - positions[a]);
            const length = Math.hypot(nx, ny, nz);
            up.push(length > 0 && nz / length >= flat);
            if (length > 0 && nz / length <= -flat) {
                const level = Math.round(((positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3) * 1000);
                let found = under.get(level);
                if (found === undefined)
                    under.set(level, (found = []));
                found.push(positions[a], positions[a + 1], positions[b], positions[b + 1], positions[c], positions[c + 1]);
            }
        }
        looksUp.push(up);
    }
    /** How much of a triangle, as x, y for each corner, the faces looking down at its level cover. */
    const sat = (level, triangle) => {
        let total = 0;
        for (const near of [level - 1, level, level + 1]) {
            const t = under.get(near);
            if (t === undefined)
                continue;
            for (let at = 0; at < t.length; at += 6) {
                // The triangle cut down to the inside of each edge of the one over it.
                let polygon = triangle;
                const turn = Math.sign((t[at + 2] - t[at]) * (t[at + 5] - t[at + 1]) - (t[at + 3] - t[at + 1]) * (t[at + 4] - t[at]));
                for (let edge = 0; edge < 3 && polygon.length >= 6; edge += 1) {
                    const px = t[at + edge * 2];
                    const py = t[at + edge * 2 + 1];
                    const qx = t[at + ((edge + 1) % 3) * 2];
                    const qy = t[at + ((edge + 1) % 3) * 2 + 1];
                    const side = (x, y) => ((qx - px) * (y - py) - (qy - py) * (x - px)) * turn;
                    const cut = [];
                    for (let k = 0; k < polygon.length; k += 2) {
                        const ax = polygon[k];
                        const ay = polygon[k + 1];
                        const bx = polygon[(k + 2) % polygon.length];
                        const by = polygon[(k + 3) % polygon.length];
                        const da = side(ax, ay);
                        const db = side(bx, by);
                        if (da >= 0)
                            cut.push(ax, ay);
                        if (da >= 0 !== db >= 0)
                            cut.push(ax + (da / (da - db)) * (bx - ax), ay + (da / (da - db)) * (by - ay));
                    }
                    polygon = cut;
                }
                let twice = 0;
                for (let k = 0; k < polygon.length; k += 2)
                    twice += polygon[k] * polygon[(k + 3) % polygon.length] - polygon[(k + 2) % polygon.length] * polygon[k + 1];
                total += Math.abs(twice) / 2;
            }
        }
        return total;
    };
    return solids.map(({ positions, indices }, which) => {
        const turned = new Float64Array(positions.length);
        for (let at = 0; at < positions.length; at += 3) {
            turned[at] = positions[at];
            turned[at + 1] = positions[at + 2];
            turned[at + 2] = -positions[at + 1];
        }
        const kept = [];
        for (let t = 0; t < indices.length; t += 3) {
            const corners = [indices[t], indices[t + 1], indices[t + 2]];
            if (looksUp[which][t / 3]) {
                const level = Math.round(((positions[corners[0] * 3 + 2] + positions[corners[1] * 3 + 2] + positions[corners[2] * 3 + 2]) / 3) * 1000);
                const flatCorners = corners.flatMap((corner) => [positions[corner * 3], positions[corner * 3 + 1]]);
                const area = Math.abs((flatCorners[2] - flatCorners[0]) * (flatCorners[5] - flatCorners[1]) - (flatCorners[3] - flatCorners[1]) * (flatCorners[4] - flatCorners[0])) / 2;
                // Buried: all of it, to a thousandth, is under something.
                if (area - sat(level, flatCorners) <= area * 0.001)
                    continue;
            }
            kept.push(...corners);
        }
        return { positions: turned, indices: kept };
    });
}
/** The box around a placed solid, in the layout. */
function placedBox(solid, placement, grid) {
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    placePoint(solid.min, placement, grid, a);
    placePoint(solid.max, placement, grid, b);
    return { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] };
}
/**
 * True when a box is proven clear of a placed solid with no kernel: no triangle of the solid
 * comes into the box, so the box is all outside the solid or all inside it, and a line straight
 * up from the middle of the box leaves the solid as often as it enters it, so it is outside.
 */
function clearOf(box, solid, placement, grid, tolerance) {
    const { indices } = solid;
    const positions = new Float64Array(solid.positions.length);
    for (let at = 0; at < positions.length; at += 3)
        placePoint(solid.positions.subarray(at, at + 3), placement, grid, positions, at);
    // A little off the middle, so the line runs along no edge of a mesh made at round numbers.
    const x = box.min[0] + (box.max[0] - box.min[0]) * 0.4871;
    const y = box.min[1] + (box.max[1] - box.min[1]) * 0.5237;
    const z = (box.min[2] + box.max[2]) / 2;
    let crossings = 0;
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t] * 3;
        const b = indices[t + 1] * 3;
        const c = indices[t + 2] * 3;
        if ([0, 1, 2].every((axis) => Math.max(positions[a + axis], positions[b + axis], positions[c + axis]) > box.min[axis] + tolerance && Math.min(positions[a + axis], positions[b + axis], positions[c + axis]) < box.max[axis] - tolerance)) {
            return false;
        }
        const d0 = (positions[b] - positions[a]) * (y - positions[a + 1]) - (positions[b + 1] - positions[a + 1]) * (x - positions[a]);
        const d1 = (positions[c] - positions[b]) * (y - positions[b + 1]) - (positions[c + 1] - positions[b + 1]) * (x - positions[b]);
        const d2 = (positions[a] - positions[c]) * (y - positions[c + 1]) - (positions[a + 1] - positions[c + 1]) * (x - positions[c]);
        if (!((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0)))
            continue;
        const sum = d0 + d1 + d2;
        if ((d1 * positions[a + 2] + d2 * positions[b + 2] + d0 * positions[c + 2]) / sum > z)
            crossings += 1;
    }
    return crossings % 2 === 0;
}
/**
 * A placed solid for the kernel, one closed shell at a time. A body made of parts that touch,
 * like a wall standing on a slab, has edges four triangles share, which no kernel takes as one
 * solid: triangles are grouped over the edges exactly two of them share, and each group is a
 * shell with corners of its own.
 */
function placedShells(kernel, solid, placement, grid, made) {
    const positions = new Float64Array(solid.positions.length);
    for (let at = 0; at < positions.length; at += 3)
        placePoint(solid.positions.subarray(at, at + 3), placement, grid, positions, at);
    const welded = weldExact(positions, solid.indices);
    const count = welded.indices.length / 3;
    const corners = welded.positions.length / 3;
    const edges = new Map();
    for (let t = 0; t < count; t += 1) {
        for (let k = 0; k < 3; k += 1) {
            const a = welded.indices[t * 3 + k];
            const b = welded.indices[t * 3 + ((k + 1) % 3)];
            const key = Math.min(a, b) * corners + Math.max(a, b);
            const found = edges.get(key);
            if (found === undefined)
                edges.set(key, [t]);
            else
                found.push(t);
        }
    }
    const group = Int32Array.from({ length: count }, (_, t) => t);
    const top = (t) => {
        while (group[t] !== t)
            t = group[t] = group[group[t]];
        return t;
    };
    for (const pair of edges.values())
        if (pair.length === 2)
            group[top(pair[0])] = top(pair[1]);
    const shells = new Map();
    for (let t = 0; t < count; t += 1) {
        const key = top(t);
        const shell = shells.get(key);
        if (shell === undefined)
            shells.set(key, [t]);
        else
            shell.push(t);
    }
    const out = [];
    for (const triangles of shells.values()) {
        const renumbered = new Map();
        const shellPositions = [];
        const shellIndices = new Uint32Array(triangles.length * 3);
        for (const [at, t] of triangles.entries()) {
            for (let k = 0; k < 3; k += 1) {
                const vertex = welded.indices[t * 3 + k];
                let own = renumbered.get(vertex);
                if (own === undefined) {
                    own = renumbered.size;
                    renumbered.set(vertex, own);
                    shellPositions.push(welded.positions[vertex * 3], welded.positions[vertex * 3 + 1], welded.positions[vertex * 3 + 2]);
                }
                shellIndices[at * 3 + k] = own;
            }
        }
        const shell = kernel.solid(Float32Array.from(shellPositions), shellIndices);
        made.push(shell);
        out.push(shell);
    }
    return out;
}
function seamTypes(kit, entries, faceOfEntry, tolerance, pairs) {
    const types = [];
    const empty = [];
    let max = 0;
    const names = [...new Set(entries.map((entry) => entry.socket.type))].sort();
    for (const entry of entries) {
        const face = faceOfEntry(entry);
        if (face !== null && face.triangles.length === 0)
            empty.push(entry.label);
    }
    for (const type of names) {
        const mates = mateOf(kit, type);
        if (mates < type && names.includes(mates))
            continue;
        const own = entries.filter((entry) => entry.socket.type === type);
        const others = entries.filter((entry) => entry.socket.type === mates);
        const row = { type, mates, sockets: own.length + (mates === type ? 0 : others.length), pairs: 0, outlineSquareMeters: 0, mismatchSquareMeters: 0, worst: null };
        for (const a of own) {
            for (const b of others) {
                if (mates === type && entries.indexOf(b) < entries.indexOf(a))
                    continue;
                if (!canMeet(a.socket, b.socket))
                    continue;
                const faceA = faceOfEntry(a);
                const faceB = faceOfEntry(b);
                if (faceA === null || faceB === null)
                    continue;
                const compared = compare(faceA, seenFrom(faceB, 0));
                pairs.set(`${a.label}|${b.label}`, compared);
                pairs.set(`${b.label}|${a.label}`, { areaA: compared.areaB, areaB: compared.areaA, shared: compared.shared, mismatch: compared.mismatch });
                row.pairs += 1;
                row.outlineSquareMeters = Math.max(row.outlineSquareMeters, round(compared.areaA), round(compared.areaB));
                // To the square millimetre: numbers stored in 32 bits differ by less than that when mirrored.
                if (round(compared.mismatch) > row.mismatchSquareMeters) {
                    row.mismatchSquareMeters = round(compared.mismatch);
                    if (compared.mismatch > tolerance)
                        row.worst = [a.label, b.label];
                }
            }
        }
        max = Math.max(max, row.mismatchSquareMeters);
        types.push(row);
    }
    return { types, empty, max };
}
/**
 * Runs the seven kit checks and returns one result for each: pass, warn, fail, or not measured
 * with the reason, each with the numbers it was judged by. Nothing is thrown for a kit that
 * fails a check, only for a kit that cannot be read.
 *
 * Everything is measured from the files the kit's pieces are written as. No check needs a
 * kernel but one part of Layouts close: whether trim that reaches into the piece next to it
 * runs into that piece's bodies. Without a kernel that is not measured, and the check says so.
 *
 * Another module size is one call: pass `{ grid }` in the options.
 */
export function checkKit(input, options = {}) {
    if (typeof options !== "object" || options === null)
        refuse("BAD_OPTION", "Check options must be an object.");
    const kit = kitOf(input, options.grid);
    const tolerance = options.toleranceMeters ?? DEFAULT_KIT_TOLERANCE_METERS;
    if (!(Number.isFinite(tolerance) && tolerance > 0))
        refuse("BAD_OPTION", `toleranceMeters must be a positive number of metres. Got ${String(tolerance)}.`);
    if (options.kernel !== undefined && (typeof options.kernel !== "object" || options.kernel === null || typeof options.kernel.solid !== "function")) {
        refuse("BAD_OPTION", "kernel must be an object with a solid(positions, indices) function.");
    }
    const kernel = options.kernel;
    const player = resolvePlayer(options.player, kit.profile);
    const { grid } = kit;
    const size = cellSize(grid);
    const results = [];
    const geometry = new Map(kit.pieces.map((piece) => [piece.name, geometryOf(piece)]));
    const entries = kit.pieces.flatMap((piece) => {
        const { visible, collision } = geometry.get(piece.name);
        return piece.sockets.map((socket) => ({
            piece,
            socket,
            label: `${piece.name}/${socket.name}`,
            visible: faceOf(visible, socket, grid, tolerance),
            collision: collision.length > 0 ? faceOf(collision, socket, grid, tolerance) : null,
        }));
    });
    const entryOf = new Map(entries.map((entry) => [entry.label, entry]));
    // On the grid.
    {
        const values = { moduleMeters: grid.moduleMeters, storeyMeters: grid.storeyMeters, toleranceMeters: tolerance, pieces: [], worstMeters: 0 };
        const off = [];
        for (const piece of kit.pieces) {
            const solids = geometry.get(piece.name).visible.filter((solid) => !solid.trim);
            const sizeMeters = [0, 0, 0];
            const modules = [0, 0, 0];
            let sizeOff = 0;
            let pivotOff = 0;
            for (const axis of [0, 1, 2]) {
                const low = Math.min(...solids.map((solid) => solid.min[axis]));
                const high = Math.max(...solids.map((solid) => solid.max[axis]));
                const length = solids.length > 0 ? high - low : 0;
                sizeMeters[axis] = round(length);
                modules[axis] = round(length / size[axis]);
                sizeOff = Math.max(sizeOff, Math.abs(length - Math.max(1, Math.round(length / size[axis])) * size[axis]));
                pivotOff = Math.max(pivotOff, Math.abs(piece.pivotMeters[axis] - Math.round(piece.pivotMeters[axis] / size[axis]) * size[axis]));
            }
            const socketOff = Math.max(0, ...piece.sockets.map((socket) => Math.abs(socket.offsetMeters)));
            values.pieces.push({ piece: piece.name, cells: piece.cells, sizeMeters, modules, sizeOffMeters: round(sizeOff), pivotOffMeters: round(pivotOff), socketOffMeters: round(socketOff) });
            const worst = Math.max(sizeOff, pivotOff, socketOff);
            values.worstMeters = Math.max(values.worstMeters, round(worst));
            if (sizeOff > tolerance)
                off.push(`"${piece.name}" is ${modules.map((value) => round(value, 4)).join(" by ")} modules`);
            if (pivotOff > tolerance)
                off.push(`the pivot of "${piece.name}" is ${round(pivotOff, 4)} m from a corner of the grid`);
            if (socketOff > tolerance)
                off.push(`a socket of "${piece.name}" is ${round(socketOff, 4)} m from the face of its cell`);
        }
        if (off.length > 0)
            results.push({ id: "on-grid", status: "fail", message: `Off the grid of ${grid.moduleMeters} m by ${grid.storeyMeters} m: ${off.join("; ")}.`, values });
        else
            results.push({ id: "on-grid", status: "pass", message: `${plural(kit.pieces.length, "piece")} of whole modules of ${grid.moduleMeters} m and storeys of ${grid.storeyMeters} m, each with its pivot on a corner of the grid.`, values });
    }
    // Seams match.
    const faceSide = Math.sqrt(Math.max(grid.moduleMeters * grid.storeyMeters, grid.moduleMeters * grid.moduleMeters));
    const seamTolerance = tolerance * faceSide;
    const visiblePairs = new Map();
    {
        const { types, empty, max } = seamTypes(kit, entries, (entry) => entry.visible, seamTolerance, visiblePairs);
        const values = { toleranceSquareMeters: round(seamTolerance, 9), lineMeters: round(Math.max(grid.moduleMeters, grid.storeyMeters) / SEAM_LINES), types, empty, maxMismatchSquareMeters: max };
        const pairs = types.reduce((total, type) => total + type.pairs, 0);
        const failing = types.filter((type) => type.mismatchSquareMeters > seamTolerance);
        if (entries.length === 0) {
            results.push({ id: "seams", status: "not-measured", message: "The kit has no sockets.", reason: "No piece was given a socket, so no two pieces are said to meet.", values });
        }
        else if (empty.length > 0) {
            results.push({ id: "seams", status: "fail", message: `Nothing of the piece lies on the plane of ${plural(empty.length, "socket")}: ${empty.slice(0, 4).join(", ")}${empty.length > 4 ? ", ..." : ""}.`, values });
        }
        else if (failing.length > 0) {
            const worst = failing.reduce((a, b) => (b.mismatchSquareMeters > a.mismatchSquareMeters ? b : a));
            results.push({ id: "seams", status: "fail", message: `Sockets of type "${worst.type}" do not have one outline: ${worst.worst.join(" and ")} differ by ${round(worst.mismatchSquareMeters, 6)} m2.`, values });
        }
        else if (pairs === 0) {
            results.push({ id: "seams", status: "not-measured", message: "No two sockets of the kit can meet.", reason: "Every socket type is used once, or only on sides that never face each other.", values });
        }
        else {
            results.push({ id: "seams", status: "pass", message: `${plural(pairs, "pair")} of sockets that can meet, each with one outline to within ${round(seamTolerance, 6)} m2.`, values });
        }
    }
    // Stays in its cells.
    {
        const values = { toleranceMeters: tolerance, trimMeters: grid.trimMeters, pieces: [], maxPokeMeters: 0, maxTrimPokeMeters: 0 };
        const out = [];
        for (const piece of kit.pieces) {
            const poke = (trim) => {
                const solids = geometry.get(piece.name).visible.filter((solid) => solid.trim === trim);
                if (solids.length === 0)
                    return null;
                let worst = 0;
                for (const solid of solids) {
                    for (const axis of [0, 1, 2])
                        worst = Math.max(worst, -solid.min[axis], solid.max[axis] - piece.cells[axis] * size[axis]);
                }
                return round(worst);
            };
            const pokeMeters = poke(false) ?? 0;
            const trimPokeMeters = poke(true);
            values.pieces.push({ piece: piece.name, pokeMeters, trimPokeMeters });
            values.maxPokeMeters = Math.max(values.maxPokeMeters, pokeMeters);
            values.maxTrimPokeMeters = Math.max(values.maxTrimPokeMeters, trimPokeMeters ?? 0);
            if (pokeMeters > tolerance)
                out.push(`"${piece.name}" reaches ${round(pokeMeters, 4)} m past its cells`);
            if (trimPokeMeters !== null && trimPokeMeters > grid.trimMeters + tolerance)
                out.push(`the trim of "${piece.name}" reaches ${round(trimPokeMeters, 4)} m past its cells, and trim may reach ${grid.trimMeters} m`);
        }
        if (out.length > 0)
            results.push({ id: "in-cells", status: "fail", message: `Out of its cells: ${out.join("; ")}.`, values });
        else
            results.push({ id: "in-cells", status: "pass", message: `Every piece stays in its cells${values.maxTrimPokeMeters > tolerance ? `, and trim reaches at most ${round(values.maxTrimPokeMeters, 4)} m past them` : ""}.`, values });
    }
    // Layouts close.
    const generated = kitLayouts(kit);
    const layouts = [...generated.layouts, ...kit.layouts];
    {
        const values = { layouts: [], skipped: generated.skipped, kernel: kernel !== undefined };
        const problems = [];
        let unmeasured = 0;
        let notSolid = null;
        const byName = new Map(kit.pieces.map((piece) => [piece.name, piece]));
        for (const layout of layouts) {
            const found = layoutJoints(kit, layout);
            let apart = 0;
            let minContact = null;
            let maxGap = 0;
            let maxOverlap = 0;
            for (const { a, b } of found.joints) {
                const entryA = entryOf.get(`${a.piece}/${a.name}`);
                const entryB = entryOf.get(`${b.piece}/${b.name}`);
                let compared = visiblePairs.get(`${entryA.label}|${entryB.label}`);
                // A joint between storeys meets at whatever turn the two pieces are placed at.
                const turns = sideAxis(a.side) === 2 ? layout.placements[b.placement].turn - layout.placements[a.placement].turn : 0;
                if (compared === undefined || turns % 4 !== 0)
                    compared = compare(entryA.visible, seenFrom(entryB.visible, turns));
                minContact = minContact === null ? compared.shared : Math.min(minContact, compared.shared);
                const reaches = [entryA.visible.reach, entryB.visible.reach];
                maxOverlap = Math.max(maxOverlap, ...reaches.map((reach) => Math.max(0, reach ?? 0)));
                if (!(compared.shared > tolerance * tolerance)) {
                    apart += 1;
                    maxGap = Math.max(maxGap, reaches.reduce((total, reach) => total + Math.max(0, -(reach ?? 0)), 0));
                }
            }
            // Trim against the bodies of every other piece: boxes first, the kernel where boxes cross.
            let trimVolume = 0;
            let trimPairs = 0;
            const unsolid = [];
            for (const [at, placement] of layout.placements.entries()) {
                for (const trim of geometry.get(placement.piece).visible.filter((solid) => solid.trim)) {
                    const box = placedBox(trim, placement, grid);
                    for (const [other, otherPlacement] of layout.placements.entries()) {
                        if (other === at)
                            continue;
                        for (const solid of geometry.get(otherPlacement.piece).visible) {
                            // Trim against trim is counted once.
                            if (solid.trim && other < at)
                                continue;
                            const against = placedBox(solid, otherPlacement, grid);
                            if ([0, 1, 2].some((axis) => box.min[axis] >= against.max[axis] - tolerance || against.min[axis] >= box.max[axis] - tolerance))
                                continue;
                            if (clearOf(box, solid, otherPlacement, grid, tolerance))
                                continue;
                            trimPairs += 1;
                            if (kernel === undefined)
                                continue;
                            const made = [];
                            try {
                                const others = placedShells(kernel, solid, otherPlacement, grid, made);
                                for (const first of placedShells(kernel, trim, placement, grid, made)) {
                                    if (first.intersect === undefined)
                                        refuse("BAD_OPTION", "The kernel's solids have no intersect(other), which measuring where trim overlaps needs.");
                                    for (const second of others) {
                                        const common = first.intersect(second);
                                        made.push(common);
                                        trimVolume += common.volume();
                                    }
                                }
                            }
                            catch (error) {
                                if (error instanceof GameExportError)
                                    throw error;
                                unsolid.push(`"${trim.name}" of "${placement.piece}" against "${solid.name}" of "${otherPlacement.piece}"`);
                            }
                            finally {
                                for (const one of made)
                                    one.delete?.();
                            }
                        }
                    }
                }
            }
            const measured = trimPairs === 0 || (kernel !== undefined && unsolid.length === 0);
            if (!measured)
                unmeasured += kernel === undefined ? trimPairs : unsolid.length;
            if (unsolid.length > 0 && notSolid === null)
                notSolid = unsolid[0];
            values.layouts.push({
                name: layout.name,
                origin: layout.origin,
                pieces: layout.placements.length,
                cells: found.cells,
                joints: found.joints.length,
                open: found.open.length,
                blocked: found.blocked.length,
                mismatched: found.mismatched.length,
                doubledCells: found.doubled.length,
                apart,
                minContactSquareMeters: minContact === null ? null : round(minContact),
                maxGapMeters: round(maxGap),
                maxOverlapMeters: round(maxOverlap),
                trimOverlapCubicMeters: measured ? round(trimVolume, 9) : null,
                trimPairs,
            });
            const said = [];
            if (found.doubled.length > 0)
                said.push(`${plural(found.doubled.length, "cell has", "cells have")} two pieces in it`);
            if (found.blocked.length > 0)
                said.push(`${plural(found.blocked.length, "socket faces", "sockets face")} a side with no socket`);
            if (found.mismatched.length > 0)
                said.push(`${plural(found.mismatched.length, "joint has", "joints have")} two types that do not meet`);
            if (apart > 0)
                said.push(`${plural(apart, "joint does", "joints do")} not touch${maxGap > 0 ? `, ${round(maxGap, 4)} m apart at most` : ""}`);
            if (maxOverlap > tolerance)
                said.push(`a piece reaches ${round(maxOverlap, 4)} m into the piece it meets`);
            if (measured && trimVolume > tolerance ** 3)
                said.push(`trim runs into the piece next to it by ${round(trimVolume, 6)} m3`);
            if (found.joints.length === 0 && said.length === 0 && byName.size > 0)
                said.push("no two sockets meet");
            if (said.length > 0)
                problems.push(`"${layout.name}": ${said.join(", ")}`);
        }
        const joints = values.layouts.reduce((total, layout) => total + layout.joints, 0);
        if (layouts.length === 0) {
            results.push({ id: "layouts", status: "not-measured", message: "No test layout could be built from the kit's sockets.", reason: generated.skipped.map((skip) => `${skip.name}: ${skip.reason}`).join(" "), values });
        }
        else if (problems.length > 0) {
            results.push({ id: "layouts", status: "fail", message: `Layouts do not close: ${problems.join("; ")}.`, values });
        }
        else if (unmeasured > 0) {
            results.push({
                id: "layouts",
                status: "not-measured",
                message: `Every joint touches, but trim reaches the box of a body next to it in ${plural(unmeasured, "place")}, and whether it runs into that body was not measured.`,
                reason: notSolid === null ? "No kernel was given, and measuring what two bodies both fill needs one." : `The kernel could not make solids of ${notSolid}: a body that is not closed has no inside to measure.`,
                values,
            });
        }
        else {
            results.push({ id: "layouts", status: "pass", message: `${plural(layouts.length, "layout")} (${layouts.map((layout) => layout.name).join(", ")}) with ${plural(joints, "joint")}, each touching with no overlap.`, values });
        }
    }
    // Corners line up.
    {
        const values = { toleranceMeters: tolerance, pairs: 0, pairsSkipped: 0, points: 0, coincident: 0, onEdge: 0, off: 0, maxOffMeters: 0, worst: null };
        const total = { points: 0, coincident: 0, onEdge: 0, off: 0, maxOff: 0 };
        let worstCount = 0;
        for (const [at, a] of entries.entries()) {
            for (const b of entries.slice(at)) {
                if (mateOf(kit, a.socket.type) !== b.socket.type || !canMeet(a.socket, b.socket))
                    continue;
                const compared = visiblePairs.get(`${a.label}|${b.label}`);
                if (compared === undefined)
                    continue;
                // Outlines that differ have no shared seam to compare points along.
                if (compared.mismatch > seamTolerance || a.visible.triangles.length === 0 || b.visible.triangles.length === 0) {
                    values.pairsSkipped += 1;
                    continue;
                }
                values.pairs += 1;
                const before = total.off + total.onEdge;
                const beforeOff = total.maxOff;
                const mirrored = seenFrom(b.visible, 0);
                matchPoints(a.visible, mirrored, tolerance, total);
                if (a !== b)
                    matchPoints(mirrored, a.visible, tolerance, total);
                const here = total.off + total.onEdge - before;
                if (total.maxOff > beforeOff || (values.worst === null && here > 0) || (total.maxOff === 0 && here > worstCount)) {
                    values.worst = [a.label, b.label];
                    worstCount = here;
                }
            }
        }
        values.points = total.points;
        values.coincident = total.coincident;
        values.onEdge = total.onEdge;
        values.off = total.off;
        values.maxOffMeters = round(total.maxOff);
        if (values.pairs === 0) {
            const reason = values.pairsSkipped > 0 ? "The outlines of the sockets that can meet differ, so they have no shared seam to compare points along. Seams match says by how much." : "No two sockets of the kit can meet.";
            results.push({ id: "corners", status: "not-measured", message: "No seam has points to compare.", reason, values });
        }
        else if (values.off > 0) {
            results.push({ id: "corners", status: "fail", message: `${plural(values.off, "point")} of a seam lie off the outline they meet, by up to ${round(values.maxOffMeters, 5)} m: ${values.worst.join(" and ")}.`, values });
        }
        else if (values.onEdge > 0) {
            results.push({ id: "corners", status: "warn", message: `${plural(values.onEdge, "point")} of a seam lie along an edge of the outline they meet, where it has no point: ${values.worst.join(" and ")}. The outlines agree, but a renderer can show a crack there.`, values });
        }
        else {
            results.push({ id: "corners", status: "pass", message: `${plural(values.points, "point")} along ${plural(values.pairs, "seam")}, each on a point of the outline it meets.`, values });
        }
    }
    // Walkable.
    {
        const values = {
            player: player.id,
            capsuleRadiusMeters: player.capsuleRadiusM,
            capsuleHeightMeters: player.capsuleHeightM,
            stepHeightMeters: player.stepHeightM,
            walkableSlopeDegrees: player.walkableSlopeDeg,
            pieces: [],
            maxFloorStepMeters: 0,
            maxRiseMeters: 0,
            maxRampDegrees: 0,
        };
        const problems = [];
        const floors = new Map();
        let passages = 0;
        // Floors are read off a picture of the face: good to about two of its cells.
        const slack = (Math.max(grid.moduleMeters, grid.storeyMeters) / 384) * 3;
        for (const piece of kit.pieces) {
            const { visible, collision } = geometry.get(piece.name);
            const walked = (collision.length > 0 ? collision : visible).filter((solid) => !solid.trim);
            const found = piece.sockets.filter((socket) => socket.passage && sideAxis(socket.side) !== 2).map((socket) => passageAt(walked, socket, grid, player));
            const { levels, ramps } = walkable(standable(walked), 0, player);
            // Steps: from the floor at a passage, up or down, as long as the next level is a step away.
            const rises = [];
            const taken = new Set();
            for (const passage of found) {
                if (!passage.fits)
                    continue;
                const socket = piece.sockets.find((candidate) => candidate.name === passage.socket);
                const storey = socket.cell[2] * grid.storeyMeters;
                const at = levels.findIndex((level) => Math.abs(level - passage.floorMeters - storey) <= slack);
                if (at < 0)
                    continue;
                // The floor as the mesh has it, which is exact, over the floor read off the picture.
                passage.floorMeters = round(levels[at] - storey, 4);
                for (const direction of [1, -1]) {
                    for (let next = at + direction; next >= 0 && next < levels.length; next += direction) {
                        const rise = Math.abs(levels[next] - levels[next - direction]);
                        if (rise > STEP_MAX_RISE_METERS + 1e-9)
                            break;
                        const lower = Math.min(next, next - direction);
                        if (!taken.has(lower))
                            rises.push(round(rise, 4));
                        taken.add(lower);
                    }
                }
            }
            values.pieces.push({ piece: piece.name, geometry: collision.length > 0 ? "collision" : "visible", passages: found, rises, ramps });
            passages += found.length;
            for (const passage of found) {
                floors.set(`${piece.name}/${passage.socket}`, passage.floorMeters);
                if (!passage.fits) {
                    problems.push(passage.widthMeters > 0
                        ? `the player does not fit through ${passage.socket} of "${piece.name}": the opening is ${passage.widthMeters} m wide and ${passage.heightMeters} m tall`
                        : `the way through ${passage.socket} of "${piece.name}" is shut`);
                }
            }
            const tallest = Math.max(0, ...rises);
            values.maxRiseMeters = Math.max(values.maxRiseMeters, tallest);
            if (tallest > player.stepHeightM + 0.001) {
                problems.push(`"${piece.name}" has a rise of ${tallest} m, and ${player.stepHeightM === 0 ? "this player climbs no steps" : `the player steps up ${player.stepHeightM} m`}`);
            }
            for (const ramp of ramps)
                values.maxRampDegrees = Math.max(values.maxRampDegrees, ramp.angleDegrees);
            const steep = ramps.filter((ramp) => !ramp.walkable);
            if (steep.length > 0)
                problems.push(`"${piece.name}" has a slope of ${steep[steep.length - 1].angleDegrees} degrees, and the player walks up ${player.walkableSlopeDeg}`);
        }
        // Floors on the two sides of a joint.
        for (const [at, a] of entries.entries()) {
            for (const b of entries.slice(at + 1)) {
                if (mateOf(kit, a.socket.type) !== b.socket.type || !canMeet(a.socket, b.socket))
                    continue;
                const floorA = floors.get(a.label);
                const floorB = floors.get(b.label);
                if (floorA === undefined || floorB === undefined)
                    continue;
                const step = round(Math.abs(floorA - floorB), 4);
                if (step > values.maxFloorStepMeters) {
                    values.maxFloorStepMeters = step;
                    if (step > player.stepHeightM + slack)
                        problems.push(`the floor at ${a.label} is ${step} m from the floor at ${b.label}`);
                }
            }
        }
        const ramps = values.pieces.reduce((total, piece) => total + piece.ramps.length, 0);
        if (problems.length > 0) {
            results.push({ id: "walkable", status: "fail", message: `Not walkable for ${player.name}: ${problems.slice(0, 4).join("; ")}${problems.length > 4 ? `; and ${problems.length - 4} more` : ""}.`, values });
        }
        else if (passages === 0 && ramps === 0) {
            results.push({ id: "walkable", status: "not-measured", message: "The kit has nothing said to be walked through.", reason: "No socket on a side is marked as a passage, and no piece has a slope large enough to stand on.", values });
        }
        else {
            const size = `a capsule ${round(player.capsuleRadiusM * 2, 3)} m wide and ${round(player.capsuleHeightM, 3)} m tall`;
            results.push({ id: "walkable", status: "pass", message: `The player (${size}) passes ${plural(passages, "passage")}, with rises of up to ${values.maxRiseMeters} m and slopes of up to ${values.maxRampDegrees} degrees.`, values });
        }
    }
    // Collision tiles.
    {
        const pairs = new Map();
        const withSockets = kit.pieces.filter((piece) => piece.sockets.length > 0);
        const without = withSockets.filter((piece) => geometry.get(piece.name).collision.length === 0).map((piece) => piece.name);
        const { types, empty, max } = seamTypes(kit, entries, (entry) => entry.collision, seamTolerance, pairs);
        const values = { toleranceSquareMeters: round(seamTolerance, 9), types, without, empty, maxMismatchSquareMeters: max };
        const failing = types.filter((type) => type.mismatchSquareMeters > seamTolerance);
        if (withSockets.length === 0) {
            results.push({ id: "collision-tiles", status: "not-measured", message: "The kit has no sockets.", reason: "No piece was given a socket, so no two pieces are said to meet.", values });
        }
        else if (without.length === withSockets.length) {
            results.push({ id: "collision-tiles", status: "not-measured", message: "The pieces bring no collision shapes.", reason: "The kit was written with collision set to none.", values });
        }
        else if (without.length > 0) {
            results.push({ id: "collision-tiles", status: "fail", message: `${plural(without.length, "piece has", "pieces have")} sockets and no collision shape, next to pieces that have one: ${without.join(", ")}.`, values });
        }
        else if (empty.length > 0) {
            results.push({ id: "collision-tiles", status: "fail", message: `No collision shape reaches the plane of ${plural(empty.length, "socket")}: ${empty.slice(0, 4).join(", ")}${empty.length > 4 ? ", ..." : ""}.`, values });
        }
        else if (failing.length > 0) {
            const worst = failing.reduce((a, b) => (b.mismatchSquareMeters > a.mismatchSquareMeters ? b : a));
            results.push({ id: "collision-tiles", status: "fail", message: `The collision at sockets of type "${worst.type}" does not meet flush: ${worst.worst.join(" and ")} differ by ${round(worst.mismatchSquareMeters, 6)} m2, a lip a moving body can catch on.`, values });
        }
        else if (types.every((type) => type.pairs === 0)) {
            results.push({ id: "collision-tiles", status: "not-measured", message: "No two sockets of the kit can meet.", reason: "Every socket type is used once, or only on sides that never face each other.", values });
        }
        else {
            results.push({ id: "collision-tiles", status: "pass", message: `The collision shapes at ${plural(types.reduce((total, type) => total + type.pairs, 0), "pair")} of sockets meet flush, to within ${round(seamTolerance, 6)} m2.`, values });
        }
    }
    const counts = { pass: 0, warn: 0, fail: 0, notMeasured: 0 };
    for (const result of results)
        counts[result.status === "not-measured" ? "notMeasured" : result.status] += 1;
    return {
        schema: 1,
        generator: GENERATOR,
        kit: kit.name,
        profile: kit.profile,
        grid,
        toleranceMeters: tolerance,
        player,
        kernel: kernel !== undefined,
        pieces: kit.pieces.length,
        status: counts.fail > 0 ? "fail" : counts.warn > 0 ? "warn" : "pass",
        counts,
        results,
        layouts,
    };
}
