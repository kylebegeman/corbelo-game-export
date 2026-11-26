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
 * a material name and its colour always match one to one.
 */
export declare function colorBytes(color: ColorInput | undefined, colorSpace: "srgb" | "linear", bodyName: string): [number, number, number];
/**
 * One material per distinct colour, in the order bodies first use them. A body that names its
 * material gets a material of that name; two bodies may share a name only with the same colour.
 */
export declare function buildMaterials(bodies: readonly BodyInput[], colorSpace: "srgb" | "linear"): {
    materials: MaterialDef[];
    slotOfBody: number[];
};
