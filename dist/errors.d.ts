/** Every reason this package refuses input. Stable strings, safe to match on. */
export type GameExportErrorCode = "NO_BODIES" | "EMPTY_BODY" | "ALL_DEGENERATE" | "BAD_POSITIONS" | "NON_FINITE_POSITION" | "BAD_INDICES" | "INDEX_OUT_OF_RANGE" | "BAD_FACE_IDS" | "BAD_FACE_COLORS" | "BAD_REFINEMENT" | "TOO_MANY_TRIANGLES" | "BAD_NAME" | "BAD_COLOR" | "MATERIAL_CONFLICT" | "BAD_SOURCE_SPACE" | "BAD_OPTION" | "BAD_PROVENANCE" | "BAD_STL" | "BAD_GLB" | "BAD_JOB" | "BAD_LOD" | "BAD_COLLISION" | "BAD_ATTACH_POINT" | "BAD_PACK" | "BAD_KIT" | "BAD_LAYOUT" | "BAD_ZIP" | "BAD_LOCK" | "PACK_MISMATCH" | "OUTSIDE_PROJECT" | "FILE_IN_THE_WAY";
/** Thrown for input the package refuses. `code` says which rule was broken. */
export declare class GameExportError extends Error {
    readonly code: GameExportErrorCode;
    /**
     * Which body of the input the refusal is about, counted from 0, when it was found while that
     * one body was checked or built. Not set for what is read across all bodies, like names and
     * colours, or for what is not about a body.
     */
    body?: number;
    constructor(code: GameExportErrorCode, message: string);
}
export declare function refuse(code: GameExportErrorCode, message: string): never;
/** Runs `work` on one body of the input, and marks a refusal that comes out of it with that body. */
export declare function forBody<T>(body: number, work: () => T): T;
