/** What an engine does with a node whose name follows a convention. */
export type NodeRole = "collision-trimesh" | "collision-convex" | "collision-trimesh-only" | "collision-convex-only" | "collision-box" | "collision-sphere" | "collision-capsule" | "lod";
/** One node-name rule an engine's importer reads. */
export interface NodeNameConvention {
    role: NodeRole;
    affix: "prefix" | "suffix";
    /** The literal text the importer looks for. */
    text: string;
    /**
     * How a full node name is built. `{name}` is the render node's name, `{n}` counts from 0 and
     * `{nn}` is the same counter with two digits.
     */
    pattern: string;
}
export interface EngineProfile {
    id: string;
    /** For people: `"Godot 4"`. */
    name: string;
    /** The engine's unit, for people: `"m"` or `"cm"`. */
    unit: string;
    /** Metres per engine unit. */
    unitMeters: number;
    up: "Y" | "Z";
    /**
     * Node names the engine's importer acts on. Recorded as data. This version of the package
     * writes no collision shapes or detail levels; it only keeps body names clear of these rules.
     */
    conventions: {
        collision: NodeNameConvention[];
        lod: NodeNameConvention[];
    };
}
export type EngineProfileId = "godot4" | "unity6" | "unreal5";
export declare const ENGINE_PROFILES: Readonly<Record<EngineProfileId, EngineProfile>>;
export declare const DEFAULT_PROFILE: EngineProfileId;
/** Returns a built-in profile by id, or checks and returns a custom one. */
export declare function resolveProfile(profile: EngineProfileId | EngineProfile | undefined): EngineProfile;
