import { refuse } from "./errors.js";
import { readGlb, readPack } from "./glb-read.js";
import { ENGINE_PROFILES } from "./profiles.js";
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
function round(value, digits = 6) {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale + 0;
}
function plural(count, one, many = `${one}s`) {
    return `${count} ${count === 1 ? one : many}`;
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
function openingsAlong(bodies, axis, min, max, player) {
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
    for (const { body, positions } of bodies) {
        const { indices } = body;
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
function walkable(bodies, floor, player) {
    const leastArea = (player.capsuleRadiusM * player.capsuleRadiusM) / 2;
    const flat = new Map();
    const slopes = [];
    const flatDot = Math.cos(RAMP_MIN_DEGREES / DEGREES);
    const steepDot = Math.cos(RAMP_MAX_DEGREES / DEGREES);
    for (const { body, positions } of bodies) {
        const { indices } = body;
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
function readOptions(options, facts) {
    if (typeof options !== "object" || options === null)
        refuse("BAD_OPTION", "Check options must be an object.");
    const assetClass = options.assetClass ?? DEFAULT_ASSET_CLASS;
    if (!Object.hasOwn(ASSET_BUDGETS, assetClass))
        refuse("BAD_OPTION", `assetClass must be one of ${Object.keys(ASSET_BUDGETS).map((name) => `"${name}"`).join(", ")}. Got ${JSON.stringify(assetClass)}.`);
    const budget = { ...ASSET_BUDGETS[assetClass] };
    if (options.budget !== undefined) {
        if (typeof options.budget !== "object" || options.budget === null)
            refuse("BAD_OPTION", "budget must be { maxTriangles, maxVertices, maxMaterialSlots }, each optional.");
        for (const key of ["maxTriangles", "maxVertices", "maxMaterialSlots"]) {
            const value = options.budget[key];
            if (value === undefined)
                continue;
            if (!(Number.isInteger(value) && value >= 1))
                refuse("BAD_OPTION", `budget.${key} must be a whole number of at least 1. Got ${String(value)}.`);
            budget[key] = value;
        }
    }
    let player;
    if (options.player === undefined) {
        // The player of the engine the file was written for. A custom profile gets Godot's, the default profile's.
        player = Object.hasOwn(PLAYER_PROFILES, facts.profile) ? PLAYER_PROFILES[facts.profile] : PLAYER_PROFILES.godot4;
    }
    else if (typeof options.player === "string") {
        if (!Object.hasOwn(PLAYER_PROFILES, options.player))
            refuse("BAD_OPTION", `Unknown player "${options.player}". Built-in players go by engine profile: ${Object.keys(ENGINE_PROFILES).join(", ")}.`);
        player = PLAYER_PROFILES[options.player];
    }
    else {
        player = options.player;
        if (typeof player !== "object" || player === null || typeof player.id !== "string" || player.id === "")
            refuse("BAD_OPTION", "A player profile needs an id.");
        for (const key of ["capsuleRadiusM", "capsuleHeightM"]) {
            if (!(Number.isFinite(player[key]) && player[key] > 0))
                refuse("BAD_OPTION", `Player "${player.id}": ${key} must be a positive number of metres.`);
        }
        for (const key of ["stepHeightM", "jumpHeightM"]) {
            if (!(Number.isFinite(player[key]) && player[key] >= 0))
                refuse("BAD_OPTION", `Player "${player.id}": ${key} must be zero or a positive number of metres.`);
        }
        if (!(Number.isFinite(player.walkableSlopeDeg) && player.walkableSlopeDeg >= 0 && player.walkableSlopeDeg <= 90)) {
            refuse("BAD_OPTION", `Player "${player.id}": walkableSlopeDeg must be from 0 to 90 degrees.`);
        }
    }
    const gridMeters = options.gridMeters ?? DEFAULT_GRID_METERS;
    if (!(Number.isFinite(gridMeters) && gridMeters > 0))
        refuse("BAD_OPTION", `gridMeters must be a positive number of metres. Got ${String(gridMeters)}.`);
    const lodDeviationShare = options.lodDeviationShare ?? DEFAULT_LOD_DEVIATION_SHARE;
    if (!(Number.isFinite(lodDeviationShare) && lodDeviationShare >= 0))
        refuse("BAD_OPTION", `lodDeviationShare must be zero or a positive share. Got ${String(lodDeviationShare)}.`);
    if (options.collisionTolerance !== undefined && !(Number.isFinite(options.collisionTolerance) && options.collisionTolerance >= 0)) {
        refuse("BAD_OPTION", `collisionTolerance must be zero or a positive share. Got ${String(options.collisionTolerance)}.`);
    }
    return { assetClass, budget, player, gridMeters, lodDeviationShare };
}
/** Units a size can be mixed up by, and what the mix-up is. */
const UNIT_MIXUPS = [
    [0.001, "millimetres read as metres"],
    [1000, "metres read as millimetres"],
    [0.01, "centimetres read as metres"],
    [100, "metres read as centimetres"],
    [0.0254, "inches read as metres"],
    [1 / 0.0254, "metres read as inches"],
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
    const unit = facts.engine.unit;
    const scene = pack.bodies.map((body, at) => {
        const positions = new Float64Array(body.positions.length);
        for (let n = 0; n < positions.length; n += 1)
            positions[n] = body.positions[n] + body.translation[n % 3];
        return { name: facts.bodies[at]?.name ?? body.name, body, positions };
    });
    // Size.
    {
        const { meters, engine } = facts.total.bounds;
        const range = ASSET_SIZE_RANGES[assetClass];
        const largestMeters = Math.max(...meters.size);
        const values = { meters: meters.size, engine: engine.size, unit, largestMeters, expectedMeters: [range.minMeters, range.maxMeters], suggestedScale: null };
        const sizeText = `${round(Math.max(...engine.size), 3)} ${unit} on its longest side`;
        if (largestMeters >= range.minMeters && largestMeters <= range.maxMeters) {
            results.push({ id: "size", status: "pass", message: `The asset is ${sizeText}, a size a ${assetClass} has.`, values });
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
            values.suggestedScale = best === undefined ? null : round(best[0], 6);
            const expected = `a ${assetClass} is expected to be from ${range.minMeters} to ${range.maxMeters} m`;
            results.push({
                id: "size",
                status: "warn",
                message: `The asset is ${sizeText}, and ${expected}.${best === undefined ? "" : ` This looks like ${best[1]}: a scale of ${round(best[0], 6)} would fit.`}`,
                values,
            });
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
        if (assetClass === "kit-piece" && offGrid > 0) {
            results.push({ id: "pivot", status: "fail", message: `${plural(offGrid, "body has", "bodies have")} a pivot off the ${gridMeters} m grid, so the kit piece will not snap into place.`, values });
        }
        else if (farOut > 0) {
            results.push({ id: "pivot", status: "warn", message: `${plural(farOut, "body has", "bodies have")} a pivot further from the body than the body is long.`, values });
        }
        else {
            const first = values.bodies[0];
            results.push({ id: "pivot", status: "pass", message: first === undefined ? "There are no bodies." : `The pivot is at "${first.mode}"${offGrid === 0 ? `, on the ${gridMeters} m grid` : ""}.`, values });
        }
    }
    // Triangles, vertices and material slots against the budget.
    {
        const count = (id, limit, pick) => {
            const values = { count: facts.bodies.reduce((total, body) => total + pick(body), 0), budget: limit, bodies: facts.bodies.map((body) => ({ name: body.name, count: pick(body) })) };
            const over = values.count > limit;
            const what = id === "triangles" ? "triangles" : "vertices after hard edges split";
            results.push({ id, status: over ? "fail" : "pass", message: `${values.count} ${what}, against a budget of ${limit} for a ${assetClass}.`, values });
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
        const edges = `${plural(shading.hardEdges, "hard edge")} and ${plural(shading.softEdges, "soft edge")}, normals by "${shading.normals}"`;
        if (pack.bodies.some((body) => body.normals.length !== body.positions.length)) {
            results.push({ id: "shading", status: "fail", message: "A body has no normals.", values: shading });
        }
        else if (shading.backFacingNormals > 0) {
            results.push({ id: "shading", status: "fail", message: `${plural(shading.backFacingNormals, "corner has", "corners have")} a normal that points away from its own triangle.`, values: shading });
        }
        else if (shading.maxNormalAngle > NORMAL_ANGLE_WARNING_DEGREES) {
            results.push({
                id: "shading",
                status: "warn",
                message: `A normal is ${shading.maxNormalAngle} degrees from the face it shades, over ${NORMAL_ANGLE_WARNING_DEGREES}. A lower crease angle would make that edge hard. ${edges}.`,
                values: shading,
            });
        }
        else {
            results.push({ id: "shading", status: "pass", message: `${edges}. ${shading.normals === "face-weighted" ? "Face-weighted normals are in use." : "Face-weighted normals are there to ask for: normals \"face-weighted\"."}`, values: shading });
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
        const problems = [];
        if (clean.flippedEdges > 0)
            problems.push(`${plural(clean.flippedEdges, "edge")} between faces that point opposite ways`);
        if (clean.insideOutBodies > 0)
            problems.push(`${plural(clean.insideOutBodies, "body", "bodies")} turned inside out`);
        const notes = [];
        if (clean.nonManifoldEdges > 0)
            notes.push(`${plural(clean.nonManifoldEdges, "edge")} shared by more than two triangles`);
        if (clean.openEdges > 0)
            notes.push(`${plural(clean.openEdges, "open edge")}`);
        if (clean.sliverTriangles > 0)
            notes.push(`${plural(clean.sliverTriangles, "sliver triangle")}`);
        if (clean.degenerateTrianglesDropped > 0)
            notes.push(`${plural(clean.degenerateTrianglesDropped, "triangle")} with no area left out`);
        if (problems.length > 0)
            results.push({ id: "clean-mesh", status: "fail", message: `The mesh has ${[...problems, ...notes].join(", ")}.`, values: clean });
        else if (notes.length > 0)
            results.push({ id: "clean-mesh", status: "warn", message: `The mesh has ${notes.join(", ")}.`, values: clean });
        else
            results.push({ id: "clean-mesh", status: "pass", message: "Every body is closed, faces outwards and has no sliver triangles.", values: clean });
    }
    {
        const values = {
            count: Math.max(0, ...facts.bodies.map((body) => body.materialSlots)),
            budget: budget.maxMaterialSlots,
            fileMaterials: facts.total.materialSlots,
            bodies: facts.bodies.map((body) => ({ name: body.name, count: body.materialSlots })),
        };
        results.push({
            id: "material-slots",
            status: values.count > values.budget ? "fail" : "pass",
            message: `${plural(values.count, "material slot")} on the body with the most, against a budget of ${values.budget} for a ${assetClass}.`,
            values,
        });
    }
    // Collision.
    {
        const tolerance = options.collisionTolerance ?? facts.settings.collision?.tolerance ?? 0.05;
        const values = {
            tolerance,
            bodies: facts.bodies.map((body) => {
                const error = body.collision?.volume.error ?? null;
                return {
                    name: body.name,
                    requested: body.collision?.requested ?? "none",
                    shape: body.collision?.shape ?? "none",
                    pieces: body.collision?.pieces ?? 0,
                    error,
                    withinTolerance: error === null ? null : Math.abs(error) <= tolerance,
                };
            }),
        };
        const without = values.bodies.filter((body) => body.shape === "none");
        const beyond = values.bodies.filter((body) => body.withinTolerance === false);
        const unknown = values.bodies.filter((body) => body.shape !== "none" && body.withinTolerance === null);
        if (without.length === values.bodies.length) {
            results.push({ id: "collision", status: "not-measured", message: "The file has no collision shape.", reason: "No collision was written. exportGameAsset writes one unless collision is \"none\".", values });
        }
        else if (beyond.length > 0) {
            const worst = beyond.reduce((a, b) => (Math.abs(b.error) > Math.abs(a.error) ? b : a));
            // A shape the caller named is the caller's choice, and only worth a warning. One that
            // "auto" settled for because nothing nearer could be built is a failure.
            const chosen = beyond.every((body) => body.requested !== "auto");
            results.push({
                id: "collision",
                status: chosen ? "warn" : "fail",
                message: `The collision of "${worst.name}" (${worst.shape}, ${plural(worst.pieces, "piece")}) is ${round(Math.abs(worst.error) * 100, 1)}% ${worst.error > 0 ? "more" : "less"} volume than the visible part, over the ${round(tolerance * 100, 1)}% allowed.${chosen ? "" : " Collision pieces from the construction, or a kernel for a convex decomposition, would bring it nearer."}`,
                values,
            });
        }
        else if (without.length > 0) {
            results.push({ id: "collision", status: "warn", message: `${plural(without.length, "body has", "bodies have")} no collision shape.`, values });
        }
        else if (unknown.length > 0) {
            results.push({
                id: "collision",
                status: "not-measured",
                message: "A collision shape was written, but its body is not closed.",
                reason: "A body with open edges encloses no volume, so there is nothing to compare the collision volume with.",
                values,
            });
        }
        else {
            const pieces = values.bodies.reduce((total, body) => total + body.pieces, 0);
            results.push({ id: "collision", status: "pass", message: `Collision in ${plural(pieces, "convex piece")}, within ${round(tolerance * 100, 1)}% of the visible volume.`, values });
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
                const above = body.levels[at - 1];
                if (level.triangles > above.triangles)
                    problems.push(`level ${level.level} of "${body.name}" has more triangles than level ${above.level}`);
                else if (level.triangles === above.triangles)
                    notes.push(`level ${level.level} of "${body.name}" has as many triangles as level ${above.level}`);
                if (level.openEdges > 0 && body.levels[0].openEdges === 0)
                    problems.push(`level ${level.level} of "${body.name}" is not closed, and level 0 is`);
                if (level.deviationShare > lodDeviationShare)
                    notes.push(`level ${level.level} of "${body.name}" moves the outline by ${round(level.deviationShare * 100, 1)}% of the body's size`);
            }
        }
        if (values.bodies.length === 0) {
            results.push({ id: "detail-levels", status: "not-measured", message: "The file has no lower detail levels.", reason: "No body was given lods. Engines that make their own levels on import need none.", values });
        }
        else if (problems.length > 0) {
            results.push({ id: "detail-levels", status: "fail", message: `Detail levels: ${[...problems, ...notes].join("; ")}.`, values });
        }
        else if (notes.length > 0) {
            results.push({ id: "detail-levels", status: "warn", message: `Detail levels: ${notes.join("; ")}.`, values });
        }
        else {
            const lower = values.bodies.reduce((total, body) => total + body.levels.length - 1, 0);
            results.push({ id: "detail-levels", status: "pass", message: `${plural(lower, "lower detail level")}, each smaller than the one above and within ${round(lodDeviationShare * 100, 1)}% of the outline.`, values });
        }
    }
    // Player fit.
    const sceneMin = facts.total.bounds.meters.min;
    const sceneMax = facts.total.bounds.meters.max;
    {
        const alongX = openingsAlong(scene, "x", sceneMin, sceneMax, player);
        const alongZ = openingsAlong(scene, "z", sceneMin, sceneMax, player);
        const values = {
            player: player.id,
            capsuleRadiusMeters: player.capsuleRadiusM,
            capsuleHeightMeters: player.capsuleHeightM,
            cellMeters: round(Math.max(alongX.cell, alongZ.cell), 6),
            openings: [...alongX.openings, ...alongZ.openings],
            ignored: alongX.ignored + alongZ.ignored,
        };
        const size = `a capsule ${round(player.capsuleRadiusM * 2, 3)} m wide and ${round(player.capsuleHeightM, 3)} m tall`;
        const fitting = values.openings.filter((opening) => opening.fits);
        const walkIn = fitting.filter((opening) => opening.walkIn);
        if (values.openings.length === 0) {
            const reason = "No opening closed over the top was found along the X or Z axis. A gap that is open to the sky is not counted.";
            if (expect.opening === true)
                results.push({ id: "player-openings", status: "fail", message: "An opening for the player was expected, and none was found.", values });
            else
                results.push({ id: "player-openings", status: "not-measured", message: "The asset has no opening for a player to pass.", reason, values });
        }
        else if (walkIn.length > 0) {
            const widest = walkIn.reduce((a, b) => (b.widthMeters > a.widthMeters ? b : a));
            results.push({ id: "player-openings", status: "pass", message: `The player (${size}) passes an opening ${widest.widthMeters} m wide and ${widest.heightMeters} m tall.`, values });
        }
        else if (fitting.length > 0) {
            const lowest = fitting.reduce((a, b) => (b.sillMeters < a.sillMeters ? b : a));
            results.push({
                id: "player-openings",
                status: expect.opening === true ? "fail" : "warn",
                message: `The player fits an opening, but its sill is ${lowest.sillMeters} m up and the player steps up ${player.stepHeightM} m.`,
                values,
            });
        }
        else {
            const largest = values.openings.reduce((a, b) => (b.widthMeters * b.heightMeters > a.widthMeters * a.heightMeters ? b : a));
            results.push({
                id: "player-openings",
                status: expect.opening === true ? "fail" : "warn",
                message: `The player (${size}) fits none of ${plural(values.openings.length, "opening")}. The largest is ${largest.widthMeters} m wide and ${largest.heightMeters} m tall.`,
                values,
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
            stepHeightMeters: player.stepHeightM,
            jumpHeightMeters: player.jumpHeightM,
            levels: levels.map((level) => round(level, 4)),
            rises,
            maxRiseMeters: rises.length === 0 ? null : Math.max(...rises),
        };
        if (!found) {
            const reason = `No two rises in a row of ${STEP_MAX_RISE_METERS} m or less were found between flat levels a player can stand on.`;
            if (expect.stairs === true)
                results.push({ id: "player-steps", status: "fail", message: "Steps were expected, and none were found.", values: stepValues });
            else
                results.push({ id: "player-steps", status: "not-measured", message: "The asset has no steps.", reason, values: stepValues });
        }
        else if (stepValues.maxRiseMeters <= player.stepHeightM + 0.001) {
            results.push({ id: "player-steps", status: "pass", message: `${plural(rises.length, "rise")} of up to ${stepValues.maxRiseMeters} m, and the player steps up ${player.stepHeightM} m.`, values: stepValues });
        }
        else {
            const how = player.stepHeightM === 0 ? "this player climbs no steps" : `the player steps up ${player.stepHeightM} m`;
            const jump = stepValues.maxRiseMeters <= player.jumpHeightM ? " A jump clears it, or collision can be a ramp." : "";
            results.push({ id: "player-steps", status: expect.stairs === true ? "fail" : "warn", message: `The tallest rise is ${stepValues.maxRiseMeters} m, and ${how}.${jump}`, values: stepValues });
        }
        const rampValues = { player: player.id, walkableSlopeDegrees: player.walkableSlopeDeg, ramps };
        const tooSteep = ramps.filter((slope) => !slope.walkable);
        if (ramps.length === 0) {
            const reason = `No flat slope from ${RAMP_MIN_DEGREES} to ${RAMP_MAX_DEGREES} degrees was found that is large enough to stand on.`;
            if (expect.ramp === true)
                results.push({ id: "player-ramps", status: "fail", message: "A ramp was expected, and none was found.", values: rampValues });
            else
                results.push({ id: "player-ramps", status: "not-measured", message: "The asset has no ramps.", reason, values: rampValues });
        }
        else if (tooSteep.length > 0) {
            results.push({
                id: "player-ramps",
                status: expect.ramp === true ? "fail" : "warn",
                message: `${plural(tooSteep.length, "slope is", "slopes are")} steeper than the ${player.walkableSlopeDeg} degrees the player walks up. The steepest is ${ramps[ramps.length - 1].angleDegrees} degrees.`,
                values: rampValues,
            });
        }
        else {
            results.push({ id: "player-ramps", status: "pass", message: `${plural(ramps.length, "slope")} of up to ${ramps[ramps.length - 1].angleDegrees} degrees, and the player walks up ${player.walkableSlopeDeg}.`, values: rampValues });
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
