import { type PlayerProfile, type ResultBase } from "./checks.js";
import { type CollisionKernel } from "./collision.js";
import { type Kit, type KitCell, type KitGrid, type KitGridInput, type KitInput, type KitLayout, type SkippedLayout } from "./kit.js";
import type { EngineProfileId } from "./profiles.js";
import type { Vec3 } from "./types.js";
/** How near is near enough, in metres, when the caller does not say: a tenth of a millimetre. */
export declare const DEFAULT_KIT_TOLERANCE_METERS = 0.0001;
/** How many lines a face is measured along, each way. Areas are exact along a line and sampled across the lines. */
export declare const SEAM_LINES = 512;
/** The seven kit checks, in the order the results come in. */
export declare const KIT_CHECK_IDS: readonly ["on-grid", "seams", "in-cells", "layouts", "corners", "walkable", "collision-tiles"];
export type KitCheckId = (typeof KIT_CHECK_IDS)[number];
export interface KitCheckOptions {
    /** Runs the checks for another grid. A kit whose pieces are a function of the grid is rebuilt for it. */
    grid?: KitGridInput;
    /** A profile of your own, or the id of an engine profile. Default: the player of the engine the kit is written for. */
    player?: PlayerProfile | EngineProfileId;
    /** How near is near enough, in metres. Default 0.0001. */
    toleranceMeters?: number;
    /** Measures where trim runs into the piece next to it. Without one that is not measured. */
    kernel?: CollisionKernel;
}
export interface OnGridValues {
    moduleMeters: number;
    storeyMeters: number;
    toleranceMeters: number;
    pieces: {
        piece: string;
        cells: KitCell;
        /** The box around the piece without its trim: along X, along Y and up. */
        sizeMeters: Vec3;
        /** The same in modules, modules and storeys. */
        modules: Vec3;
        /** How far the size is from a whole number of modules, at worst. */
        sizeOffMeters: number;
        /** How far the pivot is from a corner of the grid. */
        pivotOffMeters: number;
        /** How far a socket's plane is from the face of its cell, at worst. */
        socketOffMeters: number;
    }[];
    worstMeters: number;
}
export interface SeamValues {
    /** The most two outlines may differ by: the tolerance times the side of a square as large as the face. */
    toleranceSquareMeters: number;
    /** The distance between two lines the faces are measured along, at most. */
    lineMeters: number;
    types: {
        type: string;
        mates: string;
        sockets: number;
        pairs: number;
        /** The area of the largest outline of the type. */
        outlineSquareMeters: number;
        /** The most any two outlines that can meet differ by: the area one covers and the other does not. */
        mismatchSquareMeters: number;
        /** The two sockets that differ the most, as `piece/socket`. Null when nothing differs. */
        worst: [string, string] | null;
    }[];
    /** Sockets with nothing of the piece on their plane, as `piece/socket`. */
    empty: string[];
    maxMismatchSquareMeters: number;
}
export interface InCellsValues {
    toleranceMeters: number;
    trimMeters: number;
    pieces: {
        piece: string;
        /** How far the piece without its trim reaches past its cells. */
        pokeMeters: number;
        /** How far its trim does. Null for a piece with no trim. */
        trimPokeMeters: number | null;
    }[];
    maxPokeMeters: number;
    maxTrimPokeMeters: number;
}
export interface LayoutValues {
    layouts: {
        name: string;
        origin: "generated" | "given";
        pieces: number;
        cells: number;
        joints: number;
        open: number;
        /** Sockets that face a side of a piece with no socket. */
        blocked: number;
        /** Sockets face to face whose types do not meet. */
        mismatched: number;
        /** Cells more than one piece is in. */
        doubledCells: number;
        /** Joints where the two pieces share no area on the plane between them. */
        apart: number;
        /** The least area two pieces share at a joint. Null with no joints. */
        minContactSquareMeters: number | null;
        /** The widest gap at a joint that does not touch. */
        maxGapMeters: number;
        /** How far a piece reaches past the plane of a joint, into the piece it meets, at most. */
        maxOverlapMeters: number;
        /** What trim and the bodies of other pieces both fill. Null when it was not measured. */
        trimOverlapCubicMeters: number | null;
        /** Pairs of a trim body and a body of another piece whose boxes cross, so that only a kernel can say whether they overlap. */
        trimPairs: number;
    }[];
    /** Test layouts the kit has no pieces for, and why. */
    skipped: SkippedLayout[];
    kernel: boolean;
}
export interface CornerValues {
    toleranceMeters: number;
    /** Pairs of sockets that can meet and whose outlines match, so that their points can be compared. */
    pairs: number;
    /** Pairs left out because their outlines differ: Seams match says by how much. */
    pairsSkipped: number;
    /** Points on the outlines, counted once for each pair they were compared in. */
    points: number;
    coincident: number;
    /** Points that lie on an edge of the other outline, with no point of it there. */
    onEdge: number;
    /** Points that lie off the other outline. */
    off: number;
    /** How far the worst point that is off is from the nearest point of the other outline. */
    maxOffMeters: number;
    /** The two sockets with the worst point, as `piece/socket`. */
    worst: [string, string] | null;
}
export interface WalkableValues {
    /** The id of the player profile. */
    player: string;
    /** The name of the player profile, for people. The id again for a profile that was given no name. */
    playerName: string;
    capsuleRadiusMeters: number;
    capsuleHeightMeters: number;
    stepHeightMeters: number;
    walkableSlopeDegrees: number;
    pieces: {
        piece: string;
        /** What was measured: the collision shapes the piece brings, or its visible mesh when it brings none. */
        geometry: "collision" | "visible";
        passages: {
            socket: string;
            fits: boolean;
            /** The opening the player passes, or the largest there is when the player fits none. Zero when the way is shut. */
            widthMeters: number;
            heightMeters: number;
            /** How far above the bottom of the socket's cell the player stands. */
            floorMeters: number;
        }[];
        /** The rises a player would have to step up, from a floor at a passage. */
        rises: number[];
        ramps: {
            angleDegrees: number;
            areaSquareMeters: number;
            walkable: boolean;
        }[];
    }[];
    /** The greatest difference between the floors of two passages that can meet. */
    maxFloorStepMeters: number;
    maxRiseMeters: number;
    maxRampDegrees: number;
}
export interface CollisionTileValues {
    toleranceSquareMeters: number;
    types: SeamValues["types"];
    /** Pieces with sockets and no collision shape. */
    without: string[];
    /** Sockets with no collision on their plane, as `piece/socket`. */
    empty: string[];
    maxMismatchSquareMeters: number;
}
export type KitCheckResult = (ResultBase & {
    id: "on-grid";
    values: OnGridValues;
}) | (ResultBase & {
    id: "seams";
    values: SeamValues;
}) | (ResultBase & {
    id: "in-cells";
    values: InCellsValues;
}) | (ResultBase & {
    id: "layouts";
    values: LayoutValues;
}) | (ResultBase & {
    id: "corners";
    values: CornerValues;
}) | (ResultBase & {
    id: "walkable";
    values: WalkableValues;
}) | (ResultBase & {
    id: "collision-tiles";
    values: CollisionTileValues;
});
export interface KitCheckReport {
    /** Version of this report layout. */
    schema: 1;
    generator: string;
    /** The kit's name. */
    kit: string;
    /** Engine profile id. */
    profile: string;
    grid: KitGrid;
    toleranceMeters: number;
    player: PlayerProfile;
    /** True when a kernel was given. */
    kernel: boolean;
    pieces: number;
    /** The worst of the results: `"fail"` over `"warn"` over `"pass"`. What was not measured does not count. */
    status: "pass" | "warn" | "fail";
    counts: {
        pass: number;
        warn: number;
        fail: number;
        notMeasured: number;
    };
    /** One result for every check, always all seven, in the order of `KIT_CHECK_IDS`. */
    results: KitCheckResult[];
    /** Every layout that was checked: the test layouts built from the sockets, then the caller's own. */
    layouts: KitLayout[];
}
/**
 * Runs the seven kit checks and returns one result for each: pass, warn, fail, or not measured
 * with the reason, each with the numbers it was judged by. Nothing is thrown for a kit that
 * fails a check, only for a kit that cannot be read.
 *
 * Everything is measured from the files the kit's pieces are written as. No check needs a
 * kernel but one part of Layouts close: whether trim that reaches into the piece next to it
 * runs into that piece's bodies. Without a kernel that is not measured, and the check says so.
 *
 * Another module size is one call: pass `{ grid }` in the options.
 */
export declare function checkKit(input: KitInput | Kit, options?: KitCheckOptions): KitCheckReport;
