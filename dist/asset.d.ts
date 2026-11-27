import type { AssetInput, ExportResult } from "./types.js";
/**
 * Turns bodies into one game asset: the GLB `exportGameGlb` writes, with a collision shape named
 * the way the profile's engine reads it, the lower detail levels the caller made, texture
 * coordinates on request and attach points as empty nodes. The facts say what was written.
 *
 * Detail levels are laid out for the engine. Where the profile has a rule for level names, the
 * body's node holds no mesh and every level is a child of it, named by the rule. Where it has
 * none, the body's node holds the full level and the lower levels are children of it, written
 * hidden with `KHR_node_visibility` so that they are not all drawn at once.
 *
 * Material slots come in the order of the material names, so they do not move from one
 * revision of a part to the next. The same input always gives the same bytes.
 */
export declare function exportGameAsset(input: AssetInput): ExportResult;
