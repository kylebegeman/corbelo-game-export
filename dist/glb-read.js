import { refuse } from "./errors.js";
import { EXTRAS_KEY, GLB_CHUNK_BIN, GLB_CHUNK_JSON, GLB_MAGIC } from "./gltf.js";
const COMPONENTS = {
    5120: { bytes: 1, read: (view, at) => view.getInt8(at), make: (length) => new Int8Array(length) },
    5121: { bytes: 1, read: (view, at) => view.getUint8(at), make: (length) => new Uint8Array(length) },
    5122: { bytes: 2, read: (view, at) => view.getInt16(at, true), make: (length) => new Int16Array(length) },
    5123: { bytes: 2, read: (view, at) => view.getUint16(at, true), make: (length) => new Uint16Array(length) },
    5125: { bytes: 4, read: (view, at) => view.getUint32(at, true), make: (length) => new Uint32Array(length) },
    5126: { bytes: 4, read: (view, at) => view.getFloat32(at, true), make: (length) => new Float32Array(length) },
};
const TYPE_SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
/** Splits a GLB file into its JSON document and binary chunk. */
export function readGlb(glb) {
    if (!(glb instanceof Uint8Array))
        refuse("BAD_GLB", "A GLB must be given as a Uint8Array.");
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    if (glb.length < 20 || view.getUint32(0, true) !== GLB_MAGIC)
        refuse("BAD_GLB", "This is not a GLB file: the first four bytes are not \"glTF\".");
    if (view.getUint32(4, true) !== 2)
        refuse("BAD_GLB", `Only GLB version 2 is supported. This file is version ${view.getUint32(4, true)}.`);
    const total = view.getUint32(8, true);
    if (total > glb.length)
        refuse("BAD_GLB", `The GLB header says ${total} bytes but only ${glb.length} were given.`);
    let json;
    let bin = new Uint8Array(0);
    let at = 12;
    while (at + 8 <= total) {
        const length = view.getUint32(at, true);
        const kind = view.getUint32(at + 4, true);
        const start = at + 8;
        if (start + length > total)
            refuse("BAD_GLB", "A GLB chunk runs past the end of the file.");
        if (kind === GLB_CHUNK_JSON && json === undefined) {
            try {
                json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(glb.subarray(start, start + length)));
            }
            catch (error) {
                refuse("BAD_GLB", `The GLB's JSON chunk cannot be read: ${error.message}`);
            }
        }
        else if (kind === GLB_CHUNK_BIN && bin.length === 0) {
            bin = glb.subarray(start, start + length);
        }
        at = start + ((length + 3) & ~3);
    }
    if (json === undefined || typeof json !== "object" || json === null || typeof json.asset !== "object") {
        refuse("BAD_GLB", "The GLB has no glTF JSON document.");
    }
    return { json, bin };
}
/**
 * Reads one accessor into a typed array of its component type, all components in a row.
 * Handles byte offsets and interleaved views. Sparse accessors and external buffers are refused.
 */
export function readAccessor(document, index) {
    const accessor = document.json.accessors?.[index];
    if (accessor === undefined)
        refuse("BAD_GLB", `Accessor ${index} does not exist.`);
    if (accessor.sparse !== undefined)
        refuse("BAD_GLB", `Accessor ${index} is sparse, which this reader does not support.`);
    const component = COMPONENTS[accessor.componentType];
    const size = TYPE_SIZES[accessor.type];
    if (component === undefined || size === undefined) {
        refuse("BAD_GLB", `Accessor ${index} has an unknown type (${accessor.type}, component ${accessor.componentType}).`);
    }
    const out = component.make(accessor.count * size);
    if (accessor.bufferView === undefined)
        return out;
    const bufferView = document.json.bufferViews?.[accessor.bufferView];
    if (bufferView === undefined)
        refuse("BAD_GLB", `Accessor ${index} points at buffer view ${accessor.bufferView}, which does not exist.`);
    if (bufferView.buffer !== 0 || document.json.buffers?.[0]?.uri !== undefined) {
        refuse("BAD_GLB", `Accessor ${index} uses a buffer outside the GLB, which this reader does not support.`);
    }
    const elementBytes = component.bytes * size;
    const stride = bufferView.byteStride ?? elementBytes;
    const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const end = accessor.count === 0 ? start : start + stride * (accessor.count - 1) + elementBytes;
    if (end > document.bin.length || end > (bufferView.byteOffset ?? 0) + bufferView.byteLength) {
        refuse("BAD_GLB", `Accessor ${index} reads past the end of its buffer view.`);
    }
    const view = new DataView(document.bin.buffer, document.bin.byteOffset, document.bin.byteLength);
    for (let element = 0; element < accessor.count; element += 1) {
        for (let part = 0; part < size; part += 1) {
            out[element * size + part] = component.read(view, start + element * stride + part * component.bytes);
        }
    }
    return out;
}
/**
 * Reads a GLB written by this package back into plain arrays: one entry per body, with every
 * primitive of its mesh at full detail, plus the facts, profile and provenance from the scene
 * extras. Collision shapes, lower detail levels and attach points are not bodies: the facts say
 * which nodes and meshes they are.
 *
 * A file without facts gives one entry per mesh node at the top of the scene.
 */
export function readPack(glb) {
    const document = glb instanceof Uint8Array ? readGlb(glb) : glb;
    const { json } = document;
    const scene = json.scenes?.[json.scene ?? 0];
    const extras = scene?.extras?.[EXTRAS_KEY];
    const bodies = [];
    // The facts name the node and the mesh of each body. A body with detail levels may have its
    // mesh on a child of its node, so the two are not always one node.
    const listed = extras?.facts?.bodies !== undefined
        ? extras.facts.bodies.map((body) => ({ node: body.node, mesh: body.mesh }))
        : (scene?.nodes ?? []).map((node) => ({ node, mesh: json.nodes?.[node]?.mesh }));
    for (const { node: nodeIndex, mesh: meshIndex } of listed) {
        const node = json.nodes?.[nodeIndex];
        const primitives = meshIndex === undefined ? undefined : json.meshes?.[meshIndex]?.primitives;
        if (node === undefined || primitives === undefined || primitives.length === 0)
            continue;
        const parts = primitives.map((primitive) => {
            const position = primitive.attributes["POSITION"];
            const normal = primitive.attributes["NORMAL"];
            const texcoord = primitive.attributes["TEXCOORD_0"];
            if (position === undefined)
                refuse("BAD_GLB", `Node "${node.name ?? nodeIndex}" has a mesh without positions.`);
            const positions = readAccessor(document, position);
            const source = primitive.material === undefined ? undefined : json.materials?.[primitive.material];
            const pbr = source?.pbrMetallicRoughness;
            const material = source === undefined
                ? null
                : {
                    name: source.name ?? "",
                    baseColorFactor: (pbr?.baseColorFactor ?? [1, 1, 1, 1]),
                    metallicFactor: pbr?.metallicFactor ?? 1,
                    roughnessFactor: pbr?.roughnessFactor ?? 1,
                };
            return {
                positions,
                normals: normal === undefined ? undefined : readAccessor(document, normal),
                texcoords: texcoord === undefined ? undefined : readAccessor(document, texcoord),
                indices: primitive.indices === undefined ? undefined : readAccessor(document, primitive.indices),
                material,
            };
        });
        const vertexCount = parts.reduce((total, part) => total + part.positions.length / 3, 0);
        const cornerCount = parts.reduce((total, part) => total + (part.indices?.length ?? part.positions.length / 3), 0);
        const positions = new Float32Array(vertexCount * 3);
        const withNormals = parts.every((part) => part.normals !== undefined);
        const normals = new Float32Array(withNormals ? vertexCount * 3 : 0);
        const withTexcoords = parts.every((part) => part.texcoords !== undefined);
        const texcoords = new Float32Array(withTexcoords ? vertexCount * 2 : 0);
        const indices = new Uint32Array(cornerCount);
        const surfaces = [];
        let firstVertex = 0;
        let firstCorner = 0;
        for (const part of parts) {
            const vertices = part.positions.length / 3;
            const corners = part.indices?.length ?? vertices;
            positions.set(part.positions, firstVertex * 3);
            if (withNormals)
                normals.set(part.normals, firstVertex * 3);
            if (withTexcoords)
                texcoords.set(part.texcoords, firstVertex * 2);
            for (let corner = 0; corner < corners; corner += 1)
                indices[firstCorner + corner] = firstVertex + (part.indices?.[corner] ?? corner);
            surfaces.push({ material: part.material, firstVertex, vertices, firstTriangle: firstCorner / 3, triangles: corners / 3 });
            firstVertex += vertices;
            firstCorner += corners;
        }
        const translation = node.translation ?? [0, 0, 0];
        bodies.push({
            name: node.name ?? "",
            translation: [translation[0] ?? 0, translation[1] ?? 0, translation[2] ?? 0],
            positions,
            normals,
            texcoords,
            indices,
            material: surfaces[0].material,
            surfaces,
        });
    }
    return {
        generator: json.asset.generator ?? null,
        profile: extras?.profile ?? null,
        facts: extras?.facts ?? null,
        provenance: extras?.provenance ?? null,
        bodies,
    };
}
