/** A closed convex mesh around a set of points. */
export interface Hull {
    /** x, y, z per corner of the hull. Each is one of the points given. */
    positions: Float64Array;
    /** Three corner numbers per triangle, wound so the triangle faces outwards. */
    indices: Uint32Array;
    /** In the cube of the unit the points are in. */
    volume: number;
    /** True when `maxVertices` stopped the hull before it reached every point. */
    capped: boolean;
}
/**
 * A point counts as on a face, not outside it, within this share of the diagonal of the box
 * around the points. Points read from 32-bit floats sit this far off a plane they were meant
 * to be on.
 */
export declare const HULL_FLATNESS = 1e-7;
/**
 * The volume a closed mesh encloses. Positive when its triangles face outwards. Measured from
 * the first vertex, so a mesh far from the origin loses no accuracy.
 */
export declare function meshVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): number;
/**
 * The convex hull of points given as x, y, z each: the smallest convex shape that holds them
 * all. Returns null when the points have no volume between them: fewer than four, or all on
 * one plane.
 *
 * Points go in furthest first. With `maxVertices`, the hull stops at that many corners and may
 * leave points outside; `capped` says so. At least four corners are always used.
 *
 * The same points in the same order always give the same hull.
 */
export declare function convexHull(points: ArrayLike<number>, maxVertices?: number): Hull | null;
