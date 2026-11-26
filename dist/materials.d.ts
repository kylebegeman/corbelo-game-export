import type { BodyInput, ColorInput } from "./types.js";
/** Used when a body has no colour. */
export declare const DEFAULT_COLOR = "#cccccc";
export declare const MATERIAL_METALLIC = 0;
export declare const MATERIAL_ROUGHNESS = 0.8;
export interface MaterialDef {
    name: string;
    /** sRGB, `"#rrggbb"`. */
    color: string;
    /** Linear red, green, blue and an alpha of 1. */
    baseColorFactor: [number, number, number, number];
    bodies: number;
}
/**
 * Reads a colour and returns it as sRGB bytes. Colours are kept at eight bits per channel, so
 * a material name and its colour always match one to one. `where` starts the message of a
 * refusal: the body, and the triangle for a face colour.
 */
export declare function colorBytes(color: ColorInput | undefined, colorSpace: "srgb" | "linear", where: string): [number, number, number];
/** The colours the input asks for, read and checked before any geometry is built. */
export interface ColorPlan {
    /**
     * Every material the input names, in the order the input first names it. Which of them are
     * written, and in what order, is decided later from the triangles that are kept.
     */
    candidates: MaterialDef[];
    /** For each body, the candidate of its own colour. */
    ofBody: number[];
    /** For each body with face colours, the candidate of each of its input triangles. */
    ofTriangle: (Uint32Array | undefined)[];
}
/**
 * Reads every colour of every body. One material per distinct colour: a body that names its
 * material gets a material of that name for its own colour, a face colour listed in
 * `faceMaterialNames` gets the name listed, and every other colour is named after itself. Two
 * uses of one name must have the same colour.
 *
 * A face colour that is the body's own colour is the body's own material, whatever it is named,
 * so a body never has two materials of one colour. For the same reason a name that
 * `faceMaterialNames` gives the body's own colour is the name of the body's own material, and
 * must be the name `materialName` gives it, where both are there.
 */
export declare function planColors(bodies: readonly BodyInput[], colorSpace: "srgb" | "linear"): ColorPlan;
