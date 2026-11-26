import type { ExportInput, ExportResult } from "./types.js";
export declare const DEFAULT_CREASE_ANGLE = 30;
/** Metres. One micron. */
export declare const DEFAULT_WELD_TOLERANCE = 0.000001;
/** Triangles across all bodies of one export. Raise or lower it with `maxTriangles`. */
export declare const DEFAULT_MAX_TRIANGLES = 2000000;
/**
 * Turns bodies into one GLB (glTF 2.0, metres, +Y up, right-handed) and the facts measured
 * from the geometry that was written. Throws `GameExportError` for input it refuses.
 */
export declare function exportGameGlb(input: ExportInput): ExportResult;
