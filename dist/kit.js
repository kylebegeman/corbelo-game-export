import { exportGameAsset } from "./asset.js";
import { badOption, notObject, refuse } from "./errors.js";
import { assertJson } from "./export.js";
import { readPack } from "./glb-read.js";
import { assetName, DEFAULT_NAME_PATTERNS } from "./naming.js";
import { resolveProfile } from "./profiles.js";
import { pointToGltfSpace, spaceConversion } from "./space.js";
export const KIT_SIDES = ["+x", "-x", "+y", "-y", "+z", "-z"];
/** How far trim may reach past a piece's cells, in metres, when the grid does not say. */
export const DEFAULT_TRIM_METERS = 0.1;
/** A plane that is turned more than this many degrees from every axis is not a socket. */
export const SOCKET_AXIS_DEGREES = 1;
const KIT_ONLY_KEYS = ["name", "grid", "pieces", "mates", "layouts", "naming", "source", "provenance"];
const AXIS_OF = { "+x": 0, "-x": 0, "+y": 1, "-y": 1, "+z": 2, "-z": 2 };
/** The axis a side faces along: 0, 1 or 2. */
export function sideAxis(side) {
    return AXIS_OF[side];
}
/** 1 for a side that faces along its axis, -1 for one that faces against it. */
export function sideSign(side) {
    return side.startsWith("+") ? 1 : -1;
}
export function oppositeSide(side) {
    return `${side.startsWith("+") ? "-" : "+"}${side[1]}`;
}
/** A side after quarter turns about the up axis, anticlockwise seen from above. */
export function turnSide(side, turn) {
    const ring = ["+x", "+y", "-x", "-y"];
    const at = ring.indexOf(side);
    return at < 0 ? side : ring[(((at + turn) % 4) + 4) % 4];
}
/** A cell of a piece after quarter turns about the middle of the piece's first cell. */
export function turnCell(cell, turn) {
    let [x, y] = [cell[0], cell[1]];
    for (let n = (((turn % 4) + 4) % 4); n > 0; n -= 1)
        [x, y] = [-y, x];
    return [x + 0, y + 0, cell[2]];
}
/** The size of one cell in metres: along X, along Y and up. */
export function cellSize(grid) {
    return [grid.moduleMeters, grid.moduleMeters, grid.storeyMeters];
}
/**
 * Where a point of a piece ends up when the piece is placed. The point is in metres from the
 * low corner of the piece's cells, in the kit frame, and so is the result, from the low corner
 * of cell `[0, 0, 0]` of the layout.
 */
export function placePoint(point, placement, grid, out = [0, 0, 0], at = 0) {
    const half = grid.moduleMeters / 2;
    let x = point[0] - half;
    let y = point[1] - half;
    for (let n = placement.turn; n > 0; n -= 1)
        [x, y] = [-y, x];
    out[at] = x + half + placement.cell[0] * grid.moduleMeters;
    out[at + 1] = y + half + placement.cell[1] * grid.moduleMeters;
    out[at + 2] = point[2] + placement.cell[2] * grid.storeyMeters;
}
/** The type a socket type meets. */
export function mateOf(kit, type) {
    return Object.hasOwn(kit.mates, type) ? kit.mates[type] : type;
}
function isPoint(value) {
    return Array.isArray(value) && value.length === 3 && value.every((part) => Number.isFinite(part));
}
function isCells(value, least) {
    return Array.isArray(value) && value.length === 3 && value.every((part) => Number.isInteger(part) && part >= least);
}
export function readGrid(grid) {
    if (notObject(grid))
        refuse("BAD_KIT", "A kit needs grid: { moduleMeters, storeyMeters }.");
    for (const key of ["moduleMeters", "storeyMeters"]) {
        if (!(Number.isFinite(grid[key]) && grid[key] > 0))
            refuse("BAD_KIT", `grid.${key} must be a positive number of metres. Got ${String(grid[key])}.`);
    }
    const trimMeters = grid.trimMeters ?? DEFAULT_TRIM_METERS;
    if (!(Number.isFinite(trimMeters) && trimMeters >= 0))
        refuse("BAD_KIT", `grid.trimMeters must be zero or a positive number of metres. Got ${String(trimMeters)}.`);
    return { moduleMeters: grid.moduleMeters, storeyMeters: grid.storeyMeters, trimMeters };
}
/** glTF metres to the kit frame. */
function toKit(point) {
    return [point[0] + 0, -point[2] + 0, point[1] + 0];
}
/** The two axes of a socket's own frame, as what each takes from a step in the kit frame. */
function socketAxes(side) {
    switch (side) {
        case "+x":
            return { u: [0, 1, 0], v: [0, 0, 1] };
        case "-x":
            return { u: [0, -1, 0], v: [0, 0, 1] };
        case "+y":
            return { u: [-1, 0, 0], v: [0, 0, 1] };
        case "-y":
            return { u: [1, 0, 0], v: [0, 0, 1] };
        case "+z":
            return { u: [1, 0, 0], v: [0, 1, 0] };
        case "-z":
            return { u: [-1, 0, 0], v: [0, 1, 0] };
    }
}
/**
 * A socket's own frame: the middle of its face, in metres from the low corner of the piece's
 * cells, the two axes across the face, and half the face's size along each. Two sockets that
 * meet see each other mirrored: a point at `(u, v)` of one is at `(-u, v)` of the other.
 */
export function socketFrame(socket, grid) {
    const size = cellSize(grid);
    const axis = sideAxis(socket.side);
    const center = [(socket.cell[0] + 0.5) * size[0], (socket.cell[1] + 0.5) * size[1], (socket.cell[2] + 0.5) * size[2]];
    center[axis] = (socket.cell[axis] + (sideSign(socket.side) > 0 ? 1 : 0)) * size[axis];
    const { u, v } = socketAxes(socket.side);
    const half = (direction) => (Math.abs(direction[0]) * size[0] + Math.abs(direction[1]) * size[1] + Math.abs(direction[2]) * size[2]) / 2;
    return { center, u, v, halfU: half(u), halfV: half(v) };
}
function readSocket(input, where, cells, grid, toBlock, toDirection) {
    if (notObject(input))
        refuse("BAD_KIT", `${where} must be { type, side } or { type, plane }.`);
    if (typeof input.type !== "string" || input.type.trim() === "")
        refuse("BAD_KIT", `${where} needs a type, like "wall end".`);
    if (input.name !== undefined && (typeof input.name !== "string" || input.name.trim() === ""))
        refuse("BAD_KIT", `${where}: name must be text.`);
    if ((input.side === undefined) === (input.plane === undefined))
        refuse("BAD_KIT", `${where}: give side or plane, and not both.`);
    if (input.passage !== undefined && typeof input.passage !== "boolean")
        refuse("BAD_KIT", `${where}: passage must be true or false.`);
    if (input.cell !== undefined && !isCells(input.cell, 0))
        refuse("BAD_KIT", `${where}: cell must be three whole numbers from 0, like [0, 0, 0].`);
    const size = cellSize(grid);
    let side;
    let cell;
    let offsetMeters = 0;
    if (input.side !== undefined) {
        if (!KIT_SIDES.includes(input.side))
            refuse("BAD_KIT", `${where}: side must be one of ${KIT_SIDES.map((name) => `"${name}"`).join(", ")}. Got ${JSON.stringify(input.side)}.`);
        side = input.side;
        cell = input.cell !== undefined ? [input.cell[0], input.cell[1], input.cell[2]] : [0, 0, 0];
    }
    else {
        const plane = input.plane;
        if (notObject(plane) || !isPoint(plane.point) || !isPoint(plane.normal) || Math.hypot(...plane.normal) === 0) {
            refuse("BAD_KIT", `${where}: plane must be { point: [x, y, z], normal: [x, y, z] } with a normal that is not all zero.`);
        }
        const normal = toDirection(plane.normal);
        const length = Math.hypot(...normal);
        let axis = 0;
        for (const candidate of [1, 2])
            if (Math.abs(normal[candidate]) > Math.abs(normal[axis]))
                axis = candidate;
        if (Math.abs(normal[axis]) / length < Math.cos((SOCKET_AXIS_DEGREES * Math.PI) / 180)) {
            refuse("BAD_KIT", `${where}: the plane is turned more than ${SOCKET_AXIS_DEGREES} degree from every axis of the grid, so it is not a face pieces meet on.`);
        }
        side = `${normal[axis] > 0 ? "+" : "-"}${"xyz"[axis]}`;
        const point = toBlock(plane.point);
        // The cell the point is in front of, unless the caller named one.
        cell = [0, 0, 0];
        for (const other of [0, 1, 2]) {
            cell[other] = other === axis ? (normal[axis] > 0 ? cells[axis] - 1 : 0) : Math.min(cells[other] - 1, Math.max(0, Math.floor(point[other] / size[other])));
        }
        if (input.cell !== undefined)
            cell = [input.cell[0], input.cell[1], input.cell[2]];
        offsetMeters = (point[axis] - (normal[axis] > 0 ? cells[axis] : 0) * size[axis]) * (normal[axis] > 0 ? 1 : -1);
    }
    const axis = sideAxis(side);
    for (const other of [0, 1, 2]) {
        if (cell[other] >= cells[other])
            refuse("BAD_KIT", `${where}: cell [${cell.join(", ")}] is outside the piece's cells [${cells.join(", ")}].`);
    }
    if (cell[axis] !== (sideSign(side) > 0 ? cells[axis] - 1 : 0)) {
        refuse("BAD_KIT", `${where}: side ${side} of cell [${cell.join(", ")}] faces another cell of the same piece. A socket is on the outside of the piece's cells.`);
    }
    let region = null;
    if (input.region !== undefined) {
        if (!Array.isArray(input.region) || input.region.length < 3 || !input.region.every(isPoint))
            refuse("BAD_KIT", `${where}: region must be at least three points [x, y, z] on the plane.`);
        const frame = socketFrame({ side, cell }, grid);
        region = input.region.map((point) => {
            const at = toBlock(point);
            const d = [at[0] - frame.center[0], at[1] - frame.center[1], at[2] - frame.center[2]];
            return [d[0] * frame.u[0] + d[1] * frame.u[1] + d[2] * frame.u[2] + 0, d[0] * frame.v[0] + d[1] * frame.v[1] + d[2] * frame.v[2] + 0];
        });
    }
    return { ...(input.name !== undefined ? { name: input.name.trim() } : {}), type: input.type.trim(), side, cell, passage: input.passage === true, offsetMeters: offsetMeters + 0, region };
}
function readLayouts(layouts, pieces) {
    if (layouts === undefined)
        return [];
    if (!Array.isArray(layouts))
        refuse("BAD_LAYOUT", "layouts must be a list of { name, placements }.");
    const names = new Set();
    return layouts.map((layout, at) => {
        if (notObject(layout) || typeof layout.name !== "string" || layout.name.trim() === "")
            refuse("BAD_LAYOUT", `Layout ${at} needs a name.`);
        if (names.has(layout.name.toLowerCase()))
            refuse("BAD_LAYOUT", `Two layouts are named "${layout.name}".`);
        names.add(layout.name.toLowerCase());
        return readLayout(layout, pieces);
    });
}
/** Checks a layout the caller wrote against the pieces there are. */
export function readLayout(layout, pieces) {
    if (notObject(layout) || typeof layout.name !== "string" || layout.name.trim() === "")
        refuse("BAD_LAYOUT", "A layout needs a name.");
    if (!Array.isArray(layout.placements) || layout.placements.length === 0)
        refuse("BAD_LAYOUT", `Layout "${layout.name}" needs placements: a list of { piece, cell, turn }.`);
    const placements = layout.placements.map((placement, at) => {
        const where = `Layout "${layout.name}", placement ${at}`;
        if (notObject(placement))
            refuse("BAD_LAYOUT", `${where} must be { piece, cell, turn }.`);
        if (!pieces.some((piece) => piece.name === placement.piece))
            refuse("BAD_LAYOUT", `${where}: the kit has no piece named ${JSON.stringify(placement.piece)}.`);
        if (!Array.isArray(placement.cell) || placement.cell.length !== 3 || !placement.cell.every((part) => Number.isInteger(part))) {
            refuse("BAD_LAYOUT", `${where}: cell must be three whole numbers, like [2, 0, 0].`);
        }
        const turn = placement.turn ?? 0;
        if (!Number.isInteger(turn))
            refuse("BAD_LAYOUT", `${where}: turn must be a whole number of quarter turns.`);
        return { piece: placement.piece, cell: [placement.cell[0], placement.cell[1], placement.cell[2]], turn: (((turn % 4) + 4) % 4) };
    });
    return { name: layout.name.trim(), origin: "given", placements };
}
/**
 * Reads a kit: checks what was given, writes every piece as a game asset with its pivot at the
 * scene origin, and puts every socket on a face of a cell. `grid` replaces the kit's own grid,
 * so a kit whose pieces are a function of the grid is rebuilt for another module in one call.
 *
 * The same input always gives the same bytes.
 */
export function resolveKit(input, grid) {
    if (notObject(input))
        refuse("BAD_KIT", "A kit is { name, source, grid, pieces }.");
    if (typeof input.name !== "string" || input.name.trim() === "")
        refuse("BAD_KIT", "A kit needs a name.");
    for (const key of ["pivot", "pivots", "placement", "collisions"]) {
        if (input[key] !== undefined) {
            refuse("BAD_KIT", `A kit takes no ${key}: ${key === "collisions" ? "its collision settings are for every piece" : "each piece has its own pivot, and sits at the scene origin"}.`);
        }
    }
    const resolvedGrid = readGrid(grid ?? input.grid);
    const profile = resolveProfile(input.profile);
    const pattern = input.naming ?? (Object.hasOwn(DEFAULT_NAME_PATTERNS, profile.id) ? DEFAULT_NAME_PATTERNS[profile.id] : DEFAULT_NAME_PATTERNS.godot4);
    const conversion = spaceConversion(input.source);
    const mates = {};
    if (input.mates !== undefined) {
        if (notObject(input.mates) || Array.isArray(input.mates))
            refuse("BAD_KIT", "mates must be an object of socket types, like { \"plug\": \"hole\" }.");
        for (const [type, other] of Object.entries(input.mates)) {
            if (typeof other !== "string" || other.trim() === "" || type.trim() === "")
                refuse("BAD_KIT", `mates: "${type}" must name a socket type.`);
            for (const [from, to] of [[type.trim(), other.trim()], [other.trim(), type.trim()]]) {
                if (Object.hasOwn(mates, from) && mates[from] !== to)
                    refuse("BAD_KIT", `mates: "${from}" meets both "${mates[from]}" and "${to}". A type meets one type.`);
                mates[from] = to;
            }
        }
    }
    const given = typeof input.pieces === "function" ? input.pieces({ ...resolvedGrid }) : input.pieces;
    if (!Array.isArray(given) || given.length === 0)
        refuse("BAD_KIT", "A kit needs pieces: a list with at least one piece.");
    const options = {};
    for (const [key, value] of Object.entries(input)) {
        if (!KIT_ONLY_KEYS.includes(key))
            options[key] = value;
    }
    const taken = new Map();
    const pieceNames = new Set();
    const pieces = given.map((piece, at) => {
        if (notObject(piece))
            refuse("BAD_KIT", `Piece ${at} must be { name, bodies } or { name, glb }.`);
        if (typeof piece.name !== "string" || piece.name.trim() === "")
            refuse("BAD_KIT", `Piece ${at} needs a name.`);
        const where = `Piece "${piece.name}"`;
        if (pieceNames.has(piece.name))
            refuse("BAD_KIT", `Two pieces are named "${piece.name}".`);
        pieceNames.add(piece.name);
        if ((piece.bodies === undefined) === (piece.glb === undefined))
            refuse("BAD_KIT", `${where}: give bodies or glb, and not both.`);
        if (piece.cells !== undefined && !isCells(piece.cells, 1))
            refuse("BAD_KIT", `${where}: cells must be three whole numbers of at least 1, like [1, 1, 1].`);
        for (const key of ["origin", "pivot"]) {
            if (piece[key] !== undefined && !isPoint(piece[key]))
                refuse("BAD_KIT", `${where}: ${key} must be three finite numbers [x, y, z].`);
        }
        if (piece.trim !== undefined && (!Array.isArray(piece.trim) || !piece.trim.every((name) => typeof name === "string")))
            refuse("BAD_KIT", `${where}: trim must be a list of body names.`);
        if (piece.sockets !== undefined && !Array.isArray(piece.sockets))
            refuse("BAD_KIT", `${where}: sockets must be a list.`);
        if (piece.provenance !== undefined)
            assertJson(piece.provenance, `pieces[${at}].provenance`, 0);
        const cells = piece.cells !== undefined ? [piece.cells[0], piece.cells[1], piece.cells[2]] : [1, 1, 1];
        const asset = assetName(pattern, input.name, piece.name);
        const key = asset.toLowerCase();
        if (taken.has(key))
            refuse("BAD_KIT", `Pieces "${taken.get(key)}" and "${piece.name}" both come out named "${asset}". Pieces need names that differ in their letters and digits.`);
        taken.set(key, piece.name);
        // A piece given as an asset is read in glTF space, and its own origin is its pivot.
        const own = piece.glb !== undefined ? spaceConversion({ unit: 1, up: "Y" }) : conversion;
        const origin = toKit(pointToGltfSpace(piece.origin ?? [0, 0, 0], own));
        let glb;
        let facts;
        let pivot;
        if (piece.glb !== undefined) {
            if (!(piece.glb instanceof Uint8Array))
                refuse("BAD_KIT", `${where}: glb must be a Uint8Array.`);
            if (piece.pivot !== undefined)
                refuse("BAD_KIT", `${where}: a piece given as a glb has its pivot at its own origin, so it takes no pivot.`);
            const read = readPack(piece.glb);
            if (read.facts === null)
                refuse("BAD_GLB", `${where}: the GLB has no facts in its scene extras, so it was not written by this package.`);
            glb = piece.glb;
            facts = read.facts;
            pivot = [0, 0, 0];
        }
        else {
            if (!Array.isArray(piece.bodies) || piece.bodies.length === 0)
                refuse("NO_BODIES", `${where} needs at least one body.`);
            const bodies = piece.bodies;
            const sourcePivot = piece.pivot ?? piece.origin ?? [0, 0, 0];
            // One body is the piece: it takes the piece's file name, as the one body of an asset does.
            const named = bodies.length === 1 && !notObject(bodies[0]) ? [{ ...bodies[0], name: asset }] : bodies;
            const stored = piece.provenance ?? input.provenance;
            const result = exportGameAsset({
                ...options,
                source: input.source,
                bodies: named,
                pivot: [sourcePivot[0], sourcePivot[1], sourcePivot[2]],
                placement: "origin",
                ...(stored !== undefined ? { provenance: stored } : {}),
            });
            glb = result.glb;
            facts = result.facts;
            pivot = toKit(pointToGltfSpace(sourcePivot, own));
        }
        const pivotMeters = [pivot[0] - origin[0] + 0, pivot[1] - origin[1] + 0, pivot[2] - origin[2] + 0];
        const toBlock = (point) => {
            const at = toKit(pointToGltfSpace(point, own));
            return [at[0] - origin[0], at[1] - origin[1], at[2] - origin[2]];
        };
        const toDirection = (direction) => toKit(pointToGltfSpace(direction, { ...own, unit: 1 }));
        const used = new Set();
        const sockets = (piece.sockets ?? []).map((socket, n) => {
            const read = readSocket(socket, `${where}, socket ${n}`, cells, resolvedGrid, toBlock, toDirection);
            const name = read.name ?? (cells.every((count) => count === 1) ? read.side : `${read.side}@${read.cell.join(",")}`);
            if (used.has(name))
                refuse("BAD_KIT", `${where}: two sockets are named "${name}". Two sockets on one face of one cell need names of their own.`);
            used.add(name);
            return { ...read, name };
        });
        return {
            name: piece.name,
            asset,
            cells,
            pivotMeters,
            sockets,
            trim: [...(piece.trim ?? [])],
            glb,
            facts,
            ...(piece.provenance !== undefined ? { provenance: piece.provenance } : {}),
        };
    });
    return {
        name: assetName(pattern, input.name),
        profile: profile.id,
        grid: resolvedGrid,
        naming: pattern,
        mates,
        pieces,
        layouts: readLayouts(input.layouts, pieces),
    };
}
/** True for a kit `resolveKit` returned, false for one as it is given. */
export function isKit(value) {
    return !notObject(value) && typeof value.profile === "string" && Array.isArray(value.pieces) && value.pieces.every((piece) => !notObject(piece) && "glb" in piece && "facts" in piece);
}
/** A kit as `resolveKit` returns it, from that or from a kit as it is given. */
export function kitOf(input, grid) {
    if (!isKit(input))
        return resolveKit(input, grid);
    if (grid !== undefined)
        badOption("A kit that is already written cannot be made for another grid: give the kit as it was given to resolveKit.");
    return input;
}
/** A layout by name, among the test layouts and the kit's own, or a layout as given. */
export function layoutOf(kit, layout) {
    if (typeof layout !== "string")
        return readLayout(layout, kit.pieces);
    const found = [...kitLayouts(kit).layouts, ...kit.layouts].find((one) => one.name === layout);
    if (found === undefined) {
        const skipped = kitLayouts(kit).skipped.find((one) => one.name === layout);
        refuse("BAD_LAYOUT", skipped !== undefined ? `The kit has no "${layout}" layout: ${skipped.reason}` : `The kit has no layout named ${JSON.stringify(layout)}.`);
    }
    return found;
}
function cellKey(cell) {
    return `${cell[0]},${cell[1]},${cell[2]}`;
}
const STEP_OF = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0], "+z": [0, 0, 1], "-z": [0, 0, -1] };
/** Works out what meets what in a layout: from the cells and the sockets alone, no geometry. */
export function layoutJoints(kit, layout) {
    const byName = new Map(kit.pieces.map((piece) => [piece.name, piece]));
    const filled = new Map();
    const faces = new Map();
    const placed = [];
    for (const [at, placement] of layout.placements.entries()) {
        const piece = byName.get(placement.piece);
        if (piece === undefined)
            refuse("BAD_LAYOUT", `Layout "${layout.name}": the kit has no piece named ${JSON.stringify(placement.piece)}.`);
        for (let x = 0; x < piece.cells[0]; x += 1) {
            for (let y = 0; y < piece.cells[1]; y += 1) {
                for (let z = 0; z < piece.cells[2]; z += 1) {
                    const turned = turnCell([x, y, z], placement.turn);
                    const key = cellKey([turned[0] + placement.cell[0], turned[1] + placement.cell[1], turned[2] + placement.cell[2]]);
                    const list = filled.get(key);
                    if (list === undefined)
                        filled.set(key, [at]);
                    else
                        list.push(at);
                }
            }
        }
        for (const [n, socket] of piece.sockets.entries()) {
            const turned = turnCell(socket.cell, placement.turn);
            const entry = {
                placement: at,
                socket: n,
                piece: piece.name,
                name: socket.name,
                type: socket.type,
                cell: [turned[0] + placement.cell[0], turned[1] + placement.cell[1], turned[2] + placement.cell[2]],
                side: turnSide(socket.side, placement.turn),
            };
            placed.push(entry);
            // Two sockets on one face of one cell: the first stands for the face.
            const key = `${cellKey(entry.cell)}|${entry.side}`;
            if (!faces.has(key))
                faces.set(key, entry);
        }
    }
    const result = { joints: [], open: [], blocked: [], mismatched: [], doubled: [], cells: filled.size };
    for (const [key, list] of filled) {
        if (list.length > 1)
            result.doubled.push({ cell: key.split(",").map(Number), pieces: list.map((at) => layout.placements[at].piece) });
    }
    for (const socket of placed) {
        const step = STEP_OF[socket.side];
        const next = [socket.cell[0] + step[0], socket.cell[1] + step[1], socket.cell[2] + step[2]];
        const other = faces.get(`${cellKey(next)}|${oppositeSide(socket.side)}`);
        if (other === undefined) {
            if (filled.has(cellKey(next)))
                result.blocked.push(socket);
            else
                result.open.push(socket);
            continue;
        }
        // Each pair once: from the side that faces along its axis.
        if (sideSign(socket.side) < 0)
            continue;
        if (mateOf(kit, socket.type) === other.type)
            result.joints.push({ a: socket, b: other });
        else
            result.mismatched.push({ a: socket, b: other });
    }
    return result;
}
/** The cells a piece would fill, or null when one of them is taken. */
function cellsFor(piece, placement, filled) {
    const keys = [];
    for (let x = 0; x < piece.cells[0]; x += 1) {
        for (let y = 0; y < piece.cells[1]; y += 1) {
            for (let z = 0; z < piece.cells[2]; z += 1) {
                const turned = turnCell([x, y, z], placement.turn);
                const key = cellKey([turned[0] + placement.cell[0], turned[1] + placement.cell[1], turned[2] + placement.cell[2]]);
                if (filled.has(key))
                    return null;
                keys.push(key);
            }
        }
    }
    return keys;
}
/** Where a socket of a placed piece faces. */
function faceOf(piece, socket, placement) {
    const turned = turnCell(piece.sockets[socket].cell, placement.turn);
    return {
        cell: [turned[0] + placement.cell[0], turned[1] + placement.cell[1], turned[2] + placement.cell[2]],
        side: turnSide(piece.sockets[socket].side, placement.turn),
        type: piece.sockets[socket].type,
    };
}
/** Puts `piece` with its socket `socket` against a face of what is there, when the types meet and the cells are free. */
function attach(kit, state, face, piece, socket) {
    const own = piece.sockets[socket];
    if (mateOf(kit, face.type) !== own.type)
        return null;
    if (sideAxis(own.side) === 2 || sideAxis(face.side) === 2)
        return null;
    const wanted = oppositeSide(face.side);
    let turn = 0;
    while (turnSide(own.side, turn) !== wanted)
        turn = ((turn + 1) % 4);
    const step = STEP_OF[face.side];
    const turned = turnCell(own.cell, turn);
    const placement = { piece: piece.name, cell: [face.cell[0] + step[0] - turned[0], face.cell[1] + step[1] - turned[1], face.cell[2] + step[2] - turned[2]], turn };
    const keys = cellsFor(piece, placement, state.filled);
    if (keys === null)
        return null;
    state.placements.push(placement);
    for (const key of keys)
        state.filled.add(key);
    return placement;
}
function start(piece) {
    const placement = { piece: piece.name, cell: [0, 0, 0], turn: 0 };
    return { placements: [placement], filled: new Set(cellsFor(piece, placement, new Set())) };
}
/** A layout moved so that its lowest cell along every axis is 0. */
function settled(name, kit, placements) {
    const byName = new Map(kit.pieces.map((piece) => [piece.name, piece]));
    const low = [Infinity, Infinity, Infinity];
    for (const placement of placements) {
        const piece = byName.get(placement.piece);
        for (const corner of [[0, 0, 0], [piece.cells[0] - 1, piece.cells[1] - 1, piece.cells[2] - 1]]) {
            const turned = turnCell(corner, placement.turn);
            for (const axis of [0, 1, 2])
                low[axis] = Math.min(low[axis], turned[axis] + placement.cell[axis]);
        }
    }
    return { name, origin: "generated", placements: placements.map((placement) => ({ piece: placement.piece, cell: [placement.cell[0] - low[0], placement.cell[1] - low[1], placement.cell[2] - low[2]], turn: placement.turn })) };
}
/** The names of the test layouts, in the order they come. */
export const KIT_LAYOUT_NAMES = ["run", "corner", "tee", "cross", "rise", "room"];
/**
 * Builds the test layouts from the sockets alone: a straight run, a corner, a tee, a crossing,
 * a rise from one storey to the next and a closed room. A layout the kit has no pieces for is
 * left out, with the reason.
 *
 * A piece is read by its sockets on the four sides. One: an end. Two on opposite sides of one
 * storey: a through piece. Two at a right angle: a bend. Two on different storeys: a rise.
 * Three and four: a tee and a crossing.
 */
export function kitLayouts(kit) {
    const flat = kit.pieces.filter((piece) => piece.sockets.length > 0 && piece.sockets.every((socket) => sideAxis(socket.side) !== 2));
    const level = (piece) => piece.sockets.every((socket) => socket.cell[2] === piece.sockets[0].cell[2]);
    const two = flat.filter((piece) => piece.sockets.length === 2);
    const ends = flat.filter((piece) => piece.sockets.length === 1);
    const throughs = two.filter((piece) => level(piece) && piece.sockets[0].side === oppositeSide(piece.sockets[1].side));
    const bends = two.filter((piece) => level(piece) && sideAxis(piece.sockets[0].side) !== sideAxis(piece.sockets[1].side));
    const rises = two.filter((piece) => !level(piece));
    const tees = flat.filter((piece) => piece.sockets.length === 3 && level(piece));
    const crossings = flat.filter((piece) => piece.sockets.length === 4 && level(piece));
    const layouts = [];
    const skipped = [];
    const skip = (name, why, reason, reasonValues) => {
        skipped.push({ name, reason, reasonKey: `layouts.skipped.${why}`, reasonValues });
    };
    /** Puts the first of `candidates` that fits against a socket of a placed piece. Returns the piece and the socket it was joined by. */
    const grow = (state, from, socket, placement, candidates) => {
        const face = faceOf(from, socket, placement);
        for (const piece of candidates) {
            for (let n = 0; n < piece.sockets.length; n += 1) {
                const made = attach(kit, state, face, piece, n);
                if (made !== null)
                    return { piece, placement: made, joined: n };
            }
        }
        return null;
    };
    /** A seed piece with a through piece, or failing that an end, on every socket. */
    const around = (name, seeds, what) => {
        const seed = seeds[0];
        if (seed === undefined) {
            skip(name, "no-piece", `No piece has ${what}.`, { layout: name });
            return;
        }
        const state = start(seed);
        const first = state.placements[0];
        let joined = 0;
        for (let socket = 0; socket < seed.sockets.length; socket += 1) {
            if (grow(state, seed, socket, first, [...throughs, ...ends, ...flat]) !== null)
                joined += 1;
        }
        if (joined === 0)
            skip(name, "no-mate", `No piece has a socket that meets a socket of "${seed.name}".`, { piece: seed.name });
        else
            layouts.push(settled(name, kit, state.placements));
    };
    // A straight run: every through piece in turn, at least three pieces, with an end on each end.
    if (throughs.length === 0) {
        skip("run", "no-piece", "No piece has two sockets on opposite sides of one storey.", { layout: "run" });
    }
    else {
        const state = start(throughs[0]);
        let last = { piece: throughs[0], placement: state.placements[0], joined: 0 };
        const count = Math.max(3, throughs.length);
        let whole = true;
        for (let n = 1; n < count && whole; n += 1) {
            const wanted = throughs[n % throughs.length];
            const next = grow(state, last.piece, last.joined === 0 ? 1 : 0, last.placement, [wanted, ...throughs]);
            if (next === null)
                whole = false;
            else
                last = next;
        }
        if (state.placements.length < 2) {
            skip("run", "no-row", `The sockets of "${throughs[0].name}" do not meet each other, so no two through pieces go in a row.`, { piece: throughs[0].name });
        }
        else {
            grow(state, last.piece, last.joined === 0 ? 1 : 0, last.placement, ends);
            grow(state, throughs[0], 0, state.placements[0], ends);
            layouts.push(settled("run", kit, state.placements));
        }
    }
    around("corner", bends, "two sockets at a right angle on one storey");
    around("tee", tees, "three sockets on one storey");
    around("cross", crossings, "four sockets on one storey");
    around("rise", rises, "two sockets on different storeys");
    // A closed room: a ring of four bends with a through piece between each two, every socket met.
    if (bends.length === 0) {
        skip("room", "no-piece", "No piece has two sockets at a right angle on one storey.", { layout: "room" });
    }
    else {
        const bend = bends[0];
        const order = [];
        for (let side = 0; side < 4; side += 1) {
            if (side > 0)
                order.push(bend);
            if (throughs.length > 0)
                order.push(throughs[side % throughs.length]);
        }
        const state = start(bend);
        const close = (at, from, socket, placement) => {
            const face = faceOf(from, socket, placement);
            if (at === order.length) {
                // The ring is closed when the last free socket faces the first piece's own free socket.
                const first = faceOf(bend, 0, state.placements[0]);
                const step = STEP_OF[face.side];
                return first.side === oppositeSide(face.side) && cellKey(first.cell) === cellKey([face.cell[0] + step[0], face.cell[1] + step[1], face.cell[2] + step[2]]) && mateOf(kit, face.type) === first.type;
            }
            const piece = order[at];
            for (let n = 0; n < piece.sockets.length; n += 1) {
                const before = { placements: state.placements.length, filled: new Set(state.filled) };
                const made = attach(kit, state, face, piece, n);
                if (made === null)
                    continue;
                if (close(at + 1, piece, n === 0 ? 1 : 0, made))
                    return true;
                state.placements.length = before.placements;
                state.filled = before.filled;
            }
            return false;
        };
        if (close(0, bend, 1, state.placements[0]))
            layouts.push(settled("room", kit, state.placements));
        else
            skip("room", "no-ring", `Four of "${bend.name}"${throughs.length > 0 ? " with a through piece between each two" : ""} do not close a ring.`, { piece: bend.name, throughs: throughs.length });
    }
    return { layouts, skipped };
}
