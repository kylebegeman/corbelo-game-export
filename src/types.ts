import type { EngineProfile, EngineProfileId } from "./profiles.js";

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
  /** Names the material. Without it the name comes from the colour. */
  materialName?: string;
  /** One whole number per triangle, naming the exact CAD face the triangle came from. */
  faceIds?: ArrayLike<number>;
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
  /** The node and mesh name as written. */
  name: string;
  /** The name the caller gave. */
  sourceName: string;
  /** Index of the node in the glTF `nodes` array. */
  node: number;
  /** Index of the mesh in the glTF `meshes` array. */
  mesh: number;
  triangles: number;
  /** Vertices written, after splitting along hard edges. */
  vertices: number;
  materialSlots: number;
  /** Material names, one per slot. */
  materials: string[];
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
}

export interface MaterialFacts {
  name: string;
  /** sRGB, `"#rrggbb"`. */
  color: string;
  /** Linear, as written to the file. */
  baseColorFactor: [number, number, number, number];
  /** How many bodies use it. */
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
