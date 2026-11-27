import { GameExportError, refuse } from "./errors.js";
import { convexHull, meshVolume } from "./hull.js";
/** The collision volume may differ from the visible part's by this share before `auto` moves on. */
export const DEFAULT_COLLISION_TOLERANCE = 0.05;
/** The most convex pieces a decomposition makes. */
export const DEFAULT_MAX_COLLISION_PIECES = 8;
/** The most corners one convex piece has. */
export const DEFAULT_MAX_HULL_VERTICES = 64;
/** How many places along each axis a decomposition tries to cut a part. */
export const DECOMPOSITION_CUTS_PER_AXIS = 12;
const REQUESTS = ["none", "auto", "box", "hull", "pieces", "decomposition"];
/** Cheapest first. */
const TIERS = ["box", "hull", "pieces", "decomposition"];
/**
 * A kernel from the `manifold-3d` package. Give it the module once it is set up:
 *
 *   const wasm = await Module();
 *   wasm.setup();
 *   const kernel = manifoldKernel(wasm);
 */
export function manifoldKernel(module) {
    return { solid: (positions, indices) => new module.Manifold(new module.Mesh({ numProp: 3, vertProperties: positions, triVerts: indices })) };
}
/** Reads the `collision` option: a shape by name, or settings. Refuses anything else. */
export function readCollisionSettings(option) {
    const given = option === undefined ? {} : typeof option === "string" ? { shape: option } : option;
    if (typeof given !== "object" || given === null)
        refuse("BAD_OPTION", `collision must be one of ${REQUESTS.map((name) => `"${name}"`).join(", ")} or { shape, tolerance, maxPieces, maxHullVertices }.`);
    const shape = given.shape ?? "auto";
    if (!REQUESTS.includes(shape))
        refuse("BAD_OPTION", `collision shape must be one of ${REQUESTS.map((name) => `"${name}"`).join(", ")}. Got ${JSON.stringify(shape)}.`);
    const tolerance = given.tolerance ?? DEFAULT_COLLISION_TOLERANCE;
    if (!(Number.isFinite(tolerance) && tolerance >= 0))
        refuse("BAD_OPTION", `collision tolerance must be zero or a positive share of the visible volume, like 0.05. Got ${String(tolerance)}.`);
    const maxPieces = given.maxPieces ?? DEFAULT_MAX_COLLISION_PIECES;
    if (!(Number.isInteger(maxPieces) && maxPieces >= 1))
        refuse("BAD_OPTION", `collision maxPieces must be a whole number of at least 1. Got ${String(maxPieces)}.`);
    const maxHullVertices = given.maxHullVertices ?? DEFAULT_MAX_HULL_VERTICES;
    if (!(Number.isInteger(maxHullVertices) && maxHullVertices >= 4))
        refuse("BAD_OPTION", `collision maxHullVertices must be a whole number of at least 4. Got ${String(maxHullVertices)}.`);
    return { shape, tolerance, maxPieces, maxHullVertices };
}
/** The box around points, as a piece: 8 corners and 12 triangles. Null when the box has no volume. */
function boxPiece(positions) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let at = 0; at < positions.length; at += 1) {
        const value = positions[at];
        if (value < min[at % 3])
            min[at % 3] = value;
        if (value > max[at % 3])
            max[at % 3] = value;
    }
    const volume = (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
    if (!(volume > 0))
        return null;
    const corners = new Float64Array(24);
    for (let corner = 0; corner < 8; corner += 1) {
        corners[corner * 3] = corner & 1 ? max[0] : min[0];
        corners[corner * 3 + 1] = corner & 2 ? max[1] : min[1];
        corners[corner * 3 + 2] = corner & 4 ? max[2] : min[2];
    }
    // Two triangles per side, facing outwards.
    const indices = Uint32Array.from([0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6]);
    return { positions: corners, indices, volume, capped: false, kind: "box" };
}
/** Each place in space once: the kernel needs a mesh whose triangles share vertices where they meet. */
export function weldExact(positions, indices) {
    const numberOf = new Map();
    const remap = new Uint32Array(positions.length / 3);
    const kept = [];
    for (let vertex = 0; vertex < remap.length; vertex += 1) {
        const x = Math.fround(positions[vertex * 3]) + 0;
        const y = Math.fround(positions[vertex * 3 + 1]) + 0;
        const z = Math.fround(positions[vertex * 3 + 2]) + 0;
        const key = `${x},${y},${z}`;
        let number = numberOf.get(key);
        if (number === undefined) {
            number = numberOf.size;
            numberOf.set(key, number);
            kept.push(x, y, z);
        }
        remap[vertex] = number;
    }
    const welded = new Uint32Array(indices.length);
    for (let at = 0; at < indices.length; at += 1)
        welded[at] = remap[indices[at]];
    return { positions: Float32Array.from(kept), indices: welded };
}
/**
 * A general convex decomposition: the solid is cut by planes along the axes, the part whose hull
 * adds the most volume first and at the place that leaves the least, until the hulls together
 * are within the tolerance or there are as many parts as allowed.
 */
function decompose(source, kernel, visibleVolume, settings) {
    const made = [];
    const keep = (solid) => {
        made.push(solid);
        return solid;
    };
    const measure = (solid) => {
        const volume = solid.volume();
        const hull = keep(solid.hull());
        return { solid, volume, excess: Math.max(0, hull.volume() - volume), settled: false };
    };
    /** The parts of a solid that do not touch, measured. Parts with next to no volume are left out. */
    const partsOf = (solid) => {
        const separate = solid.decompose === undefined ? [solid] : solid.decompose().map(keep);
        return separate.map(measure).filter((part) => part.volume > visibleVolume * 1e-9);
    };
    try {
        const welded = weldExact(source.positions, source.indices);
        let parts = partsOf(keep(kernel.solid(welded.positions, welded.indices)));
        if (parts.length === 0)
            refuse("BAD_COLLISION", `Body "${source.name}": the kernel made a solid with no volume from the body.`);
        for (;;) {
            const excess = parts.reduce((total, part) => total + part.excess, 0);
            if (excess <= settings.tolerance * visibleVolume || parts.length >= settings.maxPieces)
                break;
            let worst = -1;
            for (const [at, part] of parts.entries()) {
                if (!part.settled && part.excess > 0 && (worst < 0 || part.excess > parts[worst].excess))
                    worst = at;
            }
            if (worst < 0)
                break;
            const part = parts[worst];
            // Places to cut: where the part has vertices, strictly inside it, and at most so many per axis.
            const mesh = part.solid.getMesh();
            // A cut is taken even when it leaves as much over as before: a ring only gets better at
            // the second cut. The number of parts allowed is what ends the cutting.
            let chosen;
            let chosenExcess = Infinity;
            let chosenBalance = Infinity;
            for (let axis = 0; axis < 3; axis += 1) {
                const values = new Set();
                let low = Infinity;
                let high = -Infinity;
                for (let at = axis; at < mesh.vertProperties.length; at += mesh.numProp) {
                    const value = mesh.vertProperties[at];
                    values.add(value);
                    if (value < low)
                        low = value;
                    if (value > high)
                        high = value;
                }
                const margin = (high - low) * 1e-6;
                let cuts = [...values].filter((value) => value > low + margin && value < high - margin).sort((a, b) => a - b);
                if (cuts.length > DECOMPOSITION_CUTS_PER_AXIS) {
                    const all = cuts;
                    cuts = Array.from({ length: DECOMPOSITION_CUTS_PER_AXIS }, (_, at) => all[Math.floor(((at + 0.5) * all.length) / DECOMPOSITION_CUTS_PER_AXIS)]);
                }
                if (cuts.length === 0)
                    cuts = [(low + high) / 2];
                const normal = [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0];
                for (const cut of cuts) {
                    const halves = part.solid.splitByPlane(normal, cut).map(keep);
                    const pieces = halves.flatMap(partsOf);
                    if (pieces.length < 2 || parts.length - 1 + pieces.length > settings.maxPieces)
                        continue;
                    const left = pieces.reduce((total, piece) => total + piece.excess, 0);
                    const balance = Math.max(...pieces.map((piece) => piece.volume)) / part.volume;
                    // Less left over wins. Between cuts that leave the same, the one with the more even parts.
                    const same = Math.abs(left - chosenExcess) <= visibleVolume * 1e-6;
                    if (same ? balance < chosenBalance - 1e-6 : left < chosenExcess) {
                        chosen = pieces;
                        chosenExcess = left;
                        chosenBalance = balance;
                    }
                }
            }
            if (chosen === undefined) {
                part.settled = true;
                continue;
            }
            parts = [...parts.slice(0, worst), ...chosen, ...parts.slice(worst + 1)];
        }
        // Each part is written as the hull of its own vertices, built here the same way as every other piece.
        return parts.map((part) => {
            const mesh = part.solid.getMesh();
            const points = new Float64Array((mesh.vertProperties.length / mesh.numProp) * 3);
            for (let vertex = 0; vertex < points.length / 3; vertex += 1) {
                for (let axis = 0; axis < 3; axis += 1)
                    points[vertex * 3 + axis] = mesh.vertProperties[vertex * mesh.numProp + axis];
            }
            const hull = convexHull(points, settings.maxHullVertices);
            if (hull === null)
                refuse("BAD_COLLISION", `Body "${source.name}": a part of the decomposition is flat, so it has no convex hull.`);
            return { ...hull, kind: "convex" };
        });
    }
    catch (error) {
        if (error instanceof GameExportError)
            throw error;
        return refuse("BAD_COLLISION", `Body "${source.name}": the kernel could not decompose the body: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        for (const solid of made)
            solid.delete?.();
    }
}
/**
 * Plans the collision shape of one body.
 *
 * A shape asked for by name is built or refused. `"auto"` builds the tiers cheapest first (one
 * box, one convex hull, the caller's pieces, a decomposition by the kernel) and takes the first
 * whose volume is within the tolerance of the visible part's. When none is, it takes the nearest.
 * A body that is not closed has no volume to compare with, and gets its convex hull.
 */
export function planCollision(source, settings, kernel) {
    const requested = settings.shape;
    const notes = [];
    const tried = [];
    if (requested === "none")
        return { requested, chosen: null, visibleVolume: null, tried, notes };
    let visibleVolume = null;
    if (source.closed) {
        const volume = meshVolume(source.positions, source.indices);
        if (volume > 0)
            visibleVolume = volume;
        else
            notes.push("The body encloses no volume, so collision volume is not compared with it.");
    }
    else {
        notes.push("The body is not closed, so it has no volume to compare collision with.");
    }
    const build = (shape) => {
        switch (shape) {
            case "box": {
                const piece = boxPiece(source.positions);
                return piece === null ? "The body is flat, so the box around it has no volume." : [piece];
            }
            case "hull": {
                const hull = convexHull(source.positions, settings.maxHullVertices);
                return hull === null ? "The body is flat, so it has no convex hull." : [{ ...hull, kind: "convex" }];
            }
            case "pieces": {
                if (source.pieces === undefined || source.pieces.length === 0)
                    return "No collision pieces were given for the body.";
                const pieces = [];
                for (const [at, points] of source.pieces.entries()) {
                    const hull = convexHull(points, settings.maxHullVertices);
                    if (hull === null)
                        return `Collision piece ${at} of the body is flat, so it has no convex hull.`;
                    pieces.push({ ...hull, kind: "convex" });
                }
                return pieces;
            }
            case "decomposition": {
                if (kernel === undefined)
                    return "No kernel was given, and a general convex decomposition needs one.";
                if (visibleVolume === null)
                    return "A general convex decomposition needs a closed body with a volume.";
                return decompose(source, kernel, visibleVolume, settings);
            }
        }
    };
    const attempt = (shape) => {
        const pieces = build(shape);
        if (typeof pieces === "string")
            return pieces;
        const volume = pieces.reduce((total, piece) => total + piece.volume, 0);
        const error = visibleVolume === null ? null : (volume - visibleVolume) / visibleVolume;
        const made = { shape, pieces, volume, error, withinTolerance: error === null ? null : Math.abs(error) <= settings.tolerance };
        tried.push(made);
        return made;
    };
    if (requested !== "auto") {
        const made = attempt(requested);
        if (typeof made === "string")
            refuse("BAD_COLLISION", `Body "${source.name}": collision "${requested}" cannot be built. ${made}`);
        return { requested, chosen: made, visibleVolume, tried, notes };
    }
    for (const shape of TIERS) {
        // Without a volume to compare with, the tiers past the hull have nothing to be chosen by.
        if (visibleVolume === null && (shape === "pieces" || shape === "decomposition"))
            continue;
        const made = attempt(shape);
        if (typeof made === "string") {
            notes.push(made);
            continue;
        }
        if (made.withinTolerance === true)
            return { requested, chosen: made, visibleVolume, tried, notes };
    }
    let chosen = null;
    if (visibleVolume === null) {
        chosen = tried.find((made) => made.shape === "hull") ?? tried[0] ?? null;
    }
    else {
        for (const made of tried) {
            if (chosen === null || Math.abs(made.error) < Math.abs(chosen.error))
                chosen = made;
        }
        if (chosen !== null)
            notes.push("No tier is within the tolerance. The nearest was taken.");
    }
    if (chosen === null)
        notes.push("No collision shape could be built.");
    return { requested, chosen, visibleVolume, tried, notes };
}
