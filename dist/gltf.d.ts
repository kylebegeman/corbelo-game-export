/** The parts of a glTF 2.0 document this package writes and reads. */
export interface GltfJson {
    asset: {
        version: string;
        generator?: string;
    };
    scene?: number;
    scenes?: GltfScene[];
    nodes?: GltfNode[];
    meshes?: GltfMesh[];
    materials?: GltfMaterial[];
    accessors?: GltfAccessor[];
    bufferViews?: GltfBufferView[];
    buffers?: {
        byteLength: number;
        uri?: string;
    }[];
    extensionsUsed?: string[];
}
export interface GltfScene {
    name?: string;
    nodes?: number[];
    extras?: Record<string, unknown>;
}
export interface GltfNode {
    name?: string;
    mesh?: number;
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
    extensions?: Record<string, unknown>;
}
export interface GltfPrimitive {
    attributes: Record<string, number>;
    indices?: number;
    material?: number;
    mode?: number;
}
export interface GltfMesh {
    name?: string;
    primitives: GltfPrimitive[];
}
export interface GltfMaterial {
    name?: string;
    pbrMetallicRoughness?: {
        baseColorFactor?: number[];
        metallicFactor?: number;
        roughnessFactor?: number;
    };
}
export interface GltfAccessor {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    normalized?: boolean;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
    sparse?: unknown;
}
export interface GltfBufferView {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    target?: number;
}
export declare const GLB_MAGIC = 1179937895;
export declare const GLB_CHUNK_JSON = 1313821514;
export declare const GLB_CHUNK_BIN = 5130562;
export declare const COMPONENT_UNSIGNED_SHORT = 5123;
export declare const COMPONENT_UNSIGNED_INT = 5125;
export declare const COMPONENT_FLOAT = 5126;
export declare const TARGET_ARRAY_BUFFER = 34962;
export declare const TARGET_ELEMENT_ARRAY_BUFFER = 34963;
export declare const MODE_TRIANGLES = 4;
/** The glTF extension that says whether a node is shown. */
export declare const NODE_VISIBILITY_EXTENSION = "KHR_node_visibility";
/** The key under `scenes[0].extras` that holds the profile, the facts and the provenance. */
export declare const EXTRAS_KEY = "corbeloGameExport";
