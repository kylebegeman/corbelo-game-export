import { forBody, refuse } from "./errors.js";
import { BinaryBuilder, encodeGlb } from "./glb-write.js";
import { EXTRAS_KEY, COMPONENT_FLOAT, COMPONENT_UNSIGNED_INT, COMPONENT_UNSIGNED_SHORT, MODE_TRIANGLES, TARGET_ARRAY_BUFFER, TARGET_ELEMENT_ARRAY_BUFFER, } from "./gltf.js";
import { MATERIAL_METALLIC, MATERIAL_ROUGHNESS, planColors } from "./materials.js";
import { buildMesh, splitMesh } from "./mesh.js";
import { nodeNames } from "./names.js";
import { resolveProfile } from "./profiles.js";
import { pointToGltfSpace, pointToSourceSpace, spaceConversion, toGltfSpace } from "./space.js";
import { GENERATOR } from "./version.js";
export const DEFAULT_CREASE_ANGLE = 30;
/** Metres. One micron. */
export const DEFAULT_WELD_TOLERANCE = 1e-6;
/** Triangles across all bodies of one export. Raise or lower it with `maxTriangles`. */
export const DEFAULT_MAX_TRIANGLES = 2_000_000;
const PIVOT_MODES = ["base-center", "center", "min-corner", "origin"];
const MAX_JSON_DEPTH = 64;
function isArrayLike(value) {
    return (Array.isArray(value) || ArrayBuffer.isView(value)) && typeof value.length === "number";
}
export function assertJson(value, path, depth) {
    if (value === null || typeof value === "boolean" || typeof value === "string")
        return;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            refuse("BAD_PROVENANCE", `${path} is not a finite number, so it cannot be stored as JSON.`);
        return;
    }
    if (depth >= MAX_JSON_DEPTH)
        refuse("BAD_PROVENANCE", `${path} is nested more than ${MAX_JSON_DEPTH} levels deep.`);
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertJson(item, `${path}[${index}]`, depth + 1));
        return;
    }
    if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        for (const [key, item] of Object.entries(value))
            assertJson(item, `${path}.${key}`, depth + 1);
        return;
    }
    refuse("BAD_PROVENANCE", `${path} is not plain JSON (null, boolean, number, string, array or object).`);
}
function readSettings(input) {
    const creaseAngle = input.creaseAngle ?? DEFAULT_CREASE_ANGLE;
    if (!(Number.isFinite(creaseAngle) && creaseAngle >= 0 && creaseAngle <= 180)) {
        refuse("BAD_OPTION", `creaseAngle must be from 0 to 180 degrees. Got ${String(creaseAngle)}.`);
    }
    const weldTolerance = input.weldTolerance ?? DEFAULT_WELD_TOLERANCE;
    if (!(Number.isFinite(weldTolerance) && weldTolerance >= 0)) {
        refuse("BAD_OPTION", `weldTolerance must be zero or a positive number of metres. Got ${String(weldTolerance)}.`);
    }
    const maxTriangles = input.maxTriangles ?? DEFAULT_MAX_TRIANGLES;
    if (!(Number.isInteger(maxTriangles) && maxTriangles > 0)) {
        refuse("BAD_OPTION", `maxTriangles must be a positive whole number. Got ${String(maxTriangles)}.`);
    }
    const normals = input.normals ?? "angle-area";
    if (normals !== "angle-area" && normals !== "face-weighted") {
        refuse("BAD_OPTION", `normals must be "angle-area" or "face-weighted". Got ${JSON.stringify(normals)}.`);
    }
    const placement = input.placement ?? "origin";
    if (placement !== "origin" && placement !== "designed" && placement !== "assembly") {
        refuse("BAD_OPTION", `placement must be "origin", "designed" or "assembly". Got ${JSON.stringify(placement)}.`);
    }
    const colorSpace = input.colorSpace ?? "srgb";
    if (colorSpace !== "srgb" && colorSpace !== "linear") {
        refuse("BAD_OPTION", `colorSpace must be "srgb" or "linear". Got ${JSON.stringify(colorSpace)}.`);
    }
    const pivot = input.pivot ?? "base-center";
    let pivotMode;
    if (typeof pivot === "string") {
        if (!PIVOT_MODES.includes(pivot)) {
            refuse("BAD_OPTION", `pivot must be one of ${PIVOT_MODES.map((mode) => `"${mode}"`).join(", ")} or a point [x, y, z]. Got ${JSON.stringify(pivot)}.`);
        }
        pivotMode = pivot;
    }
    else {
        if (!Array.isArray(pivot) || pivot.length !== 3 || !pivot.every((value) => Number.isFinite(value))) {
            refuse("BAD_OPTION", "A pivot point must be three finite numbers [x, y, z] in source units.");
        }
        pivotMode = "point";
    }
    if (input.provenance !== undefined)
        assertJson(input.provenance, "provenance", 0);
    return {
        profile: resolveProfile(input.profile),
        pivot,
        pivotMode,
        placement,
        creaseAngle,
        normals,
        weldTolerance,
        maxTriangles,
        colorSpace,
        provenance: input.provenance,
    };
}
/**
 * Checks the arrays of a mesh and returns how many triangles it has. Refuses anything malformed.
 * `label` starts the message and `what` is the mesh in the middle of a sentence: "the body".
 */
export function checkMesh(mesh, label, what) {
    const { positions, indices, faceIds } = mesh;
    if (!isArrayLike(positions))
        refuse("BAD_POSITIONS", `${label}: positions must be a Float32Array or an array of numbers.`);
    if (positions.length === 0)
        refuse("EMPTY_BODY", `${label} has no vertices.`);
    if (positions.length % 3 !== 0)
        refuse("BAD_POSITIONS", `${label}: positions holds ${positions.length} numbers, which is not a whole number of x, y, z vertices.`);
    const vertexCount = positions.length / 3;
    for (let at = 0; at < positions.length; at += 1) {
        if (!Number.isFinite(positions[at])) {
            refuse("NON_FINITE_POSITION", `${label}: vertex ${Math.floor(at / 3)} has a coordinate that is not a finite number (${String(positions[at])}).`);
        }
    }
    let triangles;
    if (indices === undefined) {
        if (vertexCount % 3 !== 0) {
            refuse("BAD_POSITIONS", `${label}: without indices every three vertices make a triangle, but there are ${vertexCount} vertices.`);
        }
        triangles = vertexCount / 3;
    }
    else {
        if (!isArrayLike(indices))
            refuse("BAD_INDICES", `${label}: indices must be a typed array or an array of numbers.`);
        if (indices.length === 0)
            refuse("EMPTY_BODY", `${label} has no triangles.`);
        if (indices.length % 3 !== 0)
            refuse("BAD_INDICES", `${label}: indices holds ${indices.length} numbers, which is not a whole number of triangles.`);
        for (let at = 0; at < indices.length; at += 1) {
            const value = indices[at];
            if (!Number.isInteger(value))
                refuse("BAD_INDICES", `${label}: index ${at} is ${String(value)}, not a whole number.`);
            if (value < 0 || value >= vertexCount) {
                refuse("INDEX_OUT_OF_RANGE", `${label}: index ${at} points at vertex ${value}, but ${what} has ${vertexCount} vertices.`);
            }
        }
        triangles = indices.length / 3;
    }
    if (faceIds !== undefined) {
        if (!isArrayLike(faceIds))
            refuse("BAD_FACE_IDS", `${label}: faceIds must be a typed array or an array of numbers.`);
        if (faceIds.length !== triangles) {
            refuse("BAD_FACE_IDS", `${label}: faceIds holds ${faceIds.length} ids for ${triangles} triangles. It needs exactly one per triangle.`);
        }
        for (let at = 0; at < faceIds.length; at += 1) {
            if (!Number.isInteger(faceIds[at]))
                refuse("BAD_FACE_IDS", `${label}: face id ${at} is ${String(faceIds[at])}, not a whole number.`);
        }
    }
    return triangles;
}
/**
 * Checks one body's arrays and returns how many triangles it has, and how many the meshes it
 * refines have together. Refuses anything malformed.
 */
function checkBody(body, index) {
    if (typeof body !== "object" || body === null)
        refuse("BAD_POSITIONS", `Body ${index} is not an object.`);
    if (typeof body.name !== "string" || body.name.trim() === "")
        refuse("BAD_NAME", `Body ${index} needs a name.`);
    const label = `Body "${body.name}"`;
    const triangles = checkMesh(body, label, "the body");
    const { faceColors, refines } = body;
    // The colours themselves are read with the body's own colour, in `planColors`.
    if (faceColors !== undefined) {
        if (!Array.isArray(faceColors))
            refuse("BAD_FACE_COLORS", `${label}: faceColors must be an array with one colour, or null, per triangle.`);
        if (faceColors.length !== triangles) {
            refuse("BAD_FACE_COLORS", `${label}: faceColors holds ${faceColors.length} entries for ${triangles} triangles. It needs exactly one per triangle.`);
        }
    }
    let refined = 0;
    if (refines !== undefined) {
        if (typeof refines !== "object" || refines === null)
            refuse("BAD_REFINEMENT", `${label}: refines must be { surfaces, triangleOf }.`);
        const { surfaces, surfaceOf, triangleOf } = refines;
        if (!Array.isArray(surfaces) || surfaces.length === 0)
            refuse("BAD_REFINEMENT", `${label}: refines.surfaces must be an array with at least one mesh.`);
        const surfaceTriangles = surfaces.map((surface, at) => {
            const surfaceLabel = `${label}, surface ${at} of refines`;
            if (typeof surface !== "object" || surface === null)
                refuse("BAD_REFINEMENT", `${surfaceLabel} is not an object.`);
            return checkMesh(surface, surfaceLabel, "the surface");
        });
        refined = surfaceTriangles.reduce((total, count) => total + count, 0);
        const wholeNumbers = (values, key) => {
            if (!isArrayLike(values))
                refuse("BAD_REFINEMENT", `${label}: refines.${key} must be a typed array or an array of numbers.`);
            if (values.length !== triangles) {
                refuse("BAD_REFINEMENT", `${label}: refines.${key} holds ${values.length} numbers for ${triangles} triangles. It needs exactly one per triangle.`);
            }
            return values;
        };
        if (surfaceOf === undefined && surfaces.length > 1) {
            refuse("BAD_REFINEMENT", `${label}: refines has ${surfaces.length} surfaces, so it needs surfaceOf to say which one each triangle lies in.`);
        }
        const ofSurface = surfaceOf === undefined ? undefined : wholeNumbers(surfaceOf, "surfaceOf");
        const ofTriangle = wholeNumbers(triangleOf, "triangleOf");
        for (let at = 0; at < triangles; at += 1) {
            const surface = ofSurface === undefined ? 0 : ofSurface[at];
            if (!Number.isInteger(surface) || surface < 0 || surface >= surfaces.length) {
                refuse("BAD_REFINEMENT", `${label}: refines.surfaceOf says triangle ${at} lies in surface ${String(surface)}, but there are ${surfaces.length} surfaces, numbered from 0.`);
            }
            const triangle = ofTriangle[at];
            if (!Number.isInteger(triangle) || triangle < 0 || triangle >= surfaceTriangles[surface]) {
                refuse("BAD_REFINEMENT", `${label}: refines.triangleOf says triangle ${at} lies in triangle ${String(triangle)}, but ${surfaces.length > 1 ? `surface ${surface}` : "the surface"} has ${surfaceTriangles[surface]} triangles, numbered from 0.`);
            }
        }
    }
    return { triangles, refined };
}
export function boundsOf(positions) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let at = 0; at < positions.length; at += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
            const value = positions[at + axis];
            if (value < min[axis])
                min[axis] = value;
            if (value > max[axis])
                max[axis] = value;
        }
    }
    return { min, max };
}
function pivotPoint(settings, bounds, conversion) {
    const { min, max } = bounds;
    if (typeof settings.pivot !== "string")
        return pointToGltfSpace(settings.pivot, conversion);
    switch (settings.pivot) {
        case "base-center":
            return [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
        case "center":
            return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
        case "min-corner":
            // The corner with the lowest source coordinates. A source axis that was negated on the
            // way to glTF space has its lowest value at the glTF maximum.
            return [min[0], min[1], conversion.depthSign < 0 ? max[2] : min[2]];
        case "origin":
            return [0, 0, 0];
    }
}
/** glTF metres to the engine's unit, with the up axis moved to the engine's up axis. */
export function toEngine(point, profile) {
    const scale = 1 / profile.unitMeters;
    const [x, y, z] = [point[0] * scale + 0, point[1] * scale + 0, point[2] * scale + 0];
    return profile.up === "Y" ? [x, y, z] : [x, z, y];
}
function box(min, max) {
    return { min: [min[0] + 0, min[1] + 0, min[2] + 0], max: [max[0] + 0, max[1] + 0, max[2] + 0], size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
export function measuredBox(min, max, profile) {
    return { meters: box(min, max), engine: box(toEngine(min, profile), toEngine(max, profile)) };
}
function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
/** The `size` numbers of each listed vertex, in the order listed. */
function gather(values, vertexOf, size) {
    const out = new Float32Array(vertexOf.length * size);
    for (let vertex = 0; vertex < vertexOf.length; vertex += 1) {
        const from = vertexOf[vertex] * size;
        for (let part = 0; part < size; part += 1)
            out[vertex * size + part] = values[from + part];
    }
    return out;
}
function compareText(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
/**
 * Checks the input, builds every body and writes its mesh and node into a glTF document that is
 * not encoded yet. `exportGameGlb` is this and `finishScene`, one after the other.
 */
export function draftScene(input, extension = {}) {
    const caller = extension.caller ?? "exportGameGlb";
    if (typeof input !== "object" || input === null)
        refuse("NO_BODIES", `${caller} needs { bodies, source }.`);
    const settings = readSettings(input);
    const conversion = spaceConversion(input.source);
    const { bodies } = input;
    if (!Array.isArray(bodies) || bodies.length === 0)
        refuse("NO_BODIES", "There are no bodies to export.");
    const levelsOf = (index) => extension.levels?.[index] ?? [];
    // The meshes that bodies refine are not written, so they are counted on their own.
    let inputTriangles = 0;
    let refinedTriangles = 0;
    for (const [index, body] of bodies.entries()) {
        const counted = forBody(index, () => {
            const own = checkBody(body, index);
            let levelTriangles = 0;
            for (const [at, level] of levelsOf(index).entries()) {
                const label = `Body "${body.name}", detail level ${at + 1}`;
                if (typeof level !== "object" || level === null)
                    refuse("BAD_LOD", `${label} is not an object with positions.`);
                const triangles = checkMesh(level, label, "the level");
                if (level.faceColors !== undefined && (!Array.isArray(level.faceColors) || level.faceColors.length !== triangles)) {
                    refuse("BAD_FACE_COLORS", `${label}: faceColors needs exactly one colour, or null, for each of its ${triangles} triangles.`);
                }
                levelTriangles += triangles;
            }
            return { triangles: own.triangles + levelTriangles, refined: own.refined };
        });
        inputTriangles += counted.triangles;
        if (inputTriangles > settings.maxTriangles) {
            refuse("TOO_MANY_TRIANGLES", `The bodies hold more than ${settings.maxTriangles} triangles, the limit for one export. Simplify the mesh or raise maxTriangles.`);
        }
        refinedTriangles += counted.refined;
        if (refinedTriangles > settings.maxTriangles) {
            refuse("TOO_MANY_TRIANGLES", `The meshes that bodies refine hold more than ${settings.maxTriangles} triangles, the limit for one export. Raise maxTriangles.`);
        }
    }
    const names = nodeNames(bodies.map((body) => body.name));
    // A lower level takes its colours as a body of its own would, with its body's own colour and
    // names, so the same colour is the same material at every level.
    const levelColorsAt = [];
    const colorSources = [...bodies];
    for (const [index, body] of bodies.entries()) {
        levelColorsAt.push(levelsOf(index).map((level, at) => {
            colorSources.push({
                name: `${body.name}, detail level ${at + 1}`,
                positions: level.positions,
                ...(body.color !== undefined ? { color: body.color } : {}),
                ...(body.materialName !== undefined ? { materialName: body.materialName } : {}),
                ...(level.faceColors !== undefined ? { faceColors: level.faceColors } : {}),
                ...(body.faceMaterialNames !== undefined ? { faceMaterialNames: body.faceMaterialNames } : {}),
            });
            return colorSources.length - 1;
        }));
    }
    const colors = planColors(colorSources, settings.colorSpace);
    const { profile } = settings;
    const meshOptions = {
        reverseWinding: conversion.mirrored,
        weldTolerance: settings.weldTolerance,
        creaseAngle: settings.creaseAngle,
        normals: settings.normals,
    };
    const construct = (source, coarse) => {
        const points = new Float64Array(source.positions.length);
        toGltfSpace(source.positions, conversion, points);
        // With `refines` the body's own face ids have no say in the shading: the surfaces' have.
        return buildMesh(points, source.indices, coarse === undefined ? source.faceIds : undefined, meshOptions, coarse);
    };
    const shaped = bodies.map((body, index) => forBody(index, () => {
        // The meshes a body refines are built first, each by itself and by the same rules as a body.
        let coarse;
        if (body.refines !== undefined) {
            const meshes = [];
            const keptOf = [];
            for (const surface of body.refines.surfaces) {
                const surfaceMesh = construct(surface);
                const kept = new Int32Array(surfaceMesh.triangles + surfaceMesh.degenerateTrianglesDropped).fill(-1);
                for (let t = 0; t < surfaceMesh.triangles; t += 1)
                    kept[surfaceMesh.sourceTriangle[t]] = t;
                meshes.push(surfaceMesh);
                keptOf.push(kept);
            }
            coarse = { meshes, keptOf, surfaceOf: body.refines.surfaceOf, triangleOf: body.refines.triangleOf, where: `Body "${body.name}"` };
        }
        const mesh = construct(body, coarse);
        if (mesh.triangles === 0) {
            refuse("ALL_DEGENERATE", `Body "${body.name}": all ${mesh.degenerateTrianglesDropped} triangles have no area, so nothing is left to export.`);
        }
        const shadedFrom = coarse === undefined ? undefined : { surfaces: coarse.meshes.length, triangles: coarse.meshes.reduce((total, surface) => total + surface.triangles, 0) };
        const levels = levelsOf(index).map((level, at) => {
            const levelMesh = construct(level);
            if (levelMesh.triangles === 0) {
                refuse("ALL_DEGENERATE", `Body "${body.name}", detail level ${at + 1}: all ${levelMesh.degenerateTrianglesDropped} triangles have no area, so nothing is left to export.`);
            }
            return levelMesh;
        });
        return { mesh, shadedFrom, levels };
    }));
    // An assembly has one pivot of its own, taken from the box around every body as modelled.
    // It ends up at the scene origin, and each body keeps its place relative to it.
    let assemblyPivot;
    if (settings.placement === "assembly") {
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (const { mesh } of shaped) {
            const bounds = boundsOf(mesh.positions);
            for (let axis = 0; axis < 3; axis += 1) {
                min[axis] = Math.min(min[axis], bounds.min[axis]);
                max[axis] = Math.max(max[axis], bounds.max[axis]);
            }
        }
        assemblyPivot = pivotPoint(settings, { min, max }, conversion);
    }
    const byName = extension.slotOrder === "name";
    // Vertex data is stored relative to the pivot, as 32-bit floats. Everything reported is
    // measured from those stored values. A lower level shares the pivot of its body.
    const prepare = (built, pivot, translation, colorsAt) => {
        let mesh = built;
        let uvs;
        if (extension.texture !== undefined) {
            ({ mesh, uvs } = extension.texture(built, [translation[0] - pivot[0], translation[1] - pivot[1], translation[2] - pivot[2]]));
        }
        const stored = new Float32Array(mesh.positions.length);
        for (let at = 0; at < stored.length; at += 3) {
            stored[at] = mesh.positions[at] - pivot[0];
            stored[at + 1] = mesh.positions[at + 1] - pivot[1];
            stored[at + 2] = mesh.positions[at + 2] - pivot[2];
        }
        // One part per colour that a kept triangle has. Normals are settled by now, on the whole mesh.
        let parts = splitMesh(mesh, colors.ofTriangle[colorsAt], colors.ofBody[colorsAt]);
        if (byName)
            parts = [...parts].sort((a, b) => compareText(colors.candidates[a.group].name, colors.candidates[b.group].name));
        return { mesh, uvs, stored, local: boundsOf(stored), parts };
    };
    const prepared = shaped.map(({ mesh, levels }, index) => {
        const pivot = pivotPoint(settings, boundsOf(mesh.positions), conversion);
        const translation = assemblyPivot !== undefined
            ? [pivot[0] - assemblyPivot[0] + 0, pivot[1] - assemblyPivot[1] + 0, pivot[2] - assemblyPivot[2] + 0]
            : settings.placement === "designed"
                ? [pivot[0] + 0, pivot[1] + 0, pivot[2] + 0]
                : [0, 0, 0];
        return {
            pivot,
            translation,
            full: prepare(mesh, pivot, translation, index),
            levels: levels.map((level, at) => prepare(level, pivot, translation, levelColorsAt[index][at])),
        };
    });
    // The materials written are the ones a kept triangle uses, in the order bodies and their
    // parts first use them. A colour whose triangles were all dropped is not in the file.
    let materials = [];
    const slotOfCandidate = new Int32Array(colors.candidates.length).fill(-1);
    for (const { full, levels } of prepared) {
        const counted = new Set();
        for (const { parts } of [full, ...levels]) {
            for (const part of parts) {
                if (slotOfCandidate[part.group] < 0) {
                    slotOfCandidate[part.group] = materials.length;
                    materials.push(colors.candidates[part.group]);
                }
                if (counted.has(part.group))
                    continue;
                counted.add(part.group);
                materials[slotOfCandidate[part.group]].bodies += 1;
            }
        }
    }
    if (byName) {
        materials = [...materials].sort((a, b) => compareText(a.name, b.name));
        for (const [candidate, material] of colors.candidates.entries())
            slotOfCandidate[candidate] = materials.indexOf(material);
    }
    const binary = new BinaryBuilder();
    const json = {
        asset: { version: "2.0", generator: GENERATOR },
        scene: 0,
        scenes: [{ nodes: [] }],
        nodes: [],
        meshes: [],
        materials: materials.map((material) => ({
            name: material.name,
            pbrMetallicRoughness: { baseColorFactor: material.baseColorFactor, metallicFactor: MATERIAL_METALLIC, roughnessFactor: MATERIAL_ROUGHNESS },
        })),
        accessors: [],
        bufferViews: binary.views,
        buffers: [],
    };
    // One primitive per part, each with index and vertex data of its own. A vertex on the border
    // between two parts is taken from the same stored numbers for both.
    const write = (name, item) => {
        const { mesh, uvs, stored, local, parts } = item;
        const accessors = json.accessors;
        const primitives = [];
        const slots = [];
        for (const part of parts) {
            const { vertexOf } = part;
            const positions = vertexOf === undefined ? stored : gather(stored, vertexOf, 3);
            const bounds = vertexOf === undefined ? local : boundsOf(positions);
            const small = part.vertices <= 65535;
            const indexData = small ? Uint16Array.from(part.indices) : part.indices;
            accessors.push({
                bufferView: binary.add(indexData, TARGET_ELEMENT_ARRAY_BUFFER),
                componentType: small ? COMPONENT_UNSIGNED_SHORT : COMPONENT_UNSIGNED_INT,
                count: indexData.length,
                type: "SCALAR",
            }, { bufferView: binary.add(positions, TARGET_ARRAY_BUFFER), componentType: COMPONENT_FLOAT, count: part.vertices, type: "VEC3", min: bounds.min, max: bounds.max }, {
                bufferView: binary.add(vertexOf === undefined ? mesh.normals : gather(mesh.normals, vertexOf, 3), TARGET_ARRAY_BUFFER),
                componentType: COMPONENT_FLOAT,
                count: part.vertices,
                type: "VEC3",
            }, {
                bufferView: binary.add(vertexOf === undefined ? mesh.tangents : gather(mesh.tangents, vertexOf, 4), TARGET_ARRAY_BUFFER),
                componentType: COMPONENT_FLOAT,
                count: part.vertices,
                type: "VEC4",
            });
            const attributes = { POSITION: accessors.length - 3, NORMAL: accessors.length - 2, TANGENT: accessors.length - 1 };
            const indices = accessors.length - 4;
            if (uvs !== undefined) {
                accessors.push({
                    bufferView: binary.add(vertexOf === undefined ? uvs : gather(uvs, vertexOf, 2), TARGET_ARRAY_BUFFER),
                    componentType: COMPONENT_FLOAT,
                    count: part.vertices,
                    type: "VEC2",
                });
                attributes["TEXCOORD_0"] = accessors.length - 1;
            }
            const material = slotOfCandidate[part.group];
            primitives.push({ attributes, indices, material, mode: MODE_TRIANGLES });
            slots.push({ material: materials[material].name, triangles: part.triangles, vertices: part.vertices });
        }
        json.meshes.push({ name, primitives });
        return { mesh, uvs, stored, local, meshIndex: json.meshes.length - 1, slots };
    };
    const bodyFacts = [];
    const draftBodies = [];
    const totalMin = [Infinity, Infinity, Infinity];
    const totalMax = [-Infinity, -Infinity, -Infinity];
    for (const [index, body] of bodies.entries()) {
        const name = names[index];
        const { pivot, translation, full } = prepared[index];
        const { mesh, local } = full;
        const { shadedFrom } = shaped[index];
        const sceneMin = add(local.min, translation);
        const sceneMax = add(local.max, translation);
        for (let axis = 0; axis < 3; axis += 1) {
            totalMin[axis] = Math.min(totalMin[axis], sceneMin[axis]);
            totalMax[axis] = Math.max(totalMax[axis], sceneMax[axis]);
        }
        const written = write(name, full);
        const { slots } = written;
        const moved = translation.some((value) => value !== 0);
        json.nodes.push(moved ? { name, mesh: index, translation } : { name, mesh: index });
        json.scenes[0].nodes.push(index);
        draftBodies.push({ ...written, pivot, translation, levels: [] });
        bodyFacts.push({
            name,
            sourceName: body.name,
            node: index,
            mesh: index,
            triangles: mesh.triangles,
            vertices: slots.reduce((total, slot) => total + slot.vertices, 0),
            materialSlots: slots.length,
            materials: slots.map((slot) => slot.material),
            // Left out for a body in one colour, whose one slot holds everything the body has.
            ...(slots.length > 1 ? { slots } : {}),
            ...(shadedFrom !== undefined ? { shadedFrom } : {}),
            degenerateTrianglesDropped: mesh.degenerateTrianglesDropped,
            openEdges: mesh.openEdges,
            nonManifoldEdges: mesh.nonManifoldEdges,
            bounds: measuredBox(sceneMin, sceneMax, profile),
            localBounds: measuredBox(local.min, local.max, profile),
            pivot: {
                mode: settings.pivotMode,
                meters: [pivot[0] + 0, pivot[1] + 0, pivot[2] + 0],
                engine: toEngine(pivot, profile),
                source: pointToSourceSpace(pivot, conversion),
            },
            translation,
        });
    }
    // The meshes of lower levels come after the meshes of every body, so a body's mesh keeps the
    // number of its body. Their names and nodes are for the caller to settle.
    for (const [index, { levels }] of prepared.entries()) {
        draftBodies[index].levels = levels.map((level, at) => write(`${names[index]}_LOD${at + 1}`, level));
    }
    const sum = (pick) => bodyFacts.reduce((total, facts) => total + pick(facts), 0);
    const facts = {
        schema: 1,
        generator: GENERATOR,
        profile: profile.id,
        engine: { unit: profile.unit, unitMeters: profile.unitMeters, up: profile.up },
        source: { unit: conversion.unit, up: conversion.up, handedness: conversion.handedness },
        settings: {
            pivot: settings.pivotMode,
            placement: settings.placement,
            creaseAngle: settings.creaseAngle,
            normals: settings.normals,
            weldTolerance: settings.weldTolerance,
            // Face ids that had a say: a body's own, or those of the surfaces it refines.
            faceIds: bodies.some((body) => (body.refines === undefined ? body.faceIds !== undefined : body.refines.surfaces.some((surface) => surface.faceIds !== undefined))),
        },
        bodies: bodyFacts,
        materials: materials.map((material) => ({ ...material })),
        total: {
            bodies: bodyFacts.length,
            triangles: sum((body) => body.triangles),
            vertices: sum((body) => body.vertices),
            materialSlots: materials.length,
            degenerateTrianglesDropped: sum((body) => body.degenerateTrianglesDropped),
            openEdges: sum((body) => body.openEdges),
            nonManifoldEdges: sum((body) => body.nonManifoldEdges),
            bounds: measuredBox(totalMin, totalMax, profile),
        },
    };
    if (assemblyPivot !== undefined) {
        facts.assemblyPivot = {
            mode: settings.pivotMode,
            meters: [assemblyPivot[0] + 0, assemblyPivot[1] + 0, assemblyPivot[2] + 0],
            engine: toEngine(assemblyPivot, profile),
            source: pointToSourceSpace(assemblyPivot, conversion),
        };
    }
    return { json, binary, profile, conversion, names, bodies: draftBodies, facts, provenance: settings.provenance };
}
/** Writes the facts into the scene and encodes the draft as one GLB. */
export function finishScene(draft) {
    const { json, facts } = draft;
    const extras = { schema: 1, profile: draft.profile, facts };
    if (draft.provenance !== undefined)
        extras.provenance = draft.provenance;
    json.scenes[0].extras = { [EXTRAS_KEY]: extras };
    const bin = draft.binary.finish();
    json.buffers = [{ byteLength: bin.length }];
    return { glb: encodeGlb(json, bin), facts };
}
/**
 * Turns bodies into one GLB (glTF 2.0, metres, +Y up, right-handed) and the facts measured
 * from the geometry that was written. Throws `GameExportError` for input it refuses.
 */
export function exportGameGlb(input) {
    return finishScene(draftScene(input));
}
