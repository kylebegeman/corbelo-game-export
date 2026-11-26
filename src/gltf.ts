/** The parts of a glTF 2.0 document this package writes and reads. */
export interface GltfJson {
  asset: { version: string; generator?: string };
  scene?: number;
  scenes?: GltfScene[];
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  materials?: GltfMaterial[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: { byteLength: number; uri?: string }[];
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

export const GLB_MAGIC = 0x46546c67;
export const GLB_CHUNK_JSON = 0x4e4f534a;
export const GLB_CHUNK_BIN = 0x004e4942;

export const COMPONENT_UNSIGNED_SHORT = 5123;
export const COMPONENT_UNSIGNED_INT = 5125;
export const COMPONENT_FLOAT = 5126;

export const TARGET_ARRAY_BUFFER = 34962;
export const TARGET_ELEMENT_ARRAY_BUFFER = 34963;

export const MODE_TRIANGLES = 4;

/** The key under `scenes[0].extras` that holds the profile, the facts and the provenance. */
export const EXTRAS_KEY = "corbeloGameExport";
