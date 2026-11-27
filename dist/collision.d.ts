import { type Hull } from "./hull.js";
import type { CollisionRequest, CollisionSettings, CollisionShape } from "./types.js";
/** The collision volume may differ from the visible part's by this share before `auto` moves on. */
export declare const DEFAULT_COLLISION_TOLERANCE = 0.05;
/** The most convex pieces a decomposition makes. */
export declare const DEFAULT_MAX_COLLISION_PIECES = 8;
/** The most corners one convex piece has. */
export declare const DEFAULT_MAX_HULL_VERTICES = 64;
/** How many places along each axis a decomposition tries to cut a part. */
export declare const DECOMPOSITION_CUTS_PER_AXIS = 12;
/** A mesh as a solid kernel hands it out: `numProp` numbers per vertex, the first three its position. */
export interface KernelMesh {
    numProp: number;
    vertProperties: ArrayLike<number>;
    triVerts: ArrayLike<number>;
}
/**
 * A closed solid held by a kernel. A `Manifold` of the `manifold-3d` package is one as it is.
 * Only a general convex decomposition needs a kernel.
 */
export interface KernelSolid {
    /** The convex hull of the solid. */
    hull(): KernelSolid;
    /** The solid cut in two by the plane where `normal . p = originOffset`: the part on the side the normal points to first. */
    splitByPlane(normal: [number, number, number], originOffset: number): KernelSolid[];
    volume(): number;
    getMesh(): KernelMesh;
    /** The parts of the solid that do not touch, each a solid of its own. */
    decompose?(): KernelSolid[];
    /** What this solid and another both fill. Only the kit checks use it, to measure where trim runs into the piece next to it. */
    intersect?(other: KernelSolid): KernelSolid;
    /** Frees the solid. Called on every solid the package asked for, when it is done with it. */
    delete?(): void;
}
/** Makes solids from closed meshes. Pass one as `kernel` to let collision use a general convex decomposition. */
export interface CollisionKernel {
    /** `positions` is x, y, z per vertex, with each place in space once. `indices` is three per triangle, facing outwards. */
    solid(positions: Float32Array, indices: Uint32Array): KernelSolid;
}
/**
 * A kernel from the `manifold-3d` package. Give it the module once it is set up:
 *
 *   const wasm = await Module();
 *   wasm.setup();
 *   const kernel = manifoldKernel(wasm);
 */
export declare function manifoldKernel<M>(module: {
    Mesh: new (options: {
        numProp: number;
        vertProperties: Float32Array;
        triVerts: Uint32Array;
    }) => M;
    Manifold: new (mesh: M) => KernelSolid;
}): CollisionKernel;
export interface ResolvedCollisionSettings {
    shape: CollisionRequest;
    tolerance: number;
    maxPieces: number;
    maxHullVertices: number;
}
/** Reads the `collision` option: a shape by name, or settings. Refuses anything else. */
export declare function readCollisionSettings(option: CollisionRequest | CollisionSettings | undefined): ResolvedCollisionSettings;
/** One convex piece of a collision shape. */
export interface CollisionPiece extends Hull {
    /** `"box"` for the box around the body, which engines can hold as a box. Everything else is `"convex"`. */
    kind: "box" | "convex";
}
/** One tier that was built and measured. */
export interface CollisionAttempt {
    shape: CollisionShape;
    pieces: CollisionPiece[];
    /** The volumes of the pieces added up. Pieces that overlap count twice where they do. */
    volume: number;
    /** How far `volume` is from the visible volume, as a share of it. Null when the visible volume is not known. */
    error: number | null;
    withinTolerance: boolean | null;
}
export interface CollisionPlan {
    requested: CollisionRequest;
    /** The tier chosen. Null when no shape could be built. */
    chosen: CollisionAttempt | null;
    /** Null for a body that is not closed, which has no volume to measure. */
    visibleVolume: number | null;
    /** Every tier that was built, cheapest first. */
    tried: CollisionAttempt[];
    /** Why a tier was passed over, or why there is no shape. */
    notes: string[];
}
/** What collision is planned from. Everything is in one frame, the body's own: metres from its pivot. */
export interface CollisionSource {
    /** The body's name, for messages. */
    name: string;
    /** x, y, z per vertex of the visible part. */
    positions: ArrayLike<number>;
    indices: ArrayLike<number>;
    /** True when the visible part has no open and no doubled edges, so it encloses a volume. */
    closed: boolean;
    /** Pieces the caller made the body from, each a list of points. Each becomes its convex hull. */
    pieces: readonly ArrayLike<number>[] | undefined;
}
/** Each place in space once: the kernel needs a mesh whose triangles share vertices where they meet. */
export declare function weldExact(positions: ArrayLike<number>, indices: ArrayLike<number>): {
    positions: Float32Array;
    indices: Uint32Array;
};
/**
 * Plans the collision shape of one body.
 *
 * A shape asked for by name is built or refused. `"auto"` builds the tiers cheapest first (one
 * box, one convex hull, the caller's pieces, a decomposition by the kernel) and takes the first
 * whose volume is within the tolerance of the visible part's. When none is, it takes the nearest.
 * A body that is not closed has no volume to compare with, and gets its convex hull. A tier that
 * cannot be built is passed over with a note that says why, a decomposition the kernel could not
 * make too.
 */
export declare function planCollision(source: CollisionSource, settings: ResolvedCollisionSettings, kernel: CollisionKernel | undefined): CollisionPlan;
