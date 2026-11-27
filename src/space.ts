import { notObject, refuse } from "./errors.js";
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

export function spaceConversion(source: SourceSpace): SpaceConversion {
  if (notObject(source)) refuse("BAD_SOURCE_SPACE", "source must be { unit, up }.");
  if (!(Number.isFinite(source.unit) && source.unit > 0)) {
    refuse("BAD_SOURCE_SPACE", `source.unit must be a positive number of metres per source unit (0.001 for millimetres). Got ${String(source.unit)}.`);
  }
  if (source.up !== "Y" && source.up !== "Z") refuse("BAD_SOURCE_SPACE", `source.up must be "Y" or "Z". Got ${JSON.stringify(source.up)}.`);
  const handedness = source.handedness ?? "right";
  if (handedness !== "right" && handedness !== "left") {
    refuse("BAD_SOURCE_SPACE", `source.handedness must be "right" or "left". Got ${JSON.stringify(source.handedness)}.`);
  }
  const mirrored = handedness === "left";
  const depthSign = (source.up === "Y") === mirrored ? -1 : 1;
  return { unit: source.unit, up: source.up, handedness, mirrored, depthSign };
}

/** Writes every source vertex into `out` as glTF metres. */
export function toGltfSpace(positions: ArrayLike<number>, conversion: SpaceConversion, out: Float64Array): void {
  const { unit, depthSign } = conversion;
  const upAt = conversion.up === "Y" ? 1 : 2;
  const depthAt = conversion.up === "Y" ? 2 : 1;
  const depthScale = unit * depthSign;
  for (let at = 0; at < positions.length; at += 3) {
    out[at] = positions[at]! * unit;
    out[at + 1] = positions[at + upAt]! * unit;
    out[at + 2] = positions[at + depthAt]! * depthScale;
  }
}

export function pointToGltfSpace(point: readonly number[], conversion: SpaceConversion): Vec3 {
  const out = new Float64Array(3);
  toGltfSpace(point, conversion, out);
  return [out[0]!, out[1]!, out[2]!];
}

/** The inverse of `toGltfSpace` for one point. */
export function pointToSourceSpace(point: readonly number[], conversion: SpaceConversion): Vec3 {
  const { unit, depthSign } = conversion;
  const x = point[0]! / unit;
  const up = point[1]! / unit;
  const depth = (point[2]! * depthSign) / unit;
  // `+ 0` turns a negative zero into zero so facts never print "-0".
  return conversion.up === "Y" ? [x + 0, up + 0, depth + 0] : [x + 0, depth + 0, up + 0];
}
