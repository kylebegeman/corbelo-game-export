import { type GlbDocument } from "./glb-read.js";
import type { MessagePart, MessageValues } from "./messages.js";
import type { EngineProfileId } from "./profiles.js";
import type { CollisionRequest, CollisionShape, NormalMode, PivotMode, Vec3 } from "./types.js";
/** What kind of asset it is, which decides the starting budget and the size it is expected to have. */
export type AssetClass = "small-prop" | "large-prop" | "kit-piece";
/** Limits for one asset. Vertices are counted after hard edges split them, since that is what an engine draws. */
export interface GameBudget {
    maxTriangles: number;
    maxVertices: number;
    maxMaterialSlots: number;
}
/** Starting budgets. They are places to start from, not rules of any engine: pass your own with `budget`. */
export declare const ASSET_BUDGETS: Readonly<Record<AssetClass, GameBudget>>;
/** The longest side each class of asset is expected to have, in metres. Outside it, the size check warns. */
export declare const ASSET_SIZE_RANGES: Readonly<Record<AssetClass, {
    minMeters: number;
    maxMeters: number;
}>>;
export declare const DEFAULT_ASSET_CLASS: AssetClass;
/** The grid a pivot is checked against, in metres. */
export declare const DEFAULT_GRID_METERS = 1;
/** A lower detail level may move the outline by this share of the diagonal of the body before the check warns. */
export declare const DEFAULT_LOD_DEVIATION_SHARE = 0.05;
/** A triangle is a sliver when twice its area is under this share of its longest edge squared. */
export declare const SLIVER_AREA_RATIO = 0.01;
/** A vertex normal this many degrees from the face of a triangle it shades is worth a look. */
export declare const NORMAL_ANGLE_WARNING_DEGREES = 60;
/** The longer side of the picture openings are looked for in, in cells. */
export declare const OPENING_GRID_CELLS = 384;
/** A rise taller than this, in metres, is a ledge and not a step of a stair. */
export declare const STEP_MAX_RISE_METERS = 0.6;
/** Slopes from this many degrees are ramps. Flatter is a floor. */
export declare const RAMP_MIN_DEGREES = 2;
/** Slopes steeper than this many degrees are walls or roofs, not ramps. */
export declare const RAMP_MAX_DEGREES = 60;
/**
 * The body that moves through a level: a capsule, and what it can climb. Lengths are metres.
 * `capsuleHeightM` is the whole capsule, end to end.
 */
export interface PlayerProfile {
    id: string;
    name: string;
    /** `"built-in"` for the profiles of this package. */
    origin: string;
    engine?: string;
    capsuleRadiusM: number;
    capsuleHeightM: number;
    /** The tallest rise walked up without a jump. Zero when the character controller climbs no steps. */
    stepHeightM: number;
    walkableSlopeDeg: number;
    jumpHeightM: number;
    note?: string;
}
/**
 * Each engine's own character, at the values a new one starts with. The README says which of
 * these numbers the engines' documentation states and which it does not.
 */
export declare const PLAYER_PROFILES: Readonly<Record<EngineProfileId, PlayerProfile>>;
export type CheckStatus = "pass" | "warn" | "fail" | "not-measured";
export interface CheckOptions {
    /** Default `"small-prop"`. */
    assetClass?: AssetClass;
    /** Replaces the starting budget of the class, one limit at a time. */
    budget?: Partial<GameBudget>;
    /** A profile of your own, or the id of an engine profile. Default: the player of the engine the file was written for. */
    player?: PlayerProfile | EngineProfileId;
    /** Default 1. */
    gridMeters?: number;
    /** How far the collision volume may be from the visible volume. Default: the tolerance the file was written with. */
    collisionTolerance?: number;
    /** Default 0.05. */
    lodDeviationShare?: number;
    /**
     * What the asset is meant to have for the player. Saying `true` turns "none found" and "found,
     * but the player does not fit" from a note or a warning into a failure.
     */
    expect?: {
        opening?: boolean;
        stairs?: boolean;
        ramp?: boolean;
    };
}
export interface SizeValues {
    /** The box around everything in the file, in metres and in the engine's unit. */
    meters: Vec3;
    engine: Vec3;
    unit: string;
    largestMeters: number;
    expectedMeters: [number, number];
    /** What to multiply the size by to land in the expected range, when a mix-up of units would explain it. Otherwise null. */
    suggestedScale: number | null;
}
export interface PivotValues {
    gridMeters: number;
    bodies: {
        name: string;
        mode: PivotMode;
        /** Where the pivot is in the scene, in metres. */
        meters: Vec3;
        /** From the corner of the body's box with the least x, y and z to the pivot, in metres. */
        fromMinCorner: Vec3;
        /** True when the pivot is in or on the body's box. */
        inside: boolean;
        /**
         * True when the pivot is a whole number of grid steps from a face of the body's box along
         * every axis the body is at least one grid step long in.
         */
        onGrid: boolean;
    }[];
}
export interface CountValues {
    count: number;
    budget: number;
    bodies: {
        name: string;
        count: number;
    }[];
}
export interface ShadingValues {
    normals: NormalMode;
    creaseAngle: number;
    /** Edges where two triangles meet with different normals. */
    hardEdges: number;
    /** Edges where two triangles meet with the same normals. */
    softEdges: number;
    /** Corners whose normal points away from the triangle it shades. */
    backFacingNormals: number;
    /** The widest angle between a vertex normal and the face of a triangle it shades, in degrees. */
    maxNormalAngle: number;
}
export interface CleanMeshValues {
    /** Triangles with no area that were left out when the file was written. */
    degenerateTrianglesDropped: number;
    sliverTriangles: number;
    /** Edges whose two triangles face opposite ways. */
    flippedEdges: number;
    /** Closed bodies whose faces point inwards. */
    insideOutBodies: number;
    openEdges: number;
    nonManifoldEdges: number;
}
export interface MaterialSlotValues {
    /** The most slots any one body has. */
    count: number;
    budget: number;
    /** Distinct materials in the file. */
    fileMaterials: number;
    bodies: {
        name: string;
        count: number;
    }[];
}
export interface CollisionValues {
    tolerance: number;
    bodies: {
        name: string;
        /** What was asked for. `"none"` for a body with no collision facts. */
        requested: CollisionRequest;
        shape: CollisionShape | "none";
        pieces: number;
        /** `(collision - visible) / visible`. Null when the body is not closed. */
        error: number | null;
        withinTolerance: boolean | null;
        /** The share this body was judged by: the one given to the check, or else its own. */
        tolerance?: number;
        /** What this body alone comes to. The worst of them is the status of the check. */
        status?: CheckStatus;
    }[];
}
export interface DetailLevelValues {
    maxDeviationShare: number;
    bodies: {
        name: string;
        levels: {
            level: number;
            triangles: number;
            vertices: number;
            openEdges: number;
            deviationMeters: number;
            deviationShare: number;
        }[];
    }[];
}
export interface OpeningValues {
    /** The id of the player profile. */
    player: string;
    /** The name of the player profile, for people. The id again for a profile that was given no name. */
    playerName: string;
    capsuleRadiusMeters: number;
    capsuleHeightMeters: number;
    /** The size of one cell of the picture the openings were measured in. Sizes are good to about two cells. */
    cellMeters: number;
    openings: {
        /** The axis looked along, in glTF space: the way through the opening. */
        axis: "x" | "z";
        widthMeters: number;
        heightMeters: number;
        /** How far above the bottom of the asset the player stands in it, or its lowest point when the player does not fit. */
        sillMeters: number;
        /** True when the capsule fits in it standing up. */
        fits: boolean;
        /** True when it fits and the sill is no taller than the step height. */
        walkIn: boolean;
    }[];
    /** Openings too small to be meant for the player: narrower than the capsule's radius or lower than half its height. */
    ignored: number;
}
export interface StepValues {
    /** The id of the player profile. */
    player: string;
    /** The name of the player profile, for people. The id again for a profile that was given no name. */
    playerName: string;
    stepHeightMeters: number;
    jumpHeightMeters: number;
    /** Flat levels a player can stand on, as heights above the bottom of the asset, lowest first. */
    levels: number[];
    /** The rises of the stair found: from the bottom to the first level, then level to level. */
    rises: number[];
    maxRiseMeters: number | null;
}
export interface RampValues {
    /** The id of the player profile. */
    player: string;
    /** The name of the player profile, for people. The id again for a profile that was given no name. */
    playerName: string;
    walkableSlopeDegrees: number;
    ramps: {
        angleDegrees: number;
        areaSquareMeters: number;
        walkable: boolean;
    }[];
}
/** What every result of a check has, whatever it measured. */
export interface ResultBase {
    status: CheckStatus;
    /** One sentence for a person. */
    message: string;
    /**
     * What the message says, as a key of the message catalog: the id of the check, then what it
     * found. Every result has one. It is optional for a report written before version 0.1.8.
     */
    messageKey?: string;
    /** The values the template of that key is filled with, by name. */
    messageValues?: MessageValues;
    /** Only with `"not-measured"`: why there is nothing to judge. */
    reason?: string;
    /** With a reason: its key in the message catalog, the message key and then `.reason`. */
    reasonKey?: string;
    /** With a reason: the values the template of that key is filled with, by name. */
    reasonValues?: MessageValues;
}
export type CheckResult = (ResultBase & {
    id: "size";
    values: SizeValues;
}) | (ResultBase & {
    id: "pivot";
    values: PivotValues;
}) | (ResultBase & {
    id: "triangles";
    values: CountValues;
}) | (ResultBase & {
    id: "vertices";
    values: CountValues;
}) | (ResultBase & {
    id: "shading";
    values: ShadingValues;
}) | (ResultBase & {
    id: "clean-mesh";
    values: CleanMeshValues;
}) | (ResultBase & {
    id: "material-slots";
    values: MaterialSlotValues;
}) | (ResultBase & {
    id: "collision";
    values: CollisionValues;
}) | (ResultBase & {
    id: "detail-levels";
    values: DetailLevelValues;
}) | (ResultBase & {
    id: "player-openings";
    values: OpeningValues;
}) | (ResultBase & {
    id: "player-steps";
    values: StepValues;
}) | (ResultBase & {
    id: "player-ramps";
    values: RampValues;
});
export type CheckId = CheckResult["id"];
/** Every check, in the order the results come in. */
export declare const CHECK_IDS: readonly CheckId[];
export interface CheckReport {
    /** Version of this report layout. */
    schema: 1;
    generator: string;
    /** The engine profile the file was written for. */
    profile: string;
    assetClass: AssetClass;
    budget: GameBudget;
    player: PlayerProfile;
    gridMeters: number;
    /** The worst of the results: `"fail"` over `"warn"` over `"pass"`. What was not measured does not count. */
    status: "pass" | "warn" | "fail";
    counts: {
        pass: number;
        warn: number;
        fail: number;
        notMeasured: number;
    };
    /** One result for every check, always all twelve, in the order of `CHECK_IDS`. */
    results: CheckResult[];
}
export declare function round(value: number, digits?: number): number;
export declare function plural(count: number, one: string, many?: string): string;
/** A part of a message with its English text. */
export type Said = MessagePart & {
    text: string;
};
/** A part of a message that has a template of its own: its text, and the key and values that rebuild it. */
export declare function part(text: string, key: string, values?: MessageValues): Said;
/** The texts of the parts of a message, with what stands between them. */
export declare function textOf(parts: readonly Said[], between?: string): string;
/** Adds what was counted to the parts of a message, when there is any of it. */
export declare function counted(parts: Said[], count: number, key: string, one: string, after?: string, many?: string): void;
/**
 * Gives the two functions that add a result to `results`. The checks come in the order of
 * `ids`, so what is added is the result of the next of them. `found` is what the check found:
 * with the id of the check it is the key of the message, `size.expected`. `unmeasured` adds a
 * result with nothing to judge and the reason why.
 */
export declare function adder<Result>(results: Result[], ids: readonly string[]): {
    add: (status: CheckStatus, found: string, message: string, values: object, messageValues?: MessageValues, reason?: string, reasonValues?: MessageValues) => void;
    unmeasured: (found: string, message: string, reason: string, values: object, reasonValues?: MessageValues, messageValues?: MessageValues) => void;
};
/** Triangles where they sit in a scene, in metres, +Y up. */
export interface SceneMesh {
    /** x, y, z per vertex. */
    positions: Float64Array;
    /** Three vertex numbers per triangle. */
    indices: ArrayLike<number>;
}
/**
 * Looks along one level axis for openings that are closed over the top: doorways, arches,
 * windows, tunnels. The asset is drawn as a filled outline on a grid, standing on a floor at
 * its lowest point, and each free region the outline shuts in is one opening.
 */
export declare function openingsAlong(bodies: readonly SceneMesh[], axis: "x" | "z", min: Vec3, max: Vec3, player: PlayerProfile): {
    cell: number;
    openings: OpeningValues["openings"];
    ignored: number;
};
/** Flat places and slopes a player could stand on, read off the triangles that face up. */
export declare function walkable(bodies: readonly SceneMesh[], floor: number, player: PlayerProfile): {
    levels: number[];
    ramps: RampValues["ramps"];
};
/** What a player is called in a message and in the values of a check: its name, or its id when it was given none. */
export declare function playerName(player: PlayerProfile): string;
/** The player a check is run for: a profile of the caller's own, a built-in one by engine profile id, or the player of the engine a file was written for. */
export declare function resolvePlayer(option: PlayerProfile | EngineProfileId | undefined, profile: string): PlayerProfile;
/**
 * Checks a GLB this package wrote against what a game needs of it, and returns one result for
 * every check: pass, warn, fail, or not measured with the reason, each with the numbers it was
 * judged by. Nothing is thrown for an asset that fails a check, only for a file that cannot be
 * read or was not written by this package.
 *
 * Everything is measured from the file: the triangles as written and the facts stored with them.
 */
export declare function checkGameAsset(glb: Uint8Array | GlbDocument, options?: CheckOptions): CheckReport;
