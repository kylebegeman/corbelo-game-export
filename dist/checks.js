import { badOption, NO_DECOMPOSITION, notObject, refuse } from "./errors.js";
import { readGlb, readPack } from "./glb-read.js";
import { GENERATOR } from "./version.js";
/** Starting budgets. They are places to start from, not rules of any engine: pass your own with `budget`. */
export const ASSET_BUDGETS = {
    "small-prop": { maxTriangles: 2000, maxVertices: 4000, maxMaterialSlots: 2 },
    "large-prop": { maxTriangles: 10000, maxVertices: 20000, maxMaterialSlots: 4 },
    "kit-piece": { maxTriangles: 3000, maxVertices: 6000, maxMaterialSlots: 3 },
};
/** The longest side each class of asset is expected to have, in metres. Outside it, the size check warns. */
export const ASSET_SIZE_RANGES = {
    "small-prop": { minMeters: 0.05, maxMeters: 2 },
    "large-prop": { minMeters: 1, maxMeters: 30 },
    "kit-piece": { minMeters: 0.5, maxMeters: 12 },
};
export const DEFAULT_ASSET_CLASS = "small-prop";
// A message is read by a person, so it says an asset class, a pivot and a normal rule in words
// and not by the id an option takes.
const CLASS_WORDS = { "small-prop": "small prop", "large-prop": "large prop", "kit-piece": "kit piece" };
const PIVOT_WORDS = {
    "base-center": "the middle of the base",
    center: "the middle of the body",
    "min-corner": "the lowest corner of the box around the body",
    origin: "the origin the body was modelled around",
    point: "a point that was given",
};
/** The grid a pivot is checked against, in metres. */
export const DEFAULT_GRID_METERS = 1;
/** A lower detail level may move the outline by this share of the diagonal of the body before the check warns. */
export const DEFAULT_LOD_DEVIATION_SHARE = 0.05;
/** A triangle is a sliver when twice its area is under this share of its longest edge squared. */
export const SLIVER_AREA_RATIO = 0.01;
/** A vertex normal this many degrees from the face of a triangle it shades is worth a look. */
export const NORMAL_ANGLE_WARNING_DEGREES = 60;
/** The longer side of the picture openings are looked for in, in cells. */
export const OPENING_GRID_CELLS = 384;
/** A rise taller than this, in metres, is a ledge and not a step of a stair. */
export const STEP_MAX_RISE_METERS = 0.6;
/** Slopes from this many degrees are ramps. Flatter is a floor. */
export const RAMP_MIN_DEGREES = 2;
/** Slopes steeper than this many degrees are walls or roofs, not ramps. */
export const RAMP_MAX_DEGREES = 60;
/**
 * Each engine's own character, at the values a new one starts with. The README says which of
 * these numbers the engines' documentation states and which it does not.
 */
export const PLAYER_PROFILES = {
    godot4: {
        id: "godot4-character-body",
        name: "Godot 4 CharacterBody3D",
        origin: "built-in",
        engine: "godot",
        capsuleRadiusM: 0.5,
        capsuleHeightM: 2,
        stepHeightM: 0,
        walkableSlopeDeg: 45,
        jumpHeightM: 1.03,
        note: "A new CapsuleShape3D and CharacterBody3D. CharacterBody3D climbs no steps by itself. The jump is the editor's script template: 4.5 m/s against gravity of 9.8 m/s2.",
    },
    unity6: {
        id: "unity6-character-controller",
        name: "Unity 6 CharacterController",
        origin: "built-in",
        engine: "unity",
        capsuleRadiusM: 0.5,
        capsuleHeightM: 2,
        stepHeightM: 0.3,
        walkableSlopeDeg: 45,
        jumpHeightM: 1.5,
        note: "A new CharacterController component. The jump is the example script of CharacterController.Move.",
    },
    unreal5: {
        id: "unreal5-character",
        name: "Unreal Engine 5 Character",
        origin: "built-in",
        engine: "unreal",
        capsuleRadiusM: 0.34,
        capsuleHeightM: 1.76,
        stepHeightM: 0.45,
        walkableSlopeDeg: 44.765,
        jumpHeightM: 0.9,
        note: "A new Character: a capsule of radius 34 and half height 88, Max Step Height 45, Walkable Floor Angle 44.765, and a Jump Z Velocity of 420 against gravity of 980, all in Unreal units.",
    },
};
/** Every check, in the order the results come in. */
export const CHECK_IDS = [
    "size",
    "pivot",
    "triangles",
    "vertices",
    "shading",
    "clean-mesh",
    "material-slots",
    "collision",
    "detail-levels",
    "player-openings",
    "player-steps",
    "player-ramps",
];
const DEGREES = 180 / Math.PI;
export function round(value, digits = 6) {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale + 0;
}
export function plural(count, one, many = `${one}s`) {
    return `${count} ${count === 1 ? one : many}`;
}
/** A part of a message that has a template of its own: its text, and the key and values that rebuild it. */
export function part(text, key, values = {}) {
    return { key, values, text };
}
/** The texts of the parts of a message, with what stands between them. */
export function textOf(parts, between = ", ") {
    return parts.map((one) => one.text).join(between);
}
/** Adds what was counted to the parts of a message, when there is any of it. */
export function counted(parts, count, key, one, after = "", many) {
    if (count > 0)
        parts.push(part(`${plural(count, one, many)}${after}`, key, { count }));
}
/**
 * Gives the two functions that add a result to `results`. The checks come in the order of
 * `ids`, so what is added is the result of the next of them. `found` is what the check found:
 * with the id of the check it is the key of the message, `size.expected`. `unmeasured` adds a
 * result with nothing to judge and the reason why.
 */
export function adder(results, ids) {
    const add = (status, found, message, values, messageValues = {}, reason, reasonValues = {}) => {
        const id = ids[results.length];
        const messageKey = `${id}.${found}`;
        results.push({ id, status, message, messageKey, messageValues, ...(reason === undefined ? {} : { reason, reasonKey: `${messageKey}.reason`, reasonValues }), values });
    };
    const unmeasured = (found, message, reason, values, reasonValues, messageValues) => add("not-measured", found, message, values, messageValues, reason, reasonValues);
    return { add, unmeasured };
}
/**
 * What would bring a collision shape nearer, for a body whose shape was left to be chosen and came
 * out past the tolerance. It reads what was tried, so it never asks for what was already given.
 */
function nearer(name, collision, settings) {
    const maxPieces = collision.maxPieces ?? settings?.maxPieces;
    const say = (found, text, values) => part(text, `collision.nearer.${found}`, values);
    const refused = collision.notes.find((note) => note.startsWith(NO_DECOMPOSITION));
    if (refused !== undefined) {
        const why = refused.slice(NO_DECOMPOSITION.length);
        return say("refused", ` A kernel was given, but no convex decomposition was made. ${why}`, { why });
    }
    const given = collision.tried.some((tier) => tier.shape === "pieces") ? 1 : 0;
    const cut = collision.tried.find((tier) => tier.shape === "decomposition");
    if (cut !== undefined) {
        const into = ` "${name}" was cut into ${plural(cut.pieces, "convex piece")}`;
        const values = { name, pieces: cut.pieces, given };
        if (maxPieces !== undefined && cut.pieces >= maxPieces) {
            return say("most", `${into}, the most allowed. ${given ? "More pieces" : "More pieces, or the pieces the part was built from,"} would bring it nearer.`, values);
        }
        return say("cut", `${into}, and no further cut that fits brought it nearer.${given ? "" : " The pieces the part was built from would."}`, values);
    }
    if (settings?.kernel === true)
        return given ? "" : say("pieces", " The pieces the part was built from would bring it nearer.");
    return say("kernel", given ? " A solid kernel to cut it into convex pieces would bring it nearer." : " The pieces the part was built from, or a solid kernel to cut it into convex pieces, would bring it nearer.", { given });
}
/** Vertices that share a place, counted as one: the number of each vertex's place. */
function placesOf(positions) {
    const numberOf = new Map();
    const place = new Uint32Array(positions.length / 3);
    for (let vertex = 0; vertex < place.length; vertex += 1) {
        const key = `${positions[vertex * 3] + 0},${positions[vertex * 3 + 1] + 0},${positions[vertex * 3 + 2] + 0}`;
        let number = numberOf.get(key);
        if (number === undefined) {
            number = numberOf.size;
            numberOf.set(key, number);
        }
        place[vertex] = number;
    }
    return { place, places: numberOf.size };
}
/** Reads edges, slivers and normals off one body as it is in the file. */
function topologyOf(body) {
    const { positions, normals, indices } = body;
    const { place, places } = placesOf(positions);
    const hasNormals = normals.length === positions.length;
    // Per edge between two places: how often it is used each way, and the first use's two vertices.
    const edges = new Map();
    let sliverTriangles = 0;
    let backFacingNormals = 0;
    let leastDot = 1;
    let six = 0;
    for (let t = 0; t < indices.length; t += 3) {
        const corner = [indices[t], indices[t + 1], indices[t + 2]];
        const [a, b, c] = corner.map((vertex) => vertex * 3);
        const abx = positions[b] - positions[a];
        const aby = positions[b + 1] - positions[a + 1];
        const abz = positions[b + 2] - positions[a + 2];
        const acx = positions[c] - positions[a];
        const acy = positions[c + 1] - positions[a + 1];
        const acz = positions[c + 2] - positions[a + 2];
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        const twiceArea = Math.hypot(nx, ny, nz);
        const longest = Math.max(abx * abx + aby * aby + abz * abz, acx * acx + acy * acy + acz * acz, (acx - abx) ** 2 + (acy - aby) ** 2 + (acz - abz) ** 2);
        if (twiceArea < SLIVER_AREA_RATIO * longest)
            sliverTriangles += 1;
        six += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) +
            positions[a + 1] * (positions[b + 2] * positions[c] - positions[b] * positions[c + 2]) +
            positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
        if (hasNormals && twiceArea > 0) {
            for (const at of [a, b, c]) {
                const dot = (normals[at] * nx + normals[at + 1] * ny + normals[at + 2] * nz) / twiceArea;
                if (dot <= 0)
                    backFacingNormals += 1;
                if (dot < leastDot)
                    leastDot = dot;
            }
        }
        for (let k = 0; k < 3; k += 1) {
            const from = corner[k];
            const to = corner[(k + 1) % 3];
            const low = Math.min(place[from], place[to]);
            const high = Math.max(place[from], place[to]);
            if (low === high)
                continue;
            const key = low * places + high;
            const forward = place[from] === low;
            const edge = edges.get(key);
            if (edge === undefined) {
                edges.set(key, { forward: forward ? 1 : 0, backward: forward ? 0 : 1, from: forward ? from : to, to: forward ? to : from, hard: false });
                continue;
            }
            if (forward)
                edge.forward += 1;
            else
                edge.backward += 1;
            // The second triangle on the edge: hard when a normal differs at either end.
            if (hasNormals) {
                const ends = [[edge.from, forward ? from : to], [edge.to, forward ? to : from]];
                for (const [first, second] of ends) {
                    const dot = normals[first * 3] * normals[second * 3] + normals[first * 3 + 1] * normals[second * 3 + 1] + normals[first * 3 + 2] * normals[second * 3 + 2];
                    if (dot < 1 - 1e-6)
                        edge.hard = true;
                }
            }
        }
    }
    const out = {
        hardEdges: 0,
        softEdges: 0,
        openEdges: 0,
        nonManifoldEdges: 0,
        flippedEdges: 0,
        sliverTriangles,
        backFacingNormals,
        maxNormalAngle: Math.acos(Math.max(-1, Math.min(1, leastDot))) * DEGREES,
        insideOut: false,
    };
    for (const edge of edges.values()) {
        const uses = edge.forward + edge.backward;
        if (uses === 1)
            out.openEdges += 1;
        else if (uses > 2)
            out.nonManifoldEdges += 1;
        else {
            if (edge.forward !== 1)
                out.flippedEdges += 1;
            if (edge.hard)
                out.hardEdges += 1;
            else
                out.softEdges += 1;
        }
    }
    out.insideOut = out.openEdges === 0 && out.nonManifoldEdges === 0 && out.flippedEdges === 0 && six < 0;
    return out;
}
/**
 * For every cell of a picture, the distance to the nearest solid cell, in cells, squared.
 * Exact, by the lower envelope of parabolas along rows and then along columns.
 */
function distanceSquared(solid, columns, rows) {
    const far = (columns + rows) ** 2;
    const out = new Float64Array(columns * rows);
    for (let at = 0; at < out.length; at += 1)
        out[at] = solid[at] === 1 ? 0 : far;
    const longest = Math.max(columns, rows);
    const line = new Float64Array(longest);
    const lowest = new Int32Array(longest);
    const from = new Float64Array(longest + 1);
    const pass = (start, step, length) => {
        for (let n = 0; n < length; n += 1)
            line[n] = out[start + n * step];
        let last = 0;
        lowest[0] = 0;
        from[0] = -Infinity;
        from[1] = Infinity;
        for (let n = 1; n < length; n += 1) {
            let meets;
            for (;;) {
                const other = lowest[last];
                meets = (line[n] + n * n - (line[other] + other * other)) / (2 * n - 2 * other);
                if (meets > from[last])
                    break;
                last -= 1;
            }
            last += 1;
            lowest[last] = n;
            from[last] = meets;
            from[last + 1] = Infinity;
        }
        last = 0;
        for (let n = 0; n < length; n += 1) {
            while (from[last + 1] < n)
                last += 1;
            const other = lowest[last];
            out[start + n * step] = (n - other) ** 2 + line[other];
        }
    };
    for (let row = 0; row < rows; row += 1)
        pass(row * columns, 1, columns);
    for (let column = 0; column < columns; column += 1)
        pass(column, columns, rows);
    return out;
}
/**
 * Looks along one level axis for openings that are closed over the top: doorways, arches,
 * windows, tunnels. The asset is drawn as a filled outline on a grid, standing on a floor at
 * its lowest point, and each free region the outline shuts in is one opening.
 */
export function openingsAlong(bodies, axis, min, max, player) {
    const across = axis === "x" ? 2 : 0;
    const width = max[across] - min[across];
    const height = max[1] - min[1];
    const cell = Math.max(width, height) / OPENING_GRID_CELLS;
    if (!(cell > 0) || !(width > 0) || !(height > 0))
        return { cell: 0, openings: [], ignored: 0 };
    // One free column on each side and one free row on top stand for the open air around the
    // asset. Row 0 is the floor.
    const columns = Math.ceil(width / cell - 1e-9) + 2;
    const rows = Math.ceil(height / cell - 1e-9) + 2;
    const solid = new Uint8Array(columns * rows);
    solid.fill(1, 0, columns);
    const mark = (gx, gy) => {
        const column = Math.min(columns - 2, Math.max(1, Math.floor(gx)));
        const row = Math.min(rows - 2, Math.max(1, Math.floor(gy)));
        solid[row * columns + column] = 1;
    };
    for (const { indices, positions } of bodies) {
        for (let t = 0; t < indices.length; t += 3) {
            const xs = [];
            const ys = [];
            for (let k = 0; k < 3; k += 1) {
                xs.push((positions[indices[t + k] * 3 + across] - min[across]) / cell + 1);
                ys.push((positions[indices[t + k] * 3 + 1] - min[1]) / cell + 1);
            }
            // The inside: every cell whose middle the triangle covers, a row at a time.
            const firstRow = Math.max(1, Math.ceil(Math.min(ys[0], ys[1], ys[2]) - 0.5));
            const lastRow = Math.min(rows - 2, Math.floor(Math.max(ys[0], ys[1], ys[2]) - 0.5));
            for (let row = firstRow; row <= lastRow; row += 1) {
                const y = row + 0.5;
                let left = Infinity;
                let right = -Infinity;
                for (let k = 0; k < 3; k += 1) {
                    const y0 = ys[k];
                    const y1 = ys[(k + 1) % 3];
                    if (y0 === y1 || y < Math.min(y0, y1) || y > Math.max(y0, y1))
                        continue;
                    const x = xs[k] + ((y - y0) / (y1 - y0)) * (xs[(k + 1) % 3] - xs[k]);
                    if (x < left)
                        left = x;
                    if (x > right)
                        right = x;
                }
                const firstColumn = Math.max(1, Math.ceil(left - 0.5));
                const lastColumn = Math.min(columns - 2, Math.floor(right - 0.5));
                for (let column = firstColumn; column <= lastColumn; column += 1)
                    solid[row * columns + column] = 1;
            }
            // The outline: thin parts, seen edge on, cover no middle of a cell but still shut a region in.
            for (let k = 0; k < 3; k += 1) {
                const dx = xs[(k + 1) % 3] - xs[k];
                const dy = ys[(k + 1) % 3] - ys[k];
                const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2));
                for (let step = 0; step <= steps; step += 1)
                    mark(xs[k] + (dx * step) / steps, ys[k] + (dy * step) / steps);
            }
        }
    }
    // Free regions. One that reaches a side column or the top row is the open air.
    const region = new Int32Array(columns * rows).fill(-1);
    const found = [];
    const stack = [];
    for (let seed = 0; seed < solid.length; seed += 1) {
        if (solid[seed] === 1 || region[seed] !== -1)
            continue;
        const current = { cells: [], outside: false };
        region[seed] = found.length;
        stack.push(seed);
        while (stack.length > 0) {
            const at = stack.pop();
            current.cells.push(at);
            const column = at % columns;
            const row = (at - column) / columns;
            if (column === 0 || column === columns - 1 || row === rows - 1)
                current.outside = true;
            for (const next of [column > 0 ? at - 1 : -1, column < columns - 1 ? at + 1 : -1, row > 0 ? at - columns : -1, row < rows - 1 ? at + columns : -1]) {
                if (next >= 0 && solid[next] === 0 && region[next] === -1) {
                    region[next] = found.length;
                    stack.push(next);
                }
            }
        }
        found.push(current);
    }
    const distance = distanceSquared(solid, columns, rows);
    const radius = player.capsuleRadiusM;
    const tall = Math.max(player.capsuleHeightM, radius * 2);
    // The capsule is a line up its middle with the radius around it. Edges drawn on the line
    // between two cells take a cell from the free side, so one cell is given back.
    const needed = Math.max(0, radius / cell - 1);
    const reach = Math.max(1, Math.round((tall - radius * 2) / cell));
    const openings = [];
    let ignored = 0;
    for (const [number, { cells, outside }] of found.entries()) {
        if (outside)
            continue;
        let low = Infinity;
        let high = -Infinity;
        let left = Infinity;
        let right = -Infinity;
        for (const at of cells) {
            const column = at % columns;
            const row = (at - column) / columns;
            if (row < low)
                low = row;
            if (row > high)
                high = row;
            if (column < left)
                left = column;
            if (column > right)
                right = column;
        }
        const widthMeters = (right - left + 1) * cell;
        const heightMeters = (high - low + 1) * cell;
        if (widthMeters < radius || heightMeters < tall / 2) {
            ignored += 1;
            continue;
        }
        // The lowest place the line up the capsule's middle fits, in any column of the region.
        let standing = Infinity;
        for (let column = left; column <= right; column += 1) {
            let run = 0;
            for (let row = low; row <= high; row += 1) {
                const at = row * columns + column;
                run = region[at] === number && Math.sqrt(distance[at]) >= needed ? run + 1 : 0;
                if (run >= reach) {
                    standing = Math.min(standing, row - run + 1);
                    break;
                }
            }
        }
        const fits = Number.isFinite(standing);
        // The bottom of the capsule is one radius under the low end of the line up its middle.
        let sill = fits ? (standing - 0.5) * cell - radius : (low - 1) * cell;
        if (sill < cell * 1.5)
            sill = 0;
        openings.push({ axis, widthMeters: round(widthMeters, 4), heightMeters: round(heightMeters, 4), sillMeters: round(sill, 4), fits, walkIn: fits && sill <= player.stepHeightM + cell });
    }
    return { cell, openings, ignored };
}
/** Flat places and slopes a player could stand on, read off the triangles that face up. */
export function walkable(bodies, floor, player) {
    const leastArea = (player.capsuleRadiusM * player.capsuleRadiusM) / 2;
    const flat = new Map();
    const slopes = [];
    const flatDot = Math.cos(RAMP_MIN_DEGREES / DEGREES);
    const steepDot = Math.cos(RAMP_MAX_DEGREES / DEGREES);
    for (const { indices, positions } of bodies) {
        for (let t = 0; t < indices.length; t += 3) {
            const a = indices[t] * 3;
            const b = indices[t + 1] * 3;
            const c = indices[t + 2] * 3;
            const abx = positions[b] - positions[a];
            const aby = positions[b + 1] - positions[a + 1];
            const abz = positions[b + 2] - positions[a + 2];
            const acx = positions[c] - positions[a];
            const acy = positions[c + 1] - positions[a + 1];
            const acz = positions[c + 2] - positions[a + 2];
            let nx = aby * acz - abz * acy;
            let ny = abz * acx - abx * acz;
            let nz = abx * acy - aby * acx;
            const twice = Math.hypot(nx, ny, nz);
            if (!(twice > 0))
                continue;
            nx /= twice;
            ny /= twice;
            nz /= twice;
            if (ny >= flatDot) {
                // Levels are kept to the millimetre.
                const level = Math.round(((positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3 - floor) * 1000);
                flat.set(level, (flat.get(level) ?? 0) + twice / 2);
            }
            else if (ny >= steepDot) {
                // Slopes on one plane count as one: normals within a degree and planes within 5 mm.
                const d = nx * positions[a] + ny * positions[a + 1] + nz * positions[a + 2];
                const same = slopes.find((slope) => slope.nx * nx + slope.ny * ny + slope.nz * nz > 0.99985 && Math.abs(slope.d - d) < 0.005);
                if (same !== undefined)
                    same.area += twice / 2;
                else
                    slopes.push({ nx, ny, nz, d, area: twice / 2 });
            }
        }
    }
    // Levels a millimetre or two apart are one level.
    const heights = [...flat.keys()].sort((p, q) => p - q);
    const levels = [];
    let area = 0;
    let start = 0;
    for (let at = 0; at <= heights.length; at += 1) {
        if (at < heights.length && (at === start || heights[at] - heights[at - 1] <= 2)) {
            area += flat.get(heights[at]);
            continue;
        }
        if (area >= leastArea)
            levels.push(heights[start] / 1000);
        if (at < heights.length) {
            start = at;
            area = flat.get(heights[at]);
        }
    }
    const ramps = slopes
        .filter((slope) => slope.area >= leastArea)
        .map((slope) => {
        const angleDegrees = round(Math.acos(Math.max(-1, Math.min(1, slope.ny))) * DEGREES, 3);
        return { angleDegrees, areaSquareMeters: round(slope.area, 6), walkable: angleDegrees <= player.walkableSlopeDeg + 0.01 };
    })
        .sort((p, q) => p.angleDegrees - q.angleDegrees || q.areaSquareMeters - p.areaSquareMeters);
    return { levels, ramps };
}
/** What a player is called in a message and in the values of a check: its name, or its id when it was given none. */
export function playerName(player) {
    return typeof player.name === "string" && player.name.trim() !== "" ? player.name : player.id;
}
/** The player a check is run for: a profile of the caller's own, a built-in one by engine profile id, or the player of the engine a file was written for. */
export function resolvePlayer(option, profile) {
    let player;
    if (option === undefined) {
        // The player of the engine the file was written for. A custom profile gets Godot's, the default profile's.
        player = Object.hasOwn(PLAYER_PROFILES, profile) ? PLAYER_PROFILES[profile] : PLAYER_PROFILES.godot4;
    }
    else if (typeof option === "string") {
        if (!Object.hasOwn(PLAYER_PROFILES, option))
            badOption(`Unknown player "${option}". Built-in players go by engine profile: ${Object.keys(PLAYER_PROFILES).join(", ")}.`);
        player = PLAYER_PROFILES[option];
    }
    else {
        player = option;
        if (notObject(player) || typeof player.id !== "string" || player.id === "")
            badOption("A player profile needs an id.");
        for (const key of ["capsuleRadiusM", "capsuleHeightM"]) {
            if (!(Number.isFinite(player[key]) && player[key] > 0))
                badOption(`Player "${player.id}": ${key} must be a positive number of metres.`);
        }
        for (const key of ["stepHeightM", "jumpHeightM"]) {
            if (!(Number.isFinite(player[key]) && player[key] >= 0))
                badOption(`Player "${player.id}": ${key} must be zero or a positive number of metres.`);
        }
        if (!(Number.isFinite(player.walkableSlopeDeg) && player.walkableSlopeDeg >= 0 && player.walkableSlopeDeg <= 90)) {
            badOption(`Player "${player.id}": walkableSlopeDeg must be from 0 to 90 degrees.`);
        }
    }
    return player;
}
function readOptions(options, facts) {
    if (notObject(options))
        badOption("Check options must be an object.");
    const assetClass = options.assetClass ?? DEFAULT_ASSET_CLASS;
    if (!Object.hasOwn(ASSET_BUDGETS, assetClass))
        badOption(`assetClass must be one of ${Object.keys(ASSET_BUDGETS).map((name) => `"${name}"`).join(", ")}. Got ${JSON.stringify(assetClass)}.`);
    const budget = { ...ASSET_BUDGETS[assetClass] };
    if (options.budget !== undefined) {
        if (notObject(options.budget))
            badOption("budget must be { maxTriangles, maxVertices, maxMaterialSlots }, each optional.");
        for (const key of ["maxTriangles", "maxVertices", "maxMaterialSlots"]) {
            const value = options.budget[key];
            if (value === undefined)
                continue;
            if (!(Number.isInteger(value) && value >= 1))
                badOption(`budget.${key} must be a whole number of at least 1. Got ${String(value)}.`);
            budget[key] = value;
        }
    }
    const player = resolvePlayer(options.player, facts.profile);
    const gridMeters = options.gridMeters ?? DEFAULT_GRID_METERS;
    if (!(Number.isFinite(gridMeters) && gridMeters > 0))
        badOption(`gridMeters must be a positive number of metres. Got ${String(gridMeters)}.`);
    const lodDeviationShare = options.lodDeviationShare ?? DEFAULT_LOD_DEVIATION_SHARE;
    if (!(Number.isFinite(lodDeviationShare) && lodDeviationShare >= 0))
        badOption(`lodDeviationShare must be zero or a positive share. Got ${String(lodDeviationShare)}.`);
    if (options.collisionTolerance !== undefined && !(Number.isFinite(options.collisionTolerance) && options.collisionTolerance >= 0)) {
        badOption(`collisionTolerance must be zero or a positive share. Got ${String(options.collisionTolerance)}.`);
    }
    return { assetClass, budget, player, gridMeters, lodDeviationShare };
}
/** Units a size can be mixed up by, and what the mix-up is. */
const UNIT_MIXUPS = [
    [0.001, "millimetres", "metres"],
    [1000, "metres", "millimetres"],
    [0.01, "centimetres", "metres"],
    [100, "metres", "centimetres"],
    [0.0254, "inches", "metres"],
    [1 / 0.0254, "metres", "inches"],
];
/**
 * Checks a GLB this package wrote against what a game needs of it, and returns one result for
 * every check: pass, warn, fail, or not measured with the reason, each with the numbers it was
 * judged by. Nothing is thrown for an asset that fails a check, only for a file that cannot be
 * read or was not written by this package.
 *
 * Everything is measured from the file: the triangles as written and the facts stored with them.
 */
export function checkGameAsset(glb, options = {}) {
    const pack = readPack(glb instanceof Uint8Array ? readGlb(glb) : glb);
    const { facts } = pack;
    if (facts === null)
        refuse("BAD_GLB", "This GLB has no facts in its scene extras, so it was not written by this package and cannot be checked.");
    const { assetClass, budget, player, gridMeters, lodDeviationShare } = readOptions(options, facts);
    const expect = options.expect ?? {};
    const results = [];
    const { add, unmeasured } = adder(results, CHECK_IDS);
    const kind = CLASS_WORDS[assetClass];
    const unit = facts.engine.unit;
    const scene = pack.bodies.map((body, at) => {
        const positions = new Float64Array(body.positions.length);
        for (let n = 0; n < positions.length; n += 1)
            positions[n] = body.positions[n] + body.translation[n % 3];
        return { name: facts.bodies[at]?.name ?? body.name, body, positions, indices: body.indices };
    });
    // Size.
    {
        const { meters, engine } = facts.total.bounds;
        const range = ASSET_SIZE_RANGES[assetClass];
        const largestMeters = Math.max(...meters.size);
        const values = { meters: meters.size, engine: engine.size, unit, largestMeters, expectedMeters: [range.minMeters, range.maxMeters], suggestedScale: null };
        const longest = round(Math.max(...engine.size), 3);
        const said = { longest, unit, assetClass };
        const text = `The asset is ${longest} ${unit} on its longest side, `;
        if (largestMeters >= range.minMeters && largestMeters <= range.maxMeters) {
            add("pass", "expected", `${text}a size a ${kind} has.`, values, said);
        }
        else {
            // A mix-up of units is offered when it would land the size nearest the middle of the range.
            const middle = Math.sqrt(range.minMeters * range.maxMeters);
            let best;
            for (const mixup of UNIT_MIXUPS) {
                const scaled = largestMeters * mixup[0];
                if (scaled < range.minMeters || scaled > range.maxMeters)
                    continue;
                if (best === undefined || Math.abs(Math.log(scaled / middle)) < Math.abs(Math.log((largestMeters * best[0]) / middle)))
                    best = mixup;
            }
            const expected = `${text}and a ${kind} is expected to be from ${range.minMeters} to ${range.maxMeters} m.`;
            const outside = { ...said, min: range.minMeters, max: range.maxMeters };
            if (best === undefined) {
                add("warn", "unexpected", expected, values, outside);
            }
            else {
                const scale = round(best[0], 6);
                values.suggestedScale = scale;
                add("warn", "units", `${expected} This looks like ${best[1]} read as ${best[2]}: a scale of ${scale} would fit.`, values, { ...outside, read: best[1], as: best[2], scale });
            }
        }
    }
    // Pivot.
    {
        const values = { gridMeters, bodies: [] };
        let offGrid = 0;
        let farOut = 0;
        for (const body of facts.bodies) {
            const { min, max, size } = body.localBounds.meters;
            const tolerance = 1e-4;
            const inside = [0, 1, 2].every((axis) => min[axis] <= tolerance && max[axis] >= -tolerance);
            let onGrid = true;
            for (let axis = 0; axis < 3; axis += 1) {
                if (size[axis] < gridMeters - tolerance)
                    continue;
                // Whole grid steps from the low face, or from the high face.
                const fromLow = -min[axis] / gridMeters;
                const fromHigh = max[axis] / gridMeters;
                if (Math.abs(fromLow - Math.round(fromLow)) * gridMeters > tolerance && Math.abs(fromHigh - Math.round(fromHigh)) * gridMeters > tolerance)
                    onGrid = false;
            }
            const away = Math.hypot(...[0, 1, 2].map((axis) => Math.max(min[axis], 0, -max[axis])));
            if (!onGrid)
                offGrid += 1;
            if (away > Math.max(...size))
                farOut += 1;
            values.bodies.push({ name: body.name, mode: body.pivot.mode, meters: body.translation, fromMinCorner: [round(-min[0]), round(-min[1]), round(-min[2])], inside, onGrid });
        }
        const first = values.bodies[0];
        if (assetClass === "kit-piece" && offGrid > 0) {
            add("fail", "off-grid", `${plural(offGrid, "body has", "bodies have")} a pivot off the ${gridMeters} m grid, so the kit piece will not snap into place.`, values, { count: offGrid, grid: gridMeters });
        }
        else if (farOut > 0) {
            add("warn", "far", `${plural(farOut, "body has", "bodies have")} a pivot further from the body than the body is long.`, values, { count: farOut });
        }
        else if (first === undefined) {
            add("pass", "none", "There are no bodies.", values);
        }
        else if (values.bodies.every((body) => body.mode === first.mode)) {
            // Bodies with the same pivot are said as one. A body with a pivot of its own gets every body named.
            add("pass", "same", `The pivot is at ${PIVOT_WORDS[first.mode]}${offGrid === 0 ? `, on the ${gridMeters} m grid` : ""}.`, values, { mode: first.mode, offGrid, grid: gridMeters });
        }
        else {
            const bodies = values.bodies.map((body) => part(`"${body.name}" at ${PIVOT_WORDS[body.mode]}`, "pivot.body", { name: body.name, mode: body.mode }));
            add("pass", "own", `Each body has a pivot of its own: ${textOf(bodies)}${offGrid === 0 ? `. All are on the ${gridMeters} m grid` : ""}.`, values, { bodies, offGrid, grid: gridMeters });
        }
    }
    // Triangles, vertices and material slots against the budget.
    {
        const count = (id, limit, pick) => {
            const values = { count: facts.bodies.reduce((total, body) => total + pick(body), 0), budget: limit, bodies: facts.bodies.map((body) => ({ name: body.name, count: pick(body) })) };
            const over = values.count > limit;
            const what = id === "triangles" ? "triangles" : "vertices after hard edges split";
            add(over ? "fail" : "pass", "budget", `${values.count} ${what}, against a budget of ${limit} for a ${kind}.`, values, { count: values.count, budget: limit, assetClass });
        };
        count("triangles", budget.maxTriangles, (body) => body.triangles);
        count("vertices", budget.maxVertices, (body) => body.vertices);
    }
    // Shading and clean mesh, both read off the triangles in the file.
    const topologies = pack.bodies.map(topologyOf);
    {
        const total = (pick) => topologies.reduce((sum, topology) => sum + pick(topology), 0);
        const shading = {
            normals: facts.settings.normals,
            creaseAngle: facts.settings.creaseAngle,
            hardEdges: total((topology) => topology.hardEdges),
            softEdges: total((topology) => topology.softEdges),
            backFacingNormals: total((topology) => topology.backFacingNormals),
            maxNormalAngle: round(Math.max(0, ...topologies.map((topology) => topology.maxNormalAngle)), 3),
        };
        const byFace = shading.normals === "face-weighted";
        const edges = `${plural(shading.hardEdges, "hard edge")} and ${plural(shading.softEdges, "soft edge")}. Normals are weighted by ${byFace ? "the whole flat face each triangle belongs to" : "the area and angle of each triangle"}.`;
        const said = { hard: shading.hardEdges, soft: shading.softEdges, normals: shading.normals };
        if (pack.bodies.some((body) => body.normals.length !== body.positions.length)) {
            add("fail", "no-normals", "A body has no normals.", shading);
        }
        else if (shading.backFacingNormals > 0) {
            add("fail", "back-facing", `${plural(shading.backFacingNormals, "corner has", "corners have")} a normal that points away from its own triangle.`, shading, { count: shading.backFacingNormals });
        }
        else if (shading.maxNormalAngle > NORMAL_ANGLE_WARNING_DEGREES) {
            add("warn", "wide", `A normal is ${shading.maxNormalAngle} degrees from the face it shades, over ${NORMAL_ANGLE_WARNING_DEGREES}. A lower crease angle would make that edge hard. ${edges}`, shading, { angle: shading.maxNormalAngle, limit: NORMAL_ANGLE_WARNING_DEGREES, ...said });
        }
        else {
            add("pass", "edges", `${edges}${byFace ? "" : " Weighting by the whole flat face is there to ask for."}`, shading, said);
        }
        const clean = {
            degenerateTrianglesDropped: facts.total.degenerateTrianglesDropped,
            sliverTriangles: total((topology) => topology.sliverTriangles),
            flippedEdges: total((topology) => topology.flippedEdges),
            insideOutBodies: total((topology) => (topology.insideOut ? 1 : 0)),
            openEdges: total((topology) => topology.openEdges),
            nonManifoldEdges: total((topology) => topology.nonManifoldEdges),
        };
        // Faces that point the wrong way are drawn wrong, so they fail. The rest still draws: it warns.
        const found = [];
        counted(found, clean.flippedEdges, "clean-mesh.flipped", "edge", " between faces that point opposite ways");
        counted(found, clean.insideOutBodies, "clean-mesh.inside-out", "body", " turned inside out", "bodies");
        const wrong = found.length > 0;
        counted(found, clean.nonManifoldEdges, "clean-mesh.non-manifold", "edge", " shared by more than two triangles");
        counted(found, clean.openEdges, "clean-mesh.open", "open edge");
        counted(found, clean.sliverTriangles, "clean-mesh.slivers", "sliver triangle");
        counted(found, clean.degenerateTrianglesDropped, "clean-mesh.dropped", "triangle", " with no area left out");
        if (found.length > 0)
            add(wrong ? "fail" : "warn", "found", `The mesh has ${textOf(found)}.`, clean, { found });
        else
            add("pass", "clean", "Every body is closed, faces outwards and has no sliver triangles.", clean);
    }
    {
        const values = {
            count: Math.max(0, ...facts.bodies.map((body) => body.materialSlots)),
            budget: budget.maxMaterialSlots,
            fileMaterials: facts.total.materialSlots,
            bodies: facts.bodies.map((body) => ({ name: body.name, count: body.materialSlots })),
        };
        add(values.count > values.budget ? "fail" : "pass", "budget", `${plural(values.count, "material slot")} on the body with the most, against a budget of ${values.budget} for a ${kind}.`, values, {
            count: values.count,
            budget: values.budget,
            assetClass,
        });
    }
    // Collision.
    {
        const tolerance = options.collisionTolerance ?? facts.settings.collision?.tolerance ?? 0.05;
        const values = {
            tolerance,
            bodies: facts.bodies.map((body) => {
                const error = body.collision?.volume.error ?? null;
                const requested = body.collision?.requested ?? "none";
                const shape = body.collision?.shape ?? "none";
                const allowed = options.collisionTolerance ?? body.collision?.tolerance ?? tolerance;
                const within = error === null ? null : Math.abs(error) <= allowed;
                // A shape the caller named is the caller's choice, and only worth a warning. One that
                // was settled for because nothing nearer could be built is a failure. A body left
                // without a shape on purpose is as it was asked for.
                const status = shape === "none" ? (body.collision !== undefined && requested === "none" ? "pass" : "warn") : within === null ? "not-measured" : within ? "pass" : requested === "auto" ? "fail" : "warn";
                return { name: body.name, requested, shape, pieces: body.collision?.pieces ?? 0, error, withinTolerance: within, tolerance: allowed, status };
            }),
        };
        const without = values.bodies.filter((body) => body.shape === "none" && body.status !== "pass");
        const beyond = values.bodies.filter((body) => body.withinTolerance === false);
        const unknown = values.bodies.filter((body) => body.status === "not-measured");
        const factsOf = (body) => facts.bodies[values.bodies.indexOf(body)];
        if (values.bodies.every((body) => body.shape === "none")) {
            unmeasured("none", "The file has no collision shape.", "No collision was written with the file. Write it again with a collision shape to have it measured.", values);
        }
        else if (beyond.length > 0) {
            // The body that fails is said before one that only warns, and of those the furthest out.
            const chosen = beyond.every((body) => body.status === "warn");
            const worst = beyond.filter((body) => chosen || body.status === "fail").reduce((a, b) => (Math.abs(b.error) > Math.abs(a.error) ? b : a));
            const advice = chosen ? "" : nearer(worst.name, factsOf(worst).collision, facts.settings.collision);
            const percent = round(Math.abs(worst.error) * 100, 1);
            const direction = worst.error > 0 ? "more" : "less";
            const allowed = round(worst.tolerance * 100, 1);
            add(chosen ? "warn" : "fail", "beyond", `The collision of "${worst.name}" (${worst.shape}, ${plural(worst.pieces, "piece")}) is ${percent}% ${direction} volume than the visible part, over the ${allowed}% allowed.${advice && advice.text}`, values, { name: worst.name, shape: worst.shape, pieces: worst.pieces, percent, direction, allowed, advice });
        }
        else if (without.length > 0) {
            add("warn", "missing", `${plural(without.length, "body has", "bodies have")} no collision shape.`, values, { count: without.length });
        }
        else if (unknown.length > 0) {
            const names = unknown.map((body) => body.name);
            const quoted = names.map((name) => `"${name}"`).join(", ");
            const why = unknown.map((body) => {
                const edges = [];
                counted(edges, factsOf(body).openEdges, "clean-mesh.open", "open edge");
                counted(edges, factsOf(body).nonManifoldEdges, "clean-mesh.non-manifold", "edge", " shared by more than two triangles");
                return edges.length > 0
                    ? part(`"${body.name}" has ${textOf(edges, " and ")}`, "collision.has-edges", { name: body.name, edges })
                    : part(`"${body.name}" is closed with its faces pointing inwards`, "collision.faces-inwards", { name: body.name });
            });
            const inwards = why.every((one) => one.key === "collision.faces-inwards");
            const count = names.length;
            const one = count === 1;
            unmeasured(inwards ? "inwards" : "open", `A collision shape was written, but ${quoted} ${inwards ? `${one ? "encloses" : "enclose"} no volume` : `${one ? "is" : "are"} not closed`}.`, `${textOf(why, ", and ")}, so ${one ? "it encloses" : "they enclose"} no volume to compare the collision volume with. ${inwards ? "Turn the faces to point outwards" : "Close the mesh"} to have its collision measured.`, values, { why, count }, { names, count });
        }
        else {
            const pieces = values.bodies.reduce((total, body) => total + body.pieces, 0);
            const shares = new Set(values.bodies.filter((body) => body.shape !== "none").map((body) => body.tolerance));
            const percent = round([...shares][0] * 100, 1);
            if (shares.size > 1)
                add("pass", "within-each", `Collision in ${plural(pieces, "convex piece")}, each body within the share of its visible volume allowed for it.`, values, { pieces });
            else
                add("pass", "within", `Collision in ${plural(pieces, "convex piece")}, within ${percent}% of the visible volume.`, values, { pieces, percent });
        }
    }
    // Detail levels.
    {
        const values = {
            maxDeviationShare: lodDeviationShare,
            bodies: facts.bodies
                .filter((body) => body.lods !== undefined)
                .map((body) => ({
                name: body.name,
                levels: body.lods.map((level) => ({
                    level: level.level,
                    triangles: level.triangles,
                    vertices: level.vertices,
                    openEdges: level.openEdges + level.nonManifoldEdges,
                    deviationMeters: level.deviation.meters,
                    deviationShare: level.deviation.share,
                })),
            })),
        };
        const problems = [];
        const notes = [];
        for (const body of values.bodies) {
            for (const [at, level] of body.levels.entries()) {
                if (at === 0)
                    continue;
                const above = body.levels[at - 1].level;
                const say = (parts, found, text, more) => {
                    parts.push(part(`level ${level.level} of "${body.name}" ${text}`, `detail-levels.${found}`, { level: level.level, name: body.name, ...more }));
                };
                if (level.triangles > body.levels[at - 1].triangles)
                    say(problems, "more", `has more triangles than level ${above}`, { above });
                else if (level.triangles === body.levels[at - 1].triangles)
                    say(notes, "same", `has as many triangles as level ${above}`, { above });
                if (level.openEdges > 0 && body.levels[0].openEdges === 0)
                    say(problems, "open", "is not closed, and level 0 is");
                const percent = round(level.deviationShare * 100, 1);
                if (level.deviationShare > lodDeviationShare)
                    say(notes, "moved", `moves the outline by ${percent}% of the body's size`, { percent });
            }
        }
        const found = [...problems, ...notes];
        if (values.bodies.length === 0) {
            unmeasured("none", "The file has no lower detail levels.", "No body was given lower detail levels. Engines that make their own levels on import need none.", values);
        }
        else if (found.length > 0) {
            add(problems.length > 0 ? "fail" : "warn", "found", `Detail levels: ${textOf(found, "; ")}.`, values, { found });
        }
        else {
            const count = values.bodies.reduce((total, body) => total + body.levels.length - 1, 0);
            const percent = round(lodDeviationShare * 100, 1);
            add("pass", "smaller", `${plural(count, "lower detail level")}, each smaller than the one above and within ${percent}% of the outline.`, values, { count, percent });
        }
    }
    // Player fit.
    const sceneMin = facts.total.bounds.meters.min;
    const sceneMax = facts.total.bounds.meters.max;
    // A person reads the player by its name. The id stays in the values, next to the name.
    const who = playerName(player);
    {
        const alongX = openingsAlong(scene, "x", sceneMin, sceneMax, player);
        const alongZ = openingsAlong(scene, "z", sceneMin, sceneMax, player);
        const values = {
            player: player.id,
            playerName: who,
            capsuleRadiusMeters: player.capsuleRadiusM,
            capsuleHeightMeters: player.capsuleHeightM,
            cellMeters: round(Math.max(alongX.cell, alongZ.cell), 6),
            openings: [...alongX.openings, ...alongZ.openings],
            ignored: alongX.ignored + alongZ.ignored,
        };
        const capsule = { player: who, width: round(player.capsuleRadiusM * 2, 3), height: round(player.capsuleHeightM, 3) };
        const size = `${who} (a capsule ${capsule.width} m wide and ${capsule.height} m tall)`;
        const fitting = values.openings.filter((opening) => opening.fits);
        const walkIn = fitting.filter((opening) => opening.walkIn);
        const wanted = expect.opening === true;
        if (values.openings.length === 0) {
            if (wanted)
                add("fail", "expected", `An opening for ${who} was expected, and none was found.`, values, { player: who });
            else
                unmeasured("none", "The asset has no opening for a player to pass.", "No opening closed over the top was found along the X or Z axis. A gap that is open to the sky is not counted.", values);
        }
        else if (walkIn.length > 0) {
            const widest = walkIn.reduce((a, b) => (b.widthMeters > a.widthMeters ? b : a));
            add("pass", "passes", `${size} passes an opening ${widest.widthMeters} m wide and ${widest.heightMeters} m tall.`, values, { ...capsule, openingWidth: widest.widthMeters, openingHeight: widest.heightMeters });
        }
        else if (fitting.length > 0) {
            const sill = fitting.reduce((a, b) => (b.sillMeters < a.sillMeters ? b : a)).sillMeters;
            add(wanted ? "fail" : "warn", "sill", `${who} fits an opening, but its sill is ${sill} m up and this player steps up ${player.stepHeightM} m.`, values, { player: who, sill, step: player.stepHeightM });
        }
        else {
            const largest = values.openings.reduce((a, b) => (b.widthMeters * b.heightMeters > a.widthMeters * a.heightMeters ? b : a));
            add(wanted ? "fail" : "warn", "fits-none", `${size} fits none of ${plural(values.openings.length, "opening")}. The largest is ${largest.widthMeters} m wide and ${largest.heightMeters} m tall.`, values, {
                ...capsule,
                count: values.openings.length,
                openingWidth: largest.widthMeters,
                openingHeight: largest.heightMeters,
            });
        }
    }
    {
        const { levels, ramps } = walkable(scene, sceneMin[1], player);
        // A stair is two or more rises in a row that are each no taller than a step can be. One
        // rise alone is a stair only when a stair was said to be expected.
        const heights = [0, ...levels.filter((level) => level > 0.001)];
        let best = [];
        let run = [];
        for (let at = 1; at <= heights.length; at += 1) {
            const rise = at < heights.length ? heights[at] - heights[at - 1] : Infinity;
            if (rise <= STEP_MAX_RISE_METERS + 1e-9) {
                run.push(round(rise, 4));
                continue;
            }
            if (run.length > best.length)
                best = run;
            run = [];
        }
        const found = best.length >= (expect.stairs === true ? 1 : 2);
        const rises = found ? best : [];
        const stepValues = {
            player: player.id,
            playerName: who,
            stepHeightMeters: player.stepHeightM,
            jumpHeightMeters: player.jumpHeightM,
            levels: levels.map((level) => round(level, 4)),
            rises,
            maxRiseMeters: rises.length === 0 ? null : Math.max(...rises),
        };
        const rise = stepValues.maxRiseMeters;
        const step = player.stepHeightM;
        if (!found) {
            if (expect.stairs === true)
                add("fail", "expected", "Steps were expected, and none were found.", stepValues);
            else
                unmeasured("none", "The asset has no steps.", `No two rises in a row of ${STEP_MAX_RISE_METERS} m or less were found between flat levels a player can stand on.`, stepValues, { limit: STEP_MAX_RISE_METERS });
        }
        else if (rise <= step + 0.001) {
            add("pass", "climbed", `${plural(rises.length, "rise")} of up to ${rise} m, and ${who} steps up ${step} m.`, stepValues, { count: rises.length, rise, player: who, step });
        }
        else {
            const clears = rise <= player.jumpHeightM ? 1 : 0;
            add(expect.stairs === true ? "fail" : "warn", "tall", `The tallest rise is ${rise} m, and ${step === 0 ? `${who} climbs no steps` : `${who} steps up ${step} m`}.${clears ? " A jump clears it, or collision can be a ramp." : ""}`, stepValues, { rise, player: who, step, clears });
        }
        const rampValues = { player: player.id, playerName: who, walkableSlopeDegrees: player.walkableSlopeDeg, ramps };
        const tooSteep = ramps.filter((slope) => !slope.walkable);
        const steepest = ramps[ramps.length - 1]?.angleDegrees ?? 0;
        const said = { steepest, player: who, walkable: player.walkableSlopeDeg };
        if (ramps.length === 0) {
            if (expect.ramp === true)
                add("fail", "expected", "A ramp was expected, and none was found.", rampValues);
            else {
                unmeasured("none", "The asset has no ramps.", `No flat slope from ${RAMP_MIN_DEGREES} to ${RAMP_MAX_DEGREES} degrees was found that is large enough to stand on.`, rampValues, { min: RAMP_MIN_DEGREES, max: RAMP_MAX_DEGREES });
            }
        }
        else if (tooSteep.length > 0) {
            add(expect.ramp === true ? "fail" : "warn", "steep", `${plural(tooSteep.length, "slope is", "slopes are")} steeper than the ${player.walkableSlopeDeg} degrees ${who} walks up. The steepest is ${steepest} degrees.`, rampValues, {
                count: tooSteep.length,
                ...said,
            });
        }
        else {
            add("pass", "walked", `${plural(ramps.length, "slope")} of up to ${steepest} degrees, and ${who} walks up ${player.walkableSlopeDeg}.`, rampValues, { count: ramps.length, ...said });
        }
    }
    const counts = { pass: 0, warn: 0, fail: 0, notMeasured: 0 };
    for (const result of results)
        counts[result.status === "not-measured" ? "notMeasured" : result.status] += 1;
    return {
        schema: 1,
        generator: GENERATOR,
        profile: facts.profile,
        assetClass,
        budget,
        player,
        gridMeters,
        status: counts.fail > 0 ? "fail" : counts.warn > 0 ? "warn" : "pass",
        counts,
        results,
    };
}
