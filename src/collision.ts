import { NO_DECOMPOSITION, refuse } from "./errors.js";
import { convexHull, meshVolume, type Hull } from "./hull.js";
import type { CollisionRequest, CollisionSettings, CollisionShape } from "./types.js";

/** The collision volume may differ from the visible part's by this share before `auto` moves on. */
export const DEFAULT_COLLISION_TOLERANCE = 0.05;
/** The most convex pieces a decomposition makes. */
export const DEFAULT_MAX_COLLISION_PIECES = 8;
/** The most corners one convex piece has. */
export const DEFAULT_MAX_HULL_VERTICES = 64;
/** How many places along each axis a decomposition tries to cut a part. */
export const DECOMPOSITION_CUTS_PER_AXIS = 12;

const REQUESTS: readonly string[] = ["none", "auto", "box", "hull", "pieces", "decomposition"];
/** Cheapest first. */
const TIERS: readonly CollisionShape[] = ["box", "hull", "pieces", "decomposition"];

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
export function manifoldKernel<M>(module: {
  Mesh: new (options: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array }) => M;
  Manifold: new (mesh: M) => KernelSolid;
}): CollisionKernel {
  return { solid: (positions, indices) => new module.Manifold(new module.Mesh({ numProp: 3, vertProperties: positions, triVerts: indices })) };
}

export interface ResolvedCollisionSettings {
  shape: CollisionRequest;
  tolerance: number;
  maxPieces: number;
  maxHullVertices: number;
}

/** Reads the `collision` option: a shape by name, or settings. Refuses anything else. */
/** Reads collision settings. What they leave out is taken from `base`: the settings of the asset, for those of one body. */
export function readCollisionSettings(option: CollisionRequest | CollisionSettings | undefined, base?: ResolvedCollisionSettings): ResolvedCollisionSettings {
  const given: CollisionSettings = option === undefined ? {} : typeof option === "string" ? { shape: option } : option;
  if (typeof given !== "object" || given === null) refuse("BAD_OPTION", `collision must be one of ${REQUESTS.map((name) => `"${name}"`).join(", ")} or { shape, tolerance, maxPieces, maxHullVertices }.`);
  const shape = given.shape ?? base?.shape ?? "auto";
  if (!REQUESTS.includes(shape)) refuse("BAD_OPTION", `collision shape must be one of ${REQUESTS.map((name) => `"${name}"`).join(", ")}. Got ${JSON.stringify(shape)}.`);
  const tolerance = given.tolerance ?? base?.tolerance ?? DEFAULT_COLLISION_TOLERANCE;
  if (!(Number.isFinite(tolerance) && tolerance >= 0)) refuse("BAD_OPTION", `collision tolerance must be zero or a positive share of the visible volume, like 0.05. Got ${String(tolerance)}.`);
  const maxPieces = given.maxPieces ?? base?.maxPieces ?? DEFAULT_MAX_COLLISION_PIECES;
  if (!(Number.isInteger(maxPieces) && maxPieces >= 1)) refuse("BAD_OPTION", `collision maxPieces must be a whole number of at least 1. Got ${String(maxPieces)}.`);
  const maxHullVertices = given.maxHullVertices ?? base?.maxHullVertices ?? DEFAULT_MAX_HULL_VERTICES;
  if (!(Number.isInteger(maxHullVertices) && maxHullVertices >= 4)) refuse("BAD_OPTION", `collision maxHullVertices must be a whole number of at least 4. Got ${String(maxHullVertices)}.`);
  return { shape, tolerance, maxPieces, maxHullVertices };
}

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

/** The box around points, as a piece: 8 corners and 12 triangles. Null when the box has no volume. */
function boxPiece(positions: ArrayLike<number>): CollisionPiece | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < positions.length; at += 1) {
    const value = positions[at]!;
    if (value < min[at % 3]!) min[at % 3] = value;
    if (value > max[at % 3]!) max[at % 3] = value;
  }
  const volume = (max[0]! - min[0]!) * (max[1]! - min[1]!) * (max[2]! - min[2]!);
  if (!(volume > 0)) return null;
  const corners = new Float64Array(24);
  for (let corner = 0; corner < 8; corner += 1) {
    corners[corner * 3] = corner & 1 ? max[0]! : min[0]!;
    corners[corner * 3 + 1] = corner & 2 ? max[1]! : min[1]!;
    corners[corner * 3 + 2] = corner & 4 ? max[2]! : min[2]!;
  }
  // Two triangles per side, facing outwards.
  const indices = Uint32Array.from([0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6]);
  return { positions: corners, indices, volume, capped: false, kind: "box" };
}

/** Each place in space once: the kernel needs a mesh whose triangles share vertices where they meet. */
export function weldExact(positions: ArrayLike<number>, indices: ArrayLike<number>): { positions: Float32Array; indices: Uint32Array } {
  const numberOf = new Map<string, number>();
  const remap = new Uint32Array(positions.length / 3);
  const kept: number[] = [];
  for (let vertex = 0; vertex < remap.length; vertex += 1) {
    const x = Math.fround(positions[vertex * 3]!) + 0;
    const y = Math.fround(positions[vertex * 3 + 1]!) + 0;
    const z = Math.fround(positions[vertex * 3 + 2]!) + 0;
    const key = `${x},${y},${z}`;
    let number = numberOf.get(key);
    if (number === undefined) {
      number = numberOf.size;
      numberOf.set(key, number);
      kept.push(x, y, z);
    }
    remap[vertex] = number;
  }
  const welded = new Uint32Array(indices.length);
  for (let at = 0; at < indices.length; at += 1) welded[at] = remap[indices[at]!]!;
  return { positions: Float32Array.from(kept), indices: welded };
}

interface Part {
  solid: KernelSolid;
  volume: number;
  /** The volume of its convex hull less its own: what a hull around it would add. */
  excess: number;
  /** True once no cut was found that makes it better. */
  settled: boolean;
}

/** One way to cut a part: what it leaves, and the solids the kernel made on the way. */
interface Cut {
  pieces: Part[];
  solids: KernelSolid[];
  /** What the hulls of the pieces add together. */
  left: number;
  /** The share of the part's volume the largest piece has. */
  balance: number;
  /** The most the hull of any one piece adds. */
  spread: number;
}

/** The parts of a decomposition may hold this share more or less volume than the body before the result is not trusted. */
const DECOMPOSITION_VOLUME_SLACK = 0.001;

/**
 * Why a welded mesh is not a solid with all its faces outwards, or null when it is. Every edge
 * of such a solid is walked once each way, by the two triangles that meet at it.
 */
function solidFault(indices: Uint32Array, vertices: number): string | null {
  const walked = new Map<number, number>();
  let flat = 0;
  for (let at = 0; at < indices.length; at += 3) {
    const corners = [indices[at]!, indices[at + 1]!, indices[at + 2]!];
    if (corners[0] === corners[1] || corners[1] === corners[2] || corners[0] === corners[2]) {
      flat += 1;
      continue;
    }
    for (let k = 0; k < 3; k += 1) {
      const key = corners[k]! * vertices + corners[(k + 1) % 3]!;
      walked.set(key, (walked.get(key) ?? 0) + 1);
    }
  }
  if (flat > 0) return `${flat === 1 ? "1 triangle has" : `${flat} triangles have`} two corners at one place once the body is stored, so its surface does not close.`;
  let turned = 0;
  let open = 0;
  for (const [key, count] of walked) {
    const from = Math.floor(key / vertices);
    const back = walked.get((key % vertices) * vertices + from) ?? 0;
    if (count > 1) turned += 1;
    else if (back === 0) open += 1;
  }
  if (turned > 0) return `${turned === 1 ? "1 edge joins" : `${turned} edges join`} faces that point opposite ways, so the body has no clear inside. Turn every face to point outwards.`;
  if (open > 0) return `${open === 1 ? "1 edge has" : `${open} edges have`} a face on one side only once the body is stored, so its surface does not close.`;
  return null;
}

/**
 * A general convex decomposition: the solid is cut by planes along the axes, the part whose hull
 * adds the most volume first and at the place that leaves the least, until the hulls together
 * are within the tolerance or there are as many parts as allowed.
 *
 * A hole through a part is not opened by one cut: each half still has a notch that its hull
 * fills. Where no cut leaves less, the cuts that share what is left most evenly between their
 * pieces are looked at one cut further, and the one that a second cut gains the most from is
 * taken.
 *
 * Returns the pieces, or the reason there are none.
 */
function decompose(source: CollisionSource, kernel: CollisionKernel, visibleVolume: number, settings: ResolvedCollisionSettings): CollisionPiece[] | string {
  const alive = new Set<KernelSolid>();
  const keep = <T extends KernelSolid>(solid: T, into?: KernelSolid[]): T => {
    alive.add(solid);
    into?.push(solid);
    return solid;
  };
  const free = (solids: Iterable<KernelSolid>): void => {
    for (const solid of solids) if (alive.delete(solid)) solid.delete?.();
  };
  const measure = (solid: KernelSolid): Part => {
    const volume = solid.volume();
    const hull = keep(solid.hull());
    const excess = Math.max(0, hull.volume() - volume);
    free([hull]);
    return { solid, volume, excess, settled: false };
  };
  /** The parts of a solid that do not touch, measured. Parts with next to no volume are left out. */
  const partsOf = (solid: KernelSolid, into?: KernelSolid[]): Part[] => {
    const separate = solid.decompose === undefined ? [solid] : solid.decompose().map((part) => keep(part, into));
    return separate.map(measure).filter((part) => part.volume > visibleVolume * 1e-9);
  };
  const near = visibleVolume * 1e-6;
  /**
   * Every cut of a part that makes two or more pieces and no more than `room`, axis by axis.
   * Places to cut: where the part has vertices, strictly inside it, and at most so many per axis.
   */
  const cutsOf = (part: Part, room: number): Cut[][] => {
    const mesh = part.solid.getMesh();
    const byAxis: Cut[][] = [];
    for (let axis = 0; axis < 3; axis += 1) {
      const values = new Set<number>();
      let low = Infinity;
      let high = -Infinity;
      for (let at = axis; at < mesh.vertProperties.length; at += mesh.numProp) {
        const value = mesh.vertProperties[at]!;
        values.add(value);
        if (value < low) low = value;
        if (value > high) high = value;
      }
      const margin = (high - low) * 1e-6;
      let places = [...values].filter((value) => value > low + margin && value < high - margin).sort((a, b) => a - b);
      if (places.length > DECOMPOSITION_CUTS_PER_AXIS) {
        const all = places;
        places = Array.from({ length: DECOMPOSITION_CUTS_PER_AXIS }, (_, at) => all[Math.floor(((at + 0.5) * all.length) / DECOMPOSITION_CUTS_PER_AXIS)]!);
      }
      if (places.length === 0) places = [(low + high) / 2];
      const normal: [number, number, number] = [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0];
      const cuts: Cut[] = [];
      for (const place of places) {
        const solids: KernelSolid[] = [];
        const pieces = part.solid.splitByPlane(normal, place).flatMap((half) => partsOf(keep(half, solids), solids));
        if (pieces.length < 2 || pieces.length > room) {
          free(solids);
          continue;
        }
        cuts.push({
          pieces,
          solids,
          left: pieces.reduce((total, piece) => total + piece.excess, 0),
          balance: Math.max(...pieces.map((piece) => piece.volume)) / part.volume,
          spread: Math.max(...pieces.map((piece) => piece.excess)),
        });
      }
      byAxis.push(cuts);
    }
    return byAxis;
  };
  try {
    const welded = weldExact(source.positions, source.indices);
    const fault = solidFault(welded.indices, welded.positions.length / 3);
    if (fault !== null) return fault;
    let whole: KernelSolid;
    try {
      whole = keep(kernel.solid(welded.positions, welded.indices));
    } catch (error) {
      return `The kernel did not take the body as a closed solid. It said: ${error instanceof Error ? error.message : String(error)}`;
    }
    let parts = partsOf(whole);
    if (parts.length === 0) return "The kernel made a solid with no volume from the body.";
    for (;;) {
      const excess = parts.reduce((total, part) => total + part.excess, 0);
      if (excess <= settings.tolerance * visibleVolume || parts.length >= settings.maxPieces) break;
      let worst = -1;
      for (const [at, part] of parts.entries()) {
        if (!part.settled && part.excess > 0 && (worst < 0 || part.excess > parts[worst]!.excess)) worst = at;
      }
      if (worst < 0) break;
      const part = parts[worst]!;
      const room = settings.maxPieces - (parts.length - 1);
      const byAxis = cutsOf(part, room);

      // Less left over wins. Between cuts that leave the same, the one with the more even parts.
      let chosen: Cut | undefined;
      for (const cut of byAxis.flat()) {
        if (chosen === undefined || (Math.abs(cut.left - chosen.left) <= near ? cut.balance < chosen.balance - 1e-6 : cut.left < chosen.left)) chosen = cut;
      }
      if (chosen === undefined) {
        part.settled = true;
        continue;
      }
      if (part.excess - chosen.left <= near) {
        // No cut leaves less. Along each axis, the cut that shares what is left most evenly
        // between its pieces goes through the middle of what the hull fills: a second cut across
        // it is what opens a hole. The one a second cut gains the most from is taken.
        let gained = near;
        for (const cuts of byAxis) {
          let even: Cut | undefined;
          for (const cut of cuts) {
            if (even === undefined || (Math.abs(cut.spread - even.spread) <= near ? cut.balance < even.balance - 1e-6 : cut.spread < even.spread)) even = cut;
          }
          const roomAfter = room - (even?.pieces.length ?? room) + 1;
          if (even === undefined || roomAfter < 2) continue;
          let gain = 0;
          for (const piece of even.pieces) {
            if (!(piece.excess > 0)) continue;
            for (const next of cutsOf(piece, roomAfter).flat()) {
              gain = Math.max(gain, piece.excess - next.left);
              free(next.solids);
            }
          }
          if (gain > gained) {
            gained = gain;
            chosen = even;
          }
        }
        // With nothing gained two cuts on, the cut is taken all the same: a hollow may only get
        // better later still. The number of parts allowed is what ends the cutting.
      }
      for (const cut of byAxis.flat()) if (cut !== chosen) free(cut.solids);
      parts = [...parts.slice(0, worst), ...chosen.pieces, ...parts.slice(worst + 1)];
    }

    // The parts together are the body. When they are not, the kernel cut up something else.
    const cut = parts.reduce((total, part) => total + part.volume, 0);
    if (Math.abs(cut - visibleVolume) > DECOMPOSITION_VOLUME_SLACK * visibleVolume) {
      const share = Math.round((Math.abs(cut - visibleVolume) / visibleVolume) * 1000) / 10;
      return `The parts the kernel made hold ${share}% ${cut > visibleVolume ? "more" : "less"} volume than the body. That happens when its surface crosses itself or it has a hollow shut inside it.`;
    }

    // Each part is written as the hull of its own vertices, built here the same way as every other piece.
    const pieces: CollisionPiece[] = [];
    for (const part of parts) {
      const mesh = part.solid.getMesh();
      const points = new Float64Array((mesh.vertProperties.length / mesh.numProp) * 3);
      for (let vertex = 0; vertex < points.length / 3; vertex += 1) {
        for (let axis = 0; axis < 3; axis += 1) points[vertex * 3 + axis] = mesh.vertProperties[vertex * mesh.numProp + axis]!;
      }
      const hull = convexHull(points, settings.maxHullVertices);
      if (hull === null) return "A part of the decomposition is flat, so it has no convex hull.";
      pieces.push({ ...hull, kind: "convex" });
    }
    return pieces;
  } catch (error) {
    return `The kernel could not cut the body up. It said: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    free([...alive]);
  }
}

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
export function planCollision(source: CollisionSource, settings: ResolvedCollisionSettings, kernel: CollisionKernel | undefined): CollisionPlan {
  const requested = settings.shape;
  const notes: string[] = [];
  const tried: CollisionAttempt[] = [];
  if (requested === "none") return { requested, chosen: null, visibleVolume: null, tried, notes };

  let visibleVolume: number | null = null;
  if (source.closed) {
    const volume = meshVolume(source.positions, source.indices);
    if (volume > 0) visibleVolume = volume;
    else notes.push("The body encloses no volume, so collision volume is not compared with it.");
  } else {
    notes.push("The body is not closed, so it has no volume to compare collision with.");
  }

  const build = (shape: CollisionShape): CollisionPiece[] | string => {
    switch (shape) {
      case "box": {
        const piece = boxPiece(source.positions);
        return piece === null ? "The body is flat, so the box around it has no volume." : [piece];
      }
      case "hull": {
        const hull = convexHull(source.positions, settings.maxHullVertices);
        return hull === null ? "The body is flat, so it has no convex hull." : [{ ...hull, kind: "convex" }];
      }
      case "pieces": {
        if (source.pieces === undefined || source.pieces.length === 0) return "No collision pieces were given for the body.";
        const pieces: CollisionPiece[] = [];
        for (const [at, points] of source.pieces.entries()) {
          const hull = convexHull(points, settings.maxHullVertices);
          if (hull === null) return `Collision piece ${at} of the body is flat, so it has no convex hull.`;
          pieces.push({ ...hull, kind: "convex" });
        }
        return pieces;
      }
      case "decomposition": {
        if (kernel === undefined) return "No kernel was given, and a general convex decomposition needs one.";
        if (visibleVolume === null) return "A general convex decomposition needs a closed body with a volume.";
        return decompose(source, kernel, visibleVolume, settings);
      }
    }
  };
  const attempt = (shape: CollisionShape): CollisionAttempt | string => {
    const pieces = build(shape);
    if (typeof pieces === "string") return pieces;
    const volume = pieces.reduce((total, piece) => total + piece.volume, 0);
    const error = visibleVolume === null ? null : (volume - visibleVolume) / visibleVolume;
    const made: CollisionAttempt = { shape, pieces, volume, error, withinTolerance: error === null ? null : Math.abs(error) <= settings.tolerance };
    tried.push(made);
    return made;
  };

  if (requested !== "auto") {
    const made = attempt(requested);
    if (typeof made === "string") refuse("BAD_COLLISION", `Body "${source.name}": collision "${requested}" cannot be built. ${made}`);
    return { requested, chosen: made, visibleVolume, tried, notes };
  }

  for (const shape of TIERS) {
    // Without a volume to compare with, the tiers past the hull have nothing to be chosen by.
    if (visibleVolume === null && (shape === "pieces" || shape === "decomposition")) {
      if (shape === "decomposition" && kernel !== undefined) notes.push(`${NO_DECOMPOSITION}A body that is not closed has no inside to cut into pieces.`);
      continue;
    }
    const made = attempt(shape);
    if (typeof made === "string") {
      // A kernel that was given and made nothing is said apart from a kernel that was not given.
      notes.push(shape === "decomposition" && kernel !== undefined ? `${NO_DECOMPOSITION}${made}` : made);
      continue;
    }
    if (made.withinTolerance === true) return { requested, chosen: made, visibleVolume, tried, notes };
  }
  let chosen: CollisionAttempt | null = null;
  if (visibleVolume === null) {
    chosen = tried.find((made) => made.shape === "hull") ?? tried[0] ?? null;
  } else {
    // A tier with more pieces is taken only when it is nearer by more than rounding.
    for (const made of tried) {
      if (chosen === null || Math.abs(made.error!) < Math.abs(chosen.error!) - 1e-9) chosen = made;
    }
    if (chosen !== null) notes.push("No tier is within the tolerance. The nearest was taken.");
  }
  if (chosen === null) notes.push("No collision shape could be built.");
  return { requested, chosen, visibleVolume, tried, notes };
}
