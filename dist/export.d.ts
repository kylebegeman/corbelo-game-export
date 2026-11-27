import { BinaryBuilder } from "./glb-write.js";
import { type GltfJson } from "./gltf.js";
import { type BuiltMesh } from "./mesh.js";
import { type EngineProfile } from "./profiles.js";
import { type SpaceConversion } from "./space.js";
import type { ColorInput, ExportInput, ExportResult, JsonValue, MeasuredBox, PackFacts, SlotFacts, Vec3 } from "./types.js";
export declare const DEFAULT_CREASE_ANGLE = 30;
/** Metres. One micron. */
export declare const DEFAULT_WELD_TOLERANCE = 0.000001;
/** Triangles across all bodies of one export. Raise or lower it with `maxTriangles`. */
export declare const DEFAULT_MAX_TRIANGLES = 2000000;
export declare function assertJson(value: unknown, path: string, depth: number): void;
/**
 * Checks the arrays of a mesh and returns how many triangles it has. Refuses anything malformed.
 * `label` starts the message and `what` is the mesh in the middle of a sentence: "the body".
 */
export declare function checkMesh(mesh: {
    positions: ArrayLike<number>;
    indices?: ArrayLike<number>;
    faceIds?: ArrayLike<number>;
}, label: string, what: string): number;
export declare function boundsOf(positions: ArrayLike<number>): {
    min: Vec3;
    max: Vec3;
};
/** glTF metres to the engine's unit, with the up axis moved to the engine's up axis. */
export declare function toEngine(point: Vec3, profile: EngineProfile): Vec3;
export declare function measuredBox(min: Vec3, max: Vec3, profile: EngineProfile): MeasuredBox;
/** A lower detail level as the asset exporter hands it over: a mesh that takes colours as its body does. */
export interface LevelSource {
    positions: ArrayLike<number>;
    indices?: ArrayLike<number>;
    faceIds?: ArrayLike<number>;
    faceColors?: readonly (ColorInput | null | undefined)[];
}
/** What the asset exporter adds to a plain export. Nothing here changes what a plain export writes. */
export interface SceneExtension {
    /** The function a person called, for the message of a refusal. */
    caller?: string;
    /** For each body, its lower detail levels, the nearest to full detail first. */
    levels?: readonly (readonly LevelSource[] | undefined)[];
    /**
     * Gives a built mesh texture coordinates, and tangents that follow them. `offset` moves a
     * stored position to where the vertex sits in the scene.
     */
    texture?: (mesh: BuiltMesh, offset: Vec3) => {
        mesh: BuiltMesh;
        uvs: Float32Array;
    };
    /**
     * `"first-use"` writes materials, and a body's slots, in the order triangles first use them.
     * `"name"` writes both in the order of the material names, so the order does not move when
     * the triangles do.
     */
    slotOrder?: "first-use" | "name";
}
/** One mesh of a draft: a body at full detail, or one of its lower levels. */
export interface DraftMesh {
    mesh: BuiltMesh;
    /** u, v per written vertex. Undefined without texture coordinates. */
    uvs: Float32Array | undefined;
    /** x, y, z per written vertex as stored: 32-bit floats, relative to the pivot. */
    stored: Float32Array;
    local: {
        min: Vec3;
        max: Vec3;
    };
    /** Index in the glTF `meshes` array. */
    meshIndex: number;
    slots: SlotFacts[];
}
export interface DraftBody extends DraftMesh {
    /** In glTF space, before it was taken off the positions. */
    pivot: Vec3;
    translation: Vec3;
    levels: DraftMesh[];
}
/** A scene with every body written and nothing encoded yet, so more can be added to it. */
export interface SceneDraft {
    json: GltfJson;
    binary: BinaryBuilder;
    profile: EngineProfile;
    conversion: SpaceConversion;
    /** Node names of the bodies, in order. */
    names: string[];
    bodies: DraftBody[];
    facts: PackFacts;
    provenance: JsonValue | undefined;
}
/**
 * Checks the input, builds every body and writes its mesh and node into a glTF document that is
 * not encoded yet. `exportGameGlb` is this and `finishScene`, one after the other.
 */
export declare function draftScene(input: ExportInput, extension?: SceneExtension): SceneDraft;
/** Writes the facts into the scene and encodes the draft as one GLB. */
export declare function finishScene(draft: SceneDraft): ExportResult;
/**
 * Turns bodies into one GLB (glTF 2.0, metres, +Y up, right-handed) and the facts measured
 * from the geometry that was written. Throws `GameExportError` for input it refuses.
 */
export declare function exportGameGlb(input: ExportInput): ExportResult;
