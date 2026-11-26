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
 * Reads a GLB written by this package back into plain arrays: one entry per mesh node of the
 * scene, plus the facts, profile and provenance from the scene extras.
 */
export function readPack(glb) {
    const document = glb instanceof Uint8Array ? readGlb(glb) : glb;
    const { json } = document;
    const scene = json.scenes?.[json.scene ?? 0];
    const extras = scene?.extras?.[EXTRAS_KEY];
    const bodies = [];
    for (const nodeIndex of scene?.nodes ?? []) {
        const node = json.nodes?.[nodeIndex];
        const primitive = node?.mesh === undefined ? undefined : json.meshes?.[node.mesh]?.primitives[0];
        if (node === undefined || primitive === undefined)
            continue;
        const position = primitive.attributes["POSITION"];
        const normal = primitive.attributes["NORMAL"];
        if (position === undefined)
            refuse("BAD_GLB", `Node "${node.name ?? nodeIndex}" has a mesh without positions.`);
        const positions = Float32Array.from(readAccessor(document, position));
        const normals = normal === undefined ? new Float32Array(0) : Float32Array.from(readAccessor(document, normal));
        const indices = primitive.indices === undefined ? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) : Uint32Array.from(readAccessor(document, primitive.indices));
        const source = primitive.material === undefined ? undefined : json.materials?.[primitive.material];
        const pbr = source?.pbrMetallicRoughness;
        const translation = node.translation ?? [0, 0, 0];
        bodies.push({
            name: node.name ?? "",
            translation: [translation[0] ?? 0, translation[1] ?? 0, translation[2] ?? 0],
            positions,
            normals,
            indices,
            material: source === undefined
                ? null
                : {
                    name: source.name ?? "",
                    baseColorFactor: (pbr?.baseColorFactor ?? [1, 1, 1, 1]),
                    metallicFactor: pbr?.metallicFactor ?? 1,
                    roughnessFactor: pbr?.roughnessFactor ?? 1,
                },
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
