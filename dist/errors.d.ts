/** Every reason this package refuses input. Stable strings, safe to match on. */
export type GameExportErrorCode = "NO_BODIES" | "EMPTY_BODY" | "ALL_DEGENERATE" | "BAD_POSITIONS" | "NON_FINITE_POSITION" | "BAD_INDICES" | "INDEX_OUT_OF_RANGE" | "BAD_FACE_IDS" | "TOO_MANY_TRIANGLES" | "BAD_NAME" | "BAD_COLOR" | "MATERIAL_CONFLICT" | "BAD_SOURCE_SPACE" | "BAD_OPTION" | "BAD_PROVENANCE" | "BAD_STL" | "BAD_GLB" | "BAD_JOB";
/** Thrown for input the package refuses. `code` says which rule was broken. */
export declare class GameExportError extends Error {
    readonly code: GameExportErrorCode;
    constructor(code: GameExportErrorCode, message: string);
}
export declare function refuse(code: GameExportErrorCode, message: string): never;
