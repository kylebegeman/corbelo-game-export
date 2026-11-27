/** The most points of one mesh that are measured against the other. Past it, every so many are. */
export declare const DEVIATION_MAX_SAMPLES = 20000;
/**
 * How far apart the surfaces of two meshes are: the greatest distance from a vertex or the
 * middle of a triangle of either mesh to the nearest point of the other mesh. Both meshes are
 * x, y, z per vertex and three vertex numbers per triangle, in the same frame and unit.
 *
 * Zero for the same surface cut into different triangles. For a round shape made with fewer
 * sides, it is how far the flat sides sit inside the round one.
 *
 * A mesh with more than `maxSamples` vertices or triangles is measured at every so many of
 * them, the same ones every time.
 */
export declare function meshDeviation(aPositions: ArrayLike<number>, aIndices: ArrayLike<number>, bPositions: ArrayLike<number>, bIndices: ArrayLike<number>, maxSamples?: number): number;
