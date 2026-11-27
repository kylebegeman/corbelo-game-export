import type { CollisionKernel } from "./collision.js";
import type { EngineProfile, EngineProfileId, NodeRole } from "./profiles.js";

export type Vec3 = [number, number, number];

/** Anything `JSON.stringify` writes and `JSON.parse` reads back unchanged. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * A colour as people see it on screen (sRGB): `"#rrggbb"`, `"#rgb"` or `[r, g, b]` with each
 * channel from 0 to 1. Set `colorSpace: "linear"` when the numbers are linear light instead.
 */
export type ColorInput = string | readonly [number, number, number];

/** One body of triangles, in the caller's own units and axes. */
export interface BodyInput {
  /** Becomes the node name, after it is made safe and unique. */
  name: string;
  /** x, y, z for each vertex. */
  positions: ArrayLike<number>;
  /** Three vertex numbers per triangle. Leave out for triangle soup (nine numbers per triangle). */
  indices?: ArrayLike<number>;
  /** Defaults to a light grey. */
  color?: ColorInput;
  /** Names the material of the body's own colour. Without it the name comes from the colour. */
  materialName?: string;
  /** One whole number per triangle, naming the exact CAD face the triangle came from. */
  faceIds?: ArrayLike<number>;
  /**
   * One entry per triangle: the colour of that triangle, or `null` or `undefined` for the body's
   * own colour. A body with more than one colour is written as one mesh with a primitive, and so
   * a material slot, for each colour.
   */
  faceColors?: readonly (ColorInput | null | undefined)[];
  /**
   * Names for the materials of face colours: the colour, as `"#rrggbb"` or `"#rgb"`, and the name
   * its material gets. A face colour that is not listed is named after itself.
   */
  faceMaterialNames?: Readonly<Record<string, string>>;
  /**
   * Says that the body's triangles are a finer cut of meshes that were there before, and takes
   * the shading from those meshes, so that cutting a surface without moving it does not change
   * how it is shaded.
   */
  refines?: Refinement;
}

/** A mesh of a surface, in the same units and axes as the body. */
export interface SurfaceMesh {
  /** x, y, z for each vertex. */
  positions: ArrayLike<number>;
  /** Three vertex numbers per triangle. Leave out for triangle soup. */
  indices?: ArrayLike<number>;
  /** One whole number per triangle, naming the exact CAD face the triangle came from. */
  faceIds?: ArrayLike<number>;
}

/**
 * The meshes a body was cut from, and for each triangle of the body the triangle it lies in.
 * A body painted across its faces has one: its mesh before the paint cut it. A body with a hole
 * cut into it has two: its own mesh before the cut and the mesh of what cut it, turned to face
 * into the hole.
 */
export interface Refinement {
  /** Each is welded and given hard edges, soft edges and normals by itself, as a body is. */
  surfaces: readonly SurfaceMesh[];
  /** One whole number per triangle of the body: which of `surfaces` it lies in. Leave out when there is one. */
  surfaceOf?: ArrayLike<number>;
  /**
   * One whole number per triangle of the body: a triangle of that surface it lies in. A triangle
   * that reaches across several triangles of a flat part of the surface names any one it touches.
   */
  triangleOf: ArrayLike<number>;
}

/** The space the bodies were authored in. */
export interface SourceSpace {
  /** Metres per source unit: 0.001 for millimetres, 0.0254 for inches, 1 for metres. */
  unit: number;
  /** Which source axis points up. */
  up: "Y" | "Z";
  /**
   * Right-handed unless stated. A left-handed source is a mirror image of glTF's space, so the
   * conversion mirrors it back and reverses triangle winding to keep faces pointing outwards.
   */
  handedness?: "right" | "left";
}

/** Where a body's own origin goes. A point is in source units and source axes. */
export type PivotOption = "base-center" | "center" | "min-corner" | "origin" | readonly [number, number, number];

export type PivotMode = "base-center" | "center" | "min-corner" | "origin" | "point";

/**
 * `"origin"` puts every node at the scene origin. `"designed"` keeps each body where it was
 * modelled. `"assembly"` keeps the bodies together as modelled and moves the whole set so that
 * its own pivot, taken from the box around every body, sits at the scene origin.
 */
export type Placement = "origin" | "designed" | "assembly";

/**
 * `"angle-area"` weights each triangle by its area and its angle at the vertex.
 * `"face-weighted"` weights each triangle by the area of the whole flat face it belongs to, so
 * large flat faces dominate and small bevels take up the shading change.
 */
export type NormalMode = "angle-area" | "face-weighted";

export interface ExportOptions {
  /** Decides the engine unit the facts are also reported in. Default `"godot4"`. */
  profile?: EngineProfileId | EngineProfile;
  /** Default `"base-center"`. */
  pivot?: PivotOption;
  /** Default `"origin"`. */
  placement?: Placement;
  /** Edges sharper than this many degrees are hard. Default 30. */
  creaseAngle?: number;
  /** Default `"angle-area"`. */
  normals?: NormalMode;
  /** Vertices closer than this many metres become one. Default 0.000001 (one micron). */
  weldTolerance?: number;
  /** Refuse input with more triangles than this in total. Default 2,000,000. */
  maxTriangles?: number;
  /** How `[r, g, b]` colours are read. Hex colours are always sRGB. Default `"srgb"`. */
  colorSpace?: "srgb" | "linear";
  /** Opaque JSON stored next to the facts in the scene extras. */
  provenance?: JsonValue;
}

export interface ExportInput extends ExportOptions {
  bodies: readonly BodyInput[];
  source: SourceSpace;
}

/** A lower detail level of a body: a mesh the caller made, in the same units and axes as the body. */
export interface LodInput {
  /** x, y, z for each vertex. */
  positions: ArrayLike<number>;
  /** Three vertex numbers per triangle. Leave out for triangle soup. */
  indices?: ArrayLike<number>;
  /** One whole number per triangle, naming the exact CAD face the triangle came from. */
  faceIds?: ArrayLike<number>;
  /** One entry per triangle, as on a body. Without it the level is all in the body's own colour. */
  faceColors?: readonly (ColorInput | null | undefined)[];
}

/** One piece the body was made from, in the same units and axes as the body. Only its points are used: it becomes their convex hull. */
export interface CollisionPieceInput {
  /** x, y, z for each point. */
  positions: ArrayLike<number>;
}

/** A named point on a body, written as an empty node: where something else goes, like a hand, a light or a door. */
export interface AttachPointInput {
  /** Becomes the node name, after it is made safe and unique in the file. */
  name: string;
  /** In the body's units and axes. */
  position: readonly [number, number, number];
  /** Which way the point faces, in the body's axes. The node's own +Z axis is turned to point along it. */
  direction?: readonly [number, number, number];
}

/** A body of a game asset: a body, and what a game needs around it. */
export interface AssetBodyInput extends BodyInput {
  /** Lower detail levels, the nearest to full detail first. */
  lods?: readonly LodInput[];
  /** The pieces the body was made from, for collision. */
  collisionPieces?: readonly CollisionPieceInput[];
  attachPoints?: readonly AttachPointInput[];
}

/** A collision shape, cheapest first. */
export type CollisionShape = "box" | "hull" | "pieces" | "decomposition";

/** `"none"` writes no collision. `"auto"` takes the cheapest shape whose volume is near enough the visible part's. */
export type CollisionRequest = "none" | "auto" | CollisionShape;

export interface CollisionSettings {
  /** Default `"auto"`. */
  shape?: CollisionRequest;
  /** How far the collision volume may be from the visible volume, as a share of it. Default 0.05. */
  tolerance?: number;
  /** The most convex pieces a decomposition makes. Default 8. */
  maxPieces?: number;
  /** The most corners one convex piece has. Default 64. */
  maxHullVertices?: number;
}

export interface TexcoordOptions {
  /** The side of one whole texture in the world, in metres. Default 1. */
  tileMeters?: number;
}

export interface AssetOptions extends ExportOptions {
  /**
   * A pivot of its own for some bodies: a list in the order of the bodies, where `null` leaves a
   * body to `pivot`, or an object with a pivot for each body name. A body with none has `pivot`.
   */
  pivots?: readonly (PivotOption | null | undefined)[] | Readonly<Record<string, PivotOption>>;
  /** Default `"auto"`. */
  collision?: CollisionRequest | CollisionSettings;
  /** `true` or `{ tileMeters }` writes box-projected texture coordinates. Default none. */
  texcoords?: boolean | TexcoordOptions;
  /** Needed only for a general convex decomposition. */
  kernel?: CollisionKernel;
}

export interface AssetInput extends AssetOptions {
  bodies: readonly AssetBodyInput[];
  source: SourceSpace;
}

export interface Box {
  min: Vec3;
  max: Vec3;
  size: Vec3;
}

/**
 * The same box twice: in glTF space (metres, +Y up) and in the engine's unit, with the up axis
 * moved to the engine's up axis.
 */
export interface MeasuredBox {
  meters: Box;
  engine: Box;
}

export interface PivotFacts {
  mode: PivotMode;
  /** The pivot in glTF space: metres, +Y up. */
  meters: Vec3;
  /** The pivot in the engine's unit and up axis. */
  engine: Vec3;
  /** The pivot in the caller's units and axes. */
  source: Vec3;
}

export interface BodyFacts {
  /**
   * The node name as written, and the mesh name too, except where detail levels are laid out
   * as a group: there the body's node is empty and its full-detail mesh is named as level 0.
   */
  name: string;
  /** The name the caller gave. */
  sourceName: string;
  /** Index of the node in the glTF `nodes` array. */
  node: number;
  /** Index of the full-detail mesh in the glTF `meshes` array. */
  mesh: number;
  triangles: number;
  /** Vertices written, after splitting along hard edges and between colours. */
  vertices: number;
  /** Primitives of the mesh: one for each colour the written triangles have. */
  materialSlots: number;
  /** Material names, one per slot. */
  materials: string[];
  /**
   * Only for a body with more than one material slot: what each slot holds, in slot order. The
   * triangles add up to `triangles` and the vertices to `vertices`.
   */
  slots?: SlotFacts[];
  /**
   * Only for a body given `refines`: how many surfaces its shading was taken from and how many
   * triangles they hold together.
   */
  shadedFrom?: { surfaces: number; triangles: number };
  degenerateTrianglesDropped: number;
  /** Edges used by exactly one triangle. Zero for a closed body. */
  openEdges: number;
  /** Edges used by more than two triangles. */
  nonManifoldEdges: number;
  /** Where the body sits in the scene, node translation included. */
  bounds: MeasuredBox;
  /** The vertex data as stored, relative to the pivot. */
  localBounds: MeasuredBox;
  pivot: PivotFacts;
  /** The node translation in metres. All zero when `placement` is `"origin"`. */
  translation: Vec3;
  /** Only from `exportGameAsset`, when collision was asked for. */
  collision?: CollisionFacts;
  /** Only from `exportGameAsset`, for a body given lower detail levels: every level, level 0 first. */
  lods?: LodFacts[];
  /** Only from `exportGameAsset`, for a body given attach points. */
  attachPoints?: AttachPointFacts[];
}

/** A tier of collision that was built and measured. Volumes are cubic metres. */
export interface CollisionTierFacts {
  shape: CollisionShape;
  pieces: number;
  /** The volumes of the pieces added up. */
  volume: number;
  /** `(volume - visible) / visible`. Null when the body has no volume to compare with. */
  error: number | null;
  withinTolerance: boolean | null;
}

/** One node of a collision shape: one convex piece. */
export interface CollisionNodeFacts {
  /** The node and mesh name as written, in the way the engine reads it. */
  name: string;
  node: number;
  mesh: number;
  /** `"box"` is the box around the body. Everything else is `"convex"`. */
  kind: "box" | "convex";
  /** What the profile says the engine does with the name. Null when the profile has no rule for it. */
  role: NodeRole | null;
  vertices: number;
  triangles: number;
  /** Cubic metres. */
  volume: number;
  /** True when the piece was stopped at the most corners allowed and left points outside. */
  capped: boolean;
  /** Where the piece sits in the scene. */
  bounds: MeasuredBox;
}

export interface CollisionFacts {
  requested: CollisionRequest;
  /** The shape written. `"none"` when none was asked for or none could be built. */
  shape: CollisionShape | "none";
  /** How many convex pieces, and so how many nodes. */
  pieces: number;
  tolerance: number;
  /** Cubic metres. `visible` and `error` are null for a body that is not closed. */
  volume: { visible: number | null; collision: number; error: number | null };
  withinTolerance: boolean | null;
  nodes: CollisionNodeFacts[];
  /** Every tier that was built on the way, cheapest first. */
  tried: CollisionTierFacts[];
  /** Why a tier was passed over, or why there is no shape. */
  notes: string[];
}

/** One detail level of a body. Level 0 is the body at full detail. */
export interface LodFacts {
  level: number;
  /** The node and mesh name as written. */
  name: string;
  node: number;
  mesh: number;
  /** False for a level written hidden with `KHR_node_visibility`, for the game to show in its turn. */
  visible: boolean;
  triangles: number;
  vertices: number;
  materialSlots: number;
  materials: string[];
  degenerateTrianglesDropped: number;
  openEdges: number;
  nonManifoldEdges: number;
  /**
   * How far the outline moved from level 0: the greatest distance from a vertex or the middle
   * of a triangle of either mesh to the nearest point of the other. `share` is that distance
   * over the diagonal of the box around level 0. All zero for level 0.
   */
  deviation: { meters: number; engine: number; share: number };
}

export interface AttachPointFacts {
  /** The node name as written. */
  name: string;
  /** The name the caller gave. */
  sourceName: string;
  node: number;
  /** Where the point is in the scene: metres, +Y up. */
  meters: Vec3;
  /** The same in the engine's unit and up axis. */
  engine: Vec3;
  /** The same in the caller's units and axes. */
  source: Vec3;
  /** Only with a direction: the way the node's +Z axis points, in glTF axes, at length 1. */
  direction?: Vec3;
}

/** One material slot of a body: one primitive of its mesh. */
export interface SlotFacts {
  /** Material name. */
  material: string;
  triangles: number;
  vertices: number;
}

export interface MaterialFacts {
  name: string;
  /** sRGB, `"#rrggbb"`. */
  color: string;
  /** Linear, as written to the file. */
  baseColorFactor: [number, number, number, number];
  /** How many bodies have a triangle in it. */
  bodies: number;
}

export interface TotalFacts {
  bodies: number;
  triangles: number;
  vertices: number;
  /** Distinct materials in the file. */
  materialSlots: number;
  degenerateTrianglesDropped: number;
  openEdges: number;
  nonManifoldEdges: number;
  /** The box around every body in the scene. */
  bounds: MeasuredBox;
}

export interface PackFacts {
  /** Version of this facts layout. */
  schema: 1;
  generator: string;
  /** Profile id. */
  profile: string;
  engine: { unit: string; unitMeters: number; up: "Y" | "Z" };
  source: { unit: number; up: "Y" | "Z"; handedness: "right" | "left" };
  settings: {
    pivot: PivotMode;
    placement: Placement;
    creaseAngle: number;
    normals: NormalMode;
    weldTolerance: number;
    faceIds: boolean;
    /** Only from `exportGameAsset`, with texture coordinates. */
    texcoords?: { projection: "box"; tileMeters: number };
    /** Only from `exportGameAsset`. */
    collision?: { shape: CollisionRequest; tolerance: number; maxPieces: number; maxHullVertices: number; kernel: boolean };
    /**
     * Only from `exportGameAsset`, when a body has lower detail levels. `"group"`: the body's
     * node is empty and every level is a child of it, named the way the engine reads levels.
     * `"children"`: the body's node holds level 0 and the lower levels are its children, hidden.
     */
    lodLayout?: "group" | "children";
  };
  bodies: BodyFacts[];
  materials: MaterialFacts[];
  total: TotalFacts;
  /**
   * Only with `placement: "assembly"`: the point of the whole set of bodies, as modelled, that
   * sits at the scene origin.
   */
  assemblyPivot?: PivotFacts;
}

export interface ExportResult {
  glb: Uint8Array;
  facts: PackFacts;
}

/** What `scenes[0].extras.corbeloGameExport` holds. */
export interface PackExtras {
  schema: 1;
  profile: EngineProfile;
  facts: PackFacts;
  provenance?: JsonValue;
}
