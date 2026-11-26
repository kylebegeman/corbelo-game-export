import type { SourceSpace, Vec3 } from "./types.js";
/**
 * How source coordinates become glTF coordinates (metres, +Y up, right-handed).
 *
 *   right-handed, Y up:  ( x,  y,  z)
 *   right-handed, Z up:  ( x,  z, -y)   a rotation
 *   left-handed,  Y up:  ( x,  y, -z)   a mirror
 *   left-handed,  Z up:  ( x,  z,  y)   a mirror
 *
 * Source X always stays X. `mirrored` conversions must also reverse triangle winding.
 */
export interface SpaceConversion {
    unit: number;
    up: "Y" | "Z";
    handedness: "right" | "left";
    mirrored: boolean;
    /** Sign applied to the source axis that becomes glTF Z. */
    depthSign: 1 | -1;
}
export declare function spaceConversion(source: SourceSpace): SpaceConversion;
/** Writes every source vertex into `out` as glTF metres. */
export declare function toGltfSpace(positions: ArrayLike<number>, conversion: SpaceConversion, out: Float64Array): void;
export declare function pointToGltfSpace(point: readonly number[], conversion: SpaceConversion): Vec3;
/** The inverse of `toGltfSpace` for one point. */
export declare function pointToSourceSpace(point: readonly number[], conversion: SpaceConversion): Vec3;
