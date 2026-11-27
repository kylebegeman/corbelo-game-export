import { badOption, notObject } from "./errors.js";

/** What an engine does with a node whose name follows a convention. */
export type NodeRole =
  | "collision-trimesh"
  | "collision-convex"
  | "collision-trimesh-only"
  | "collision-convex-only"
  | "collision-box"
  | "collision-sphere"
  | "collision-capsule"
  | "lod";

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
   * Node names the engine's importer acts on. `exportGameAsset` names collision shapes and
   * detail levels by them, and every export keeps body names clear of them.
   */
  conventions: {
    collision: NodeNameConvention[];
    lod: NodeNameConvention[];
  };
}

export type EngineProfileId = "godot4" | "unity6" | "unreal5";

const lodSuffix: NodeNameConvention = { role: "lod", affix: "suffix", text: "_LOD", pattern: "{name}_LOD{n}" };

function unrealShape(role: NodeRole, text: string): NodeNameConvention {
  return { role, affix: "prefix", text, pattern: `${text}{name}_{nn}` };
}

function godotHint(role: NodeRole, text: string): NodeNameConvention {
  return { role, affix: "suffix", text, pattern: `{name}${text}` };
}

export const ENGINE_PROFILES: Readonly<Record<EngineProfileId, EngineProfile>> = {
  godot4: {
    id: "godot4",
    name: "Godot 4",
    unit: "m",
    unitMeters: 1,
    up: "Y",
    conventions: {
      collision: [
        godotHint("collision-trimesh", "-col"),
        godotHint("collision-convex", "-convcol"),
        godotHint("collision-trimesh-only", "-colonly"),
        godotHint("collision-convex-only", "-convcolonly"),
      ],
      lod: [],
    },
  },
  unity6: {
    id: "unity6",
    name: "Unity 6",
    unit: "m",
    unitMeters: 1,
    up: "Y",
    conventions: { collision: [], lod: [lodSuffix] },
  },
  unreal5: {
    id: "unreal5",
    name: "Unreal Engine 5",
    unit: "cm",
    unitMeters: 0.01,
    up: "Z",
    conventions: {
      collision: [
        unrealShape("collision-convex", "UCX_"),
        unrealShape("collision-box", "UBX_"),
        unrealShape("collision-sphere", "USP_"),
        unrealShape("collision-capsule", "UCP_"),
      ],
      lod: [lodSuffix],
    },
  },
};

export const DEFAULT_PROFILE: EngineProfileId = "godot4";

/** Returns a built-in profile by id, or checks and returns a custom one. */
export function resolveProfile(profile: EngineProfileId | EngineProfile | undefined): EngineProfile {
  if (profile === undefined) return ENGINE_PROFILES[DEFAULT_PROFILE];
  if (typeof profile === "string") {
    if (!Object.hasOwn(ENGINE_PROFILES, profile)) {
      badOption(`Unknown profile "${profile}". Built-in profiles: ${Object.keys(ENGINE_PROFILES).join(", ")}.`);
    }
    return ENGINE_PROFILES[profile];
  }
  if (notObject(profile)) badOption("profile must be a profile id or a profile object.");
  if (typeof profile.id !== "string" || profile.id === "") badOption("A custom profile needs an id.");
  if (!(Number.isFinite(profile.unitMeters) && profile.unitMeters > 0)) {
    badOption(`Profile "${profile.id}": unitMeters must be a positive number.`);
  }
  if (profile.up !== "Y" && profile.up !== "Z") badOption(`Profile "${profile.id}": up must be "Y" or "Z".`);
  if (!Array.isArray(profile.conventions?.collision) || !Array.isArray(profile.conventions?.lod)) {
    badOption(`Profile "${profile.id}": conventions needs collision and lod lists.`);
  }
  return profile;
}
