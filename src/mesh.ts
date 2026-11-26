import { refuse } from "./errors.js";
import type { NormalMode } from "./types.js";

/**
 * A triangle is degenerate, and dropped, when two of its corners weld to one vertex or when its
 * three corners lie on one line: twice its area is under this fraction of its longest edge squared.
 */
export const DEGENERATE_AREA_RATIO = 1e-10;

/** Without face ids, triangles within this angle of each other count as one flat face. */
export const FLAT_FACE_ANGLE_DEGREES = 1;

export interface MeshOptions {
  /** Reverse triangle winding, for a conversion that mirrored the positions. */
  reverseWinding: boolean;
  /** Metres. */
  weldTolerance: number;
  creaseAngle: number;
  normals: NormalMode;
}

/**
 * A corner of a mesh must lie this near the surface it is said to lie in: this share of the
 * longest edge of the surface's triangle it is found in, or twice the weld tolerance where that
 * is more.
 */
export const REFINEMENT_REACH = 1e-3;


/** The surfaces a mesh is a finer cut of, already built, and where each of its triangles lies in them. */
export interface CoarseSurfaces {
  /** Each surface as `buildMesh` made it. */
  meshes: readonly BuiltMesh[];
  /** For each surface, the kept triangle each of its input triangles became, or -1 where it was dropped. */
  keptOf: readonly Int32Array[];
  /** The surface each input triangle of the fine mesh lies in. Undefined when there is one surface. */
  surfaceOf: ArrayLike<number> | undefined;
  /** An input triangle of that surface each input triangle of the fine mesh lies in, or in part. */
  triangleOf: ArrayLike<number>;
  /** Starts the message of a refusal: the body. */
  where: string;
}

export interface BuiltMesh {
  /** x, y, z per written vertex, before the pivot is taken off. */
  positions: Float64Array;
  /** Unit normal per written vertex. */
  normals: Float32Array;
  /** x, y, z, w per written vertex: a unit vector at a right angle to the normal, and w = 1. */
  tangents: Float32Array;
  /** Three written-vertex numbers per kept triangle. */
  indices: Uint32Array;
  /** The input triangle each kept triangle is. */
  sourceTriangle: Uint32Array;
  vertices: number;
  triangles: number;
  degenerateTrianglesDropped: number;
  openEdges: number;
  nonManifoldEdges: number;
}

/**
 * A unit vector at a right angle to a unit normal, the same for the same normal every time.
 *
 * It is the cross product of the normal with the coordinate axis the normal leans on least, so
 * the product always has length: at least 0.81 before it is made unit length.
 *
 * The bodies carry no texture coordinates, so no direction along the surface means more than any
 * other. The tangent is written because engines store one with every normal, and an engine left
 * to make one up can fail to: Godot 4 builds it from a fixed rule that has no length for normals
 * along (1, 1, -1) and its opposite, and then stores a wrong normal for those vertices.
 */
export function tangentFor(nx: number, ny: number, nz: number, out: Float32Array, at: number): void {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  let tx: number;
  let ty: number;
  let tz: number;
  if (ax <= ay && ax <= az) {
    // X axis cross normal.
    tx = 0;
    ty = -nz;
    tz = ny;
  } else if (ay <= az) {
    // Y axis cross normal.
    tx = nz;
    ty = 0;
    tz = -nx;
  } else {
    // Z axis cross normal.
    tx = -ny;
    ty = nx;
    tz = 0;
  }
  const length = Math.hypot(tx, ty, tz);
  out[at] = tx / length + 0;
  out[at + 1] = ty / length + 0;
  out[at + 2] = tz / length + 0;
  out[at + 3] = 1;
}

function tableSize(entries: number): number {
  let size = 16;
  while (size < entries * 2) size *= 2;
  return size;
}

function mix(a: number, b: number, c: number): number {
  return (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77) ^ Math.imul(c, 0xc2b2ae3d)) | 0;
}

/**
 * Welds corners by position. Returns the welded vertex of every corner and the welded positions.
 * Two points weld when they are within `tolerance` of each other; a later point joins the
 * earliest vertex it matches, so the result does not depend on anything but the input order.
 */
function weld(
  points: Float64Array,
  indices: ArrayLike<number> | undefined,
  cornerCount: number,
  tolerance: number,
): { cornerVertex: Uint32Array; welded: Float64Array; count: number } {
  const cornerVertex = new Uint32Array(cornerCount);
  const welded = new Float64Array(cornerCount * 3);
  const sourceVertex = indices === undefined ? undefined : new Int32Array(points.length / 3).fill(-1);
  const size = tableSize(cornerCount);
  const mask = size - 1;
  const head = new Int32Array(size).fill(-1);
  const next = new Int32Array(cornerCount);
  const cell = tolerance > 0 ? tolerance * 2 : 0;
  const toleranceSquared = tolerance * tolerance;
  // With no tolerance, points weld only when exactly equal, so they are hashed by their bits.
  const bits = new Float64Array(3);
  const words = new Int32Array(bits.buffer);
  let count = 0;

  for (let corner = 0; corner < cornerCount; corner += 1) {
    const source = indices === undefined ? corner : indices[corner]!;
    if (sourceVertex !== undefined && sourceVertex[source]! >= 0) {
      cornerVertex[corner] = sourceVertex[source]!;
      continue;
    }
    // `+ 0` makes negative zero equal to zero in the exact-match hash.
    const x = points[source * 3]! + 0;
    const y = points[source * 3 + 1]! + 0;
    const z = points[source * 3 + 2]! + 0;
    let found = -1;
    let ownBucket: number;
    if (cell === 0) {
      bits[0] = x;
      bits[1] = y;
      bits[2] = z;
      ownBucket = mix(words[0]! ^ words[1]!, words[2]! ^ words[3]!, words[4]! ^ words[5]!) & mask;
      for (let v = head[ownBucket]!; v >= 0; v = next[v]!) {
        if (welded[v * 3] === x && welded[v * 3 + 1] === y && welded[v * 3 + 2] === z && (found < 0 || v < found)) found = v;
      }
    } else {
      ownBucket = mix(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)) & mask;
      const x0 = Math.floor((x - tolerance) / cell);
      const x1 = Math.floor((x + tolerance) / cell);
      const y0 = Math.floor((y - tolerance) / cell);
      const y1 = Math.floor((y + tolerance) / cell);
      const z0 = Math.floor((z - tolerance) / cell);
      const z1 = Math.floor((z + tolerance) / cell);
      // Each axis spans one or two cells. Counting steps, not cell numbers, keeps the loops
      // finite for coordinates too large to tell neighbouring cells apart.
      for (let ix = x1 > x0 ? 1 : 0; ix >= 0; ix -= 1) {
        for (let iy = y1 > y0 ? 1 : 0; iy >= 0; iy -= 1) {
          for (let iz = z1 > z0 ? 1 : 0; iz >= 0; iz -= 1) {
            for (let v = head[mix(x0 + ix, y0 + iy, z0 + iz) & mask]!; v >= 0; v = next[v]!) {
              const dx = welded[v * 3]! - x;
              const dy = welded[v * 3 + 1]! - y;
              const dz = welded[v * 3 + 2]! - z;
              if (dx * dx + dy * dy + dz * dz <= toleranceSquared && (found < 0 || v < found)) found = v;
            }
          }
        }
      }
    }
    if (found < 0) {
      found = count;
      count += 1;
      welded[found * 3] = x;
      welded[found * 3 + 1] = y;
      welded[found * 3 + 2] = z;
      next[found] = head[ownBucket]!;
      head[ownBucket] = found;
    }
    cornerVertex[corner] = found;
    if (sourceVertex !== undefined) sourceVertex[source] = found;
  }
  return { cornerVertex, welded, count };
}

/** Edges of a triangle list, each with how many triangles use it and the first two that do. */
function buildEdges(triangleVertex: Uint32Array, triangles: number) {
  const size = tableSize(triangles * 3);
  const mask = size - 1;
  const slot = new Int32Array(size).fill(-1);
  const low = new Uint32Array(triangles * 3);
  const high = new Uint32Array(triangles * 3);
  const uses = new Uint32Array(triangles * 3);
  const first = new Int32Array(triangles * 3);
  const second = new Int32Array(triangles * 3);
  let count = 0;
  for (let t = 0; t < triangles; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const a = triangleVertex[t * 3 + k]!;
      const b = triangleVertex[t * 3 + ((k + 1) % 3)]!;
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      let at = mix(lo, hi, 0) & mask;
      while (slot[at]! >= 0 && (low[slot[at]!] !== lo || high[slot[at]!] !== hi)) at = (at + 1) & mask;
      let edge = slot[at]!;
      if (edge < 0) {
        edge = count;
        count += 1;
        slot[at] = edge;
        low[edge] = lo;
        high[edge] = hi;
        first[edge] = t;
      } else if (uses[edge] === 1) {
        second[edge] = t;
      }
      uses[edge]! += 1;
    }
  }
  return { count, low, high, uses, first, second };
}

function find(parent: Int32Array, item: number): number {
  let root = item;
  while (parent[root] !== root) root = parent[root]!;
  while (parent[item] !== root) {
    const up = parent[item]!;
    parent[item] = root;
    item = up;
  }
  return root;
}

/** Joins two sets. The smaller root number stays the root, which keeps results independent of visiting order. */
function union(parent: Int32Array, a: number, b: number): void {
  const rootA = find(parent, a);
  const rootB = find(parent, b);
  if (rootA < rootB) parent[rootB] = rootA;
  else if (rootB < rootA) parent[rootA] = rootB;
}

function identity(length: number): Int32Array {
  const parent = new Int32Array(length);
  for (let i = 0; i < length; i += 1) parent[i] = i;
  return parent;
}

function cornerOf(triangleVertex: Uint32Array, triangle: number, vertex: number): number {
  const at = triangle * 3;
  return triangleVertex[at] === vertex ? at : triangleVertex[at + 1] === vertex ? at + 1 : at + 2;
}

/**
 * The point of triangle `a`, `b`, `c` of `positions` nearest to (px, py, pz), written to `weights`
 * as the share of each corner: the point is their weighted sum. Returns the distance squared.
 *
 * The point is found by the region of the triangle's plane the projection falls in: nearest a
 * corner, nearest an edge, or inside. A point nearest a corner gets exactly that corner.
 */
function nearestOnTriangle(px: number, py: number, pz: number, positions: Float64Array, a: number, b: number, c: number, weights: Float64Array): number {
  const ax = positions[a * 3]!;
  const ay = positions[a * 3 + 1]!;
  const az = positions[a * 3 + 2]!;
  const abx = positions[b * 3]! - ax;
  const aby = positions[b * 3 + 1]! - ay;
  const abz = positions[b * 3 + 2]! - az;
  const acx = positions[c * 3]! - ax;
  const acy = positions[c * 3 + 1]! - ay;
  const acz = positions[c * 3 + 2]! - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  // How far along each of the two edges from `a` the point lies, seen from each corner in turn.
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let wb: number;
  let wc: number;
  if (d1 <= 0 && d2 <= 0) {
    wb = 0;
    wc = 0;
  } else {
    const bpx = apx - abx;
    const bpy = apy - aby;
    const bpz = apz - abz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = apx - acx;
    const cpy = apy - acy;
    const cpz = apz - acz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) {
      wb = 1;
      wc = 0;
    } else if (d6 >= 0 && d5 <= d6) {
      wb = 0;
      wc = 1;
    } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      wb = d1 / (d1 - d3);
      wc = 0;
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      wb = 0;
      wc = d2 / (d2 - d6);
    } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      wc = (d4 - d3) / (d4 - d3 + (d5 - d6));
      wb = 1 - wc;
    } else {
      const total = va + vb + vc;
      wb = vb / total;
      wc = vc / total;
    }
  }
  weights[0] = 1 - wb - wc;
  weights[1] = wb;
  weights[2] = wc;
  const dx = apx - abx * wb - acx * wc;
  const dy = apy - aby * wb - acy * wc;
  const dz = apz - abz * wb - acz * wc;
  return dx * dx + dy * dy + dz * dz;
}

function distanceSquared(positions: Float64Array, a: number, b: number): number {
  return (positions[b * 3]! - positions[a * 3]!) ** 2 + (positions[b * 3 + 1]! - positions[a * 3 + 1]!) ** 2 + (positions[b * 3 + 2]! - positions[a * 3 + 2]!) ** 2;
}

/** For each written vertex of a built mesh, the triangles that use it: those of vertex `v` are `list[start[v]]` up to `list[start[v + 1]]`. */
interface Fans {
  start: Uint32Array;
  list: Uint32Array;
}

function fansOf(mesh: BuiltMesh): Fans {
  const start = new Uint32Array(mesh.vertices + 1);
  for (let corner = 0; corner < mesh.indices.length; corner += 1) start[mesh.indices[corner]! + 1]! += 1;
  for (let vertex = 0; vertex < mesh.vertices; vertex += 1) start[vertex + 1]! += start[vertex]!;
  const next = start.slice(0, mesh.vertices);
  const list = new Uint32Array(mesh.indices.length);
  for (let corner = 0; corner < mesh.indices.length; corner += 1) {
    const vertex = mesh.indices[corner]!;
    list[next[vertex]!] = Math.floor(corner / 3);
    next[vertex]! += 1;
  }
  return { start, list };
}

/**
 * Finds the triangle of a built mesh that the point (px, py, pz) lies in, starting from
 * `triangle` and walking across soft edges for as long as that comes nearer to the point. A
 * triangle of a finer mesh that lies on a flat part of the surface may reach across several of
 * the surface's triangles, so its corners are not all in the one it names.
 *
 * Returns the triangle, with the point's shares of its corners in `weights` and the distance
 * squared in `found[0]`. Every step is strictly nearer, so the walk ends.
 */
function locate(mesh: BuiltMesh, fans: Fans, triangle: number, px: number, py: number, pz: number, near: number, weights: Float64Array, trial: Float64Array, found: Float64Array): number {
  const { indices, positions } = mesh;
  let current = triangle;
  let best = nearestOnTriangle(px, py, pz, positions, indices[current * 3]!, indices[current * 3 + 1]!, indices[current * 3 + 2]!, weights);
  while (best > near) {
    // The nearest point of the triangle is on the corners that have a share in it: on one corner,
    // on the edge between two, or inside. Inside, no neighbour is nearer.
    let first = -1;
    let second = -1;
    let onCorners = 0;
    for (let k = 0; k < 3; k += 1) {
      if (!(weights[k]! > 0)) continue;
      onCorners += 1;
      if (first < 0) first = indices[current * 3 + k]!;
      else second = indices[current * 3 + k]!;
    }
    if (onCorners === 3) break;
    // The triangles across that edge, or round that corner. They share written vertices with
    // this one, so the surface is shaded smoothly from here to there.
    let nearer = -1;
    for (let at = fans.start[first]!; at < fans.start[first + 1]!; at += 1) {
      const other = fans.list[at]!;
      if (other === current) continue;
      const a = indices[other * 3]!;
      const b = indices[other * 3 + 1]!;
      const c = indices[other * 3 + 2]!;
      if (onCorners === 2 && a !== second && b !== second && c !== second) continue;
      const distance = nearestOnTriangle(px, py, pz, positions, a, b, c, trial);
      if (distance < best) {
        best = distance;
        nearer = other;
        weights.set(trial);
      }
    }
    if (nearer < 0) break;
    current = nearer;
  }
  found[0] = best;
  return current;
}

/**
 * The vertices of a surface's triangle that a point of it lies on, lowest first, with -1 where
 * fewer than three: one for a point on a corner, two for a point on an edge, three for a point
 * inside. On means within the weld tolerance, the distance at which two points are one: a cut
 * leaves its points a rounding error off the edge they lie on, and the triangles on both sides
 * of that edge must find the same vertices for them.
 */
function onVertices(positions: Float64Array, a: number, b: number, c: number, weights: Float64Array, tolerance: number, into: Int32Array, at: number): void {
  const corners = [a, b, c];
  let keep = [true, true, true];
  // The point, from its shares in the three corners.
  let qx = 0;
  let qy = 0;
  let qz = 0;
  for (let k = 0; k < 3; k += 1) {
    qx += positions[corners[k]! * 3]! * weights[k]!;
    qy += positions[corners[k]! * 3 + 1]! * weights[k]!;
    qz += positions[corners[k]! * 3 + 2]! * weights[k]!;
  }
  let nearest = 0;
  let nearestSquared = Infinity;
  for (let k = 0; k < 3; k += 1) {
    const from = corners[k]! * 3;
    const squared = (positions[from]! - qx) ** 2 + (positions[from + 1]! - qy) ** 2 + (positions[from + 2]! - qz) ** 2;
    if (squared < nearestSquared) {
      nearestSquared = squared;
      nearest = k;
    }
  }
  if (nearestSquared <= tolerance * tolerance) {
    keep = [nearest === 0, nearest === 1, nearest === 2];
  } else {
    // A corner has no share in a point on the edge opposite it: the point's distance from that
    // edge is the corner's share times the corner's own distance from it.
    const ux = positions[b * 3]! - positions[a * 3]!;
    const uy = positions[b * 3 + 1]! - positions[a * 3 + 1]!;
    const uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
    const vx = positions[c * 3]! - positions[a * 3]!;
    const vy = positions[c * 3 + 1]! - positions[a * 3 + 1]!;
    const vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
    const doubleArea = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    let heaviest = 0;
    for (let k = 0; k < 3; k += 1) {
      const opposite = Math.sqrt(distanceSquared(positions, corners[(k + 1) % 3]!, corners[(k + 2) % 3]!));
      const height = opposite > 0 ? doubleArea / opposite : 0;
      keep[k] = weights[k]! * height > tolerance;
      if (weights[k]! > weights[heaviest]!) heaviest = k;
    }
    if (!keep[0] && !keep[1] && !keep[2]) keep[heaviest] = true;
  }
  let filled = 0;
  for (const vertex of [a, b, c].sort((left, right) => left - right)) {
    const k = vertex === a ? 0 : vertex === b ? 1 : 2;
    if (keep[k]) {
      into[at + filled] = vertex;
      filled += 1;
    }
  }
  for (; filled < 3; filled += 1) into[at + filled] = -1;
}

/**
 * Welds, drops degenerate triangles, counts open and non-manifold edges, splits vertices along
 * hard edges and computes vertex normals. Positions are already in glTF space.
 *
 * With `coarse` the mesh is a finer cut of surfaces that were built before, and its shading is
 * theirs. Every corner of every triangle is found on its surface: the surface's triangle it lies
 * in, and its share of each of that triangle's written vertices. A corner takes the normal the
 * surface has there, which is the normals of those vertices mixed by their shares. Two corners at
 * one point become one written vertex where they are found on the same written vertices of the
 * surface, which is where the surface is shaded smoothly, and stay two where they are not, which
 * is along the surface's hard edges and between two surfaces. Face ids, the crease angle and the
 * normal mode then act on the surfaces only.
 */
export function buildMesh(
  points: Float64Array,
  indices: ArrayLike<number> | undefined,
  faceIds: ArrayLike<number> | undefined,
  options: MeshOptions,
  coarse?: CoarseSurfaces,
): BuiltMesh {
  const cornerCount = indices === undefined ? points.length / 3 : indices.length;
  const inputTriangles = cornerCount / 3;
  const { cornerVertex, welded } = weld(points, indices, cornerCount, options.weldTolerance);

  // Keep the triangles that have an area, with their unit normal and area.
  const triangleVertex = new Uint32Array(cornerCount);
  const faceNormal = new Float64Array(cornerCount);
  const area = new Float64Array(inputTriangles);
  const face = faceIds === undefined ? undefined : new Float64Array(inputTriangles);
  const sourceTriangle = new Uint32Array(inputTriangles);
  let triangles = 0;
  for (let t = 0; t < inputTriangles; t += 1) {
    const a = cornerVertex[t * 3]!;
    const b = cornerVertex[t * 3 + (options.reverseWinding ? 2 : 1)]!;
    const c = cornerVertex[t * 3 + (options.reverseWinding ? 1 : 2)]!;
    if (a === b || b === c || a === c) continue;
    const ux = welded[b * 3]! - welded[a * 3]!;
    const uy = welded[b * 3 + 1]! - welded[a * 3 + 1]!;
    const uz = welded[b * 3 + 2]! - welded[a * 3 + 2]!;
    const vx = welded[c * 3]! - welded[a * 3]!;
    const vy = welded[c * 3 + 1]! - welded[a * 3 + 1]!;
    const vz = welded[c * 3 + 2]! - welded[a * 3 + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const doubleArea = Math.hypot(nx, ny, nz);
    const longest = Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, (vx - ux) ** 2 + (vy - uy) ** 2 + (vz - uz) ** 2);
    if (!(doubleArea > DEGENERATE_AREA_RATIO * longest)) continue;
    triangleVertex[triangles * 3] = a;
    triangleVertex[triangles * 3 + 1] = b;
    triangleVertex[triangles * 3 + 2] = c;
    faceNormal[triangles * 3] = nx / doubleArea;
    faceNormal[triangles * 3 + 1] = ny / doubleArea;
    faceNormal[triangles * 3 + 2] = nz / doubleArea;
    area[triangles] = doubleArea / 2;
    if (face !== undefined) face[triangles] = faceIds![t]!;
    sourceTriangle[triangles] = t;
    triangles += 1;
  }

  // Where each corner of each kept triangle lies on its surface: the written vertices of the
  // surface that have a share in it, lowest first, with -1 where fewer than three have.
  const weights = new Float64Array(3);
  let coarseSurface: Int32Array | undefined;
  let cornerTriangle: Int32Array | undefined;
  let cornerOn: Int32Array | undefined;
  if (coarse !== undefined) {
    coarseSurface = new Int32Array(triangles);
    cornerTriangle = new Int32Array(triangles * 3);
    cornerOn = new Int32Array(triangles * 9);
    const fans: (Fans | undefined)[] = coarse.meshes.map(() => undefined);
    const trial = new Float64Array(3);
    const found = new Float64Array(1);
    const near = options.weldTolerance ** 2;
    for (let t = 0; t < triangles; t += 1) {
      const input = sourceTriangle[t]!;
      const surface = coarse.surfaceOf === undefined ? 0 : coarse.surfaceOf[input]!;
      const named = coarse.triangleOf[input]!;
      const within = `${coarse.where}: triangle ${input} is said to lie in triangle ${named}${coarse.meshes.length > 1 ? ` of surface ${surface}` : ""} of the mesh it refines`;
      const kept = coarse.keptOf[surface]![named]!;
      if (kept < 0) refuse("BAD_REFINEMENT", `${within}, but that triangle has no area.`);
      const mesh = coarse.meshes[surface]!;
      const fan = (fans[surface] ??= fansOf(mesh));
      coarseSurface[t] = surface;
      for (let k = 0; k < 3; k += 1) {
        const corner = t * 3 + k;
        const at = triangleVertex[corner]! * 3;
        const here = locate(mesh, fan, kept, welded[at]!, welded[at + 1]!, welded[at + 2]!, near, weights, trial, found);
        const a = mesh.indices[here * 3]!;
        const b = mesh.indices[here * 3 + 1]!;
        const c = mesh.indices[here * 3 + 2]!;
        const longest = Math.max(distanceSquared(mesh.positions, a, b), distanceSquared(mesh.positions, b, c), distanceSquared(mesh.positions, c, a));
        const reach = Math.max(2 * options.weldTolerance, REFINEMENT_REACH * Math.sqrt(longest));
        const away = Math.sqrt(found[0]!);
        if (!(away <= reach)) {
          refuse(
            "BAD_REFINEMENT",
            `${within}, but one of its corners is ${away.toPrecision(3)} m away from the mesh there. A corner may be ${reach.toPrecision(3)} m away at most.`,
          );
        }
        cornerTriangle[corner] = here;
        onVertices(mesh.positions, a, b, c, weights, options.weldTolerance, cornerOn, corner * 3);
      }
    }
  }

  const edges = buildEdges(triangleVertex, triangles);
  const creaseCos = Math.cos((options.creaseAngle * Math.PI) / 180);
  const flatCos = Math.cos((FLAT_FACE_ANGLE_DEGREES * Math.PI) / 180);
  // A mesh that takes its shading from coarser surfaces has no use for faces of its own.
  const faceWeighted = options.normals === "face-weighted" && coarse === undefined;

  // Corners joined across soft edges share one written vertex.
  const cornerGroup = identity(triangles * 3);
  // Without face ids, the flat faces are found by joining triangles that lie in one plane.
  const flatGroup = faceWeighted && face === undefined ? identity(triangles) : undefined;
  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (let edge = 0; edge < edges.count; edge += 1) {
    const uses = edges.uses[edge]!;
    if (uses === 1) openEdges += 1;
    if (uses > 2) nonManifoldEdges += 1;
    if (uses !== 2) continue;
    const t1 = edges.first[edge]!;
    const t2 = edges.second[edge]!;
    const dot =
      faceNormal[t1 * 3]! * faceNormal[t2 * 3]! +
      faceNormal[t1 * 3 + 1]! * faceNormal[t2 * 3 + 1]! +
      faceNormal[t1 * 3 + 2]! * faceNormal[t2 * 3 + 2]!;
    if (flatGroup !== undefined && dot >= flatCos) union(flatGroup, t1, t2);
    const lo = edges.low[edge]!;
    const hi = edges.high[edge]!;
    if (coarseSurface !== undefined) {
      // At each end of the edge by itself: the two corners are one vertex where the surface is.
      if (coarseSurface[t1] !== coarseSurface[t2]) continue;
      for (const end of [lo, hi]) {
        const one = cornerOf(triangleVertex, t1, end);
        const other = cornerOf(triangleVertex, t2, end);
        if (cornerOn![one * 3] === cornerOn![other * 3] && cornerOn![one * 3 + 1] === cornerOn![other * 3 + 1] && cornerOn![one * 3 + 2] === cornerOn![other * 3 + 2]) {
          union(cornerGroup, one, other);
        }
      }
      continue;
    }
    const soft = (face !== undefined && face[t1] === face[t2]) || dot >= creaseCos;
    if (!soft) continue;
    union(cornerGroup, cornerOf(triangleVertex, t1, lo), cornerOf(triangleVertex, t2, lo));
    union(cornerGroup, cornerOf(triangleVertex, t1, hi), cornerOf(triangleVertex, t2, hi));
  }

  // Area of the whole face each triangle belongs to, for face-weighted normals.
  let faceArea: Float64Array | undefined;
  if (faceWeighted) {
    faceArea = new Float64Array(triangles);
    if (face !== undefined) {
      const areaOfFace = new Map<number, number>();
      for (let t = 0; t < triangles; t += 1) areaOfFace.set(face[t]!, (areaOfFace.get(face[t]!) ?? 0) + area[t]!);
      for (let t = 0; t < triangles; t += 1) faceArea[t] = areaOfFace.get(face[t]!)!;
    } else {
      const areaOfRoot = new Float64Array(triangles);
      for (let t = 0; t < triangles; t += 1) areaOfRoot[find(flatGroup!, t)]! += area[t]!;
      for (let t = 0; t < triangles; t += 1) faceArea[t] = areaOfRoot[find(flatGroup!, t)]!;
    }
  }

  // Number the written vertices in the order corners first reach them, and sum weighted normals.
  const vertexOfGroup = new Int32Array(triangles * 3).fill(-1);
  const outIndices = new Uint32Array(triangles * 3);
  const weldedOfVertex = new Uint32Array(triangles * 3);
  const firstTriangle = new Uint32Array(triangles * 3);
  const firstCorner = new Uint32Array(triangles * 3);
  const sum = new Float64Array(triangles * 9);
  let vertices = 0;
  for (let t = 0; t < triangles; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const corner = t * 3 + k;
      const group = find(cornerGroup, corner);
      let vertex = vertexOfGroup[group]!;
      const at = triangleVertex[corner]!;
      if (vertex < 0) {
        vertex = vertices;
        vertices += 1;
        vertexOfGroup[group] = vertex;
        weldedOfVertex[vertex] = at;
        firstTriangle[vertex] = t;
        firstCorner[vertex] = corner;
      }
      outIndices[corner] = vertex;
      const to = triangleVertex[t * 3 + ((k + 1) % 3)]!;
      const from = triangleVertex[t * 3 + ((k + 2) % 3)]!;
      const ux = welded[to * 3]! - welded[at * 3]!;
      const uy = welded[to * 3 + 1]! - welded[at * 3 + 1]!;
      const uz = welded[to * 3 + 2]! - welded[at * 3 + 2]!;
      const vx = welded[from * 3]! - welded[at * 3]!;
      const vy = welded[from * 3 + 1]! - welded[at * 3 + 1]!;
      const vz = welded[from * 3 + 2]! - welded[at * 3 + 2]!;
      const angle = Math.atan2(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx), ux * vx + uy * vy + uz * vz);
      const weight = angle * (faceArea === undefined ? area[t]! : faceArea[t]!);
      sum[vertex * 3]! += faceNormal[t * 3]! * weight;
      sum[vertex * 3 + 1]! += faceNormal[t * 3 + 1]! * weight;
      sum[vertex * 3 + 2]! += faceNormal[t * 3 + 2]! * weight;
    }
  }

  const positions = new Float64Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const tangents = new Float32Array(vertices * 4);
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const at = weldedOfVertex[vertex]! * 3;
    positions[vertex * 3] = welded[at]!;
    positions[vertex * 3 + 1] = welded[at + 1]!;
    positions[vertex * 3 + 2] = welded[at + 2]!;
    let nx = sum[vertex * 3]!;
    let ny = sum[vertex * 3 + 1]!;
    let nz = sum[vertex * 3 + 2]!;
    if (coarseSurface !== undefined) {
      // The normal the surface has here. Every corner joined into this vertex is on the same
      // written vertices of the surface, so the first is asked.
      const corner = firstCorner[vertex]!;
      const mesh = coarse!.meshes[coarseSurface[firstTriangle[vertex]!]!]!;
      const on = cornerOn!.subarray(corner * 3, corner * 3 + 3);
      if (on[1]! < 0) {
        // On a vertex of the surface the normal is that vertex's, number for number.
        const from = on[0]!;
        normals[vertex * 3] = mesh.normals[from * 3]!;
        normals[vertex * 3 + 1] = mesh.normals[from * 3 + 1]!;
        normals[vertex * 3 + 2] = mesh.normals[from * 3 + 2]!;
        tangents.set(mesh.tangents.subarray(from * 4, from * 4 + 4), vertex * 4);
        continue;
      }
      const here = cornerTriangle![corner]!;
      const a = mesh.indices[here * 3]!;
      const b = mesh.indices[here * 3 + 1]!;
      const c = mesh.indices[here * 3 + 2]!;
      nearestOnTriangle(welded[at]!, welded[at + 1]!, welded[at + 2]!, mesh.positions, a, b, c, weights);
      nx = 0;
      ny = 0;
      nz = 0;
      for (let k = 0; k < 3; k += 1) {
        const from = k === 0 ? a : k === 1 ? b : c;
        if (from !== on[0] && from !== on[1] && from !== on[2]) continue;
        nx += mesh.normals[from * 3]! * weights[k]!;
        ny += mesh.normals[from * 3 + 1]! * weights[k]!;
        nz += mesh.normals[from * 3 + 2]! * weights[k]!;
      }
    }
    let length = Math.hypot(nx, ny, nz);
    if (!(length > 0)) {
      // Faces that cancel out leave no direction; fall back to the first triangle's own normal.
      const t = firstTriangle[vertex]! * 3;
      nx = faceNormal[t]!;
      ny = faceNormal[t + 1]!;
      nz = faceNormal[t + 2]!;
      length = 1;
    }
    normals[vertex * 3] = nx / length;
    normals[vertex * 3 + 1] = ny / length;
    normals[vertex * 3 + 2] = nz / length;
    tangentFor(nx / length, ny / length, nz / length, tangents, vertex * 4);
  }

  return {
    positions,
    normals,
    tangents,
    indices: outIndices,
    sourceTriangle: sourceTriangle.subarray(0, triangles),
    vertices,
    triangles,
    degenerateTrianglesDropped: inputTriangles - triangles,
    openEdges,
    nonManifoldEdges,
  };
}

/** The triangles of a mesh that go into one primitive, with vertices of their own. */
export interface MeshPart {
  /** The group every triangle of this part is in. */
  group: number;
  /** The mesh's written vertex behind each vertex of the part. Undefined when the part is the whole mesh. */
  vertexOf: Uint32Array | undefined;
  /** Three part-vertex numbers per triangle. */
  indices: Uint32Array;
  vertices: number;
  triangles: number;
}

/**
 * Divides a built mesh into one part per group of triangles. `groupOfTriangle` names the group
 * of every input triangle; without it the whole mesh is one part in `onlyGroup`.
 *
 * Parts come in the order their first kept triangle comes. Inside a part the triangles keep
 * their order and the vertices are numbered as the triangles first reach them, which is how the
 * mesh itself is numbered, so a mesh in one group is one part that is the mesh unchanged.
 *
 * Normals were worked out on the whole mesh before this, so a vertex on the border between two
 * parts goes into both with the same position, normal and tangent.
 */
export function splitMesh(mesh: BuiltMesh, groupOfTriangle: ArrayLike<number> | undefined, onlyGroup: number): MeshPart[] {
  const { triangles, indices, sourceTriangle } = mesh;
  const partOfGroup = new Map<number, number>();
  const partOfTriangle = new Uint32Array(triangles);
  const groups: number[] = [];
  const counts: number[] = [];
  if (groupOfTriangle !== undefined) {
    for (let t = 0; t < triangles; t += 1) {
      const group = groupOfTriangle[sourceTriangle[t]!]!;
      let part = partOfGroup.get(group);
      if (part === undefined) {
        part = groups.length;
        partOfGroup.set(group, part);
        groups.push(group);
        counts.push(0);
      }
      partOfTriangle[t] = part;
      counts[part]! += 1;
    }
  }
  if (groups.length <= 1) return [{ group: groups[0] ?? onlyGroup, vertexOf: undefined, indices, vertices: mesh.vertices, triangles }];

  // The triangles of each part, in order: a counting sort by part.
  const start = new Uint32Array(groups.length + 1);
  for (let part = 0; part < groups.length; part += 1) start[part + 1] = start[part]! + counts[part]!;
  const next = start.slice(0, groups.length);
  const order = new Uint32Array(triangles);
  for (let t = 0; t < triangles; t += 1) {
    const part = partOfTriangle[t]!;
    order[next[part]!] = t;
    next[part]! += 1;
  }

  // `seenBy[vertex]` is the last part that took the vertex, and `numberIn[vertex]` its number there.
  const seenBy = new Int32Array(mesh.vertices).fill(-1);
  const numberIn = new Uint32Array(mesh.vertices);
  return groups.map((group, part) => {
    const count = counts[part]!;
    const partIndices = new Uint32Array(count * 3);
    const vertexOf = new Uint32Array(Math.min(mesh.vertices, count * 3));
    let vertices = 0;
    for (let at = 0; at < count; at += 1) {
      const t = order[start[part]! + at]!;
      for (let k = 0; k < 3; k += 1) {
        const vertex = indices[t * 3 + k]!;
        if (seenBy[vertex] !== part) {
          seenBy[vertex] = part;
          numberIn[vertex] = vertices;
          vertexOf[vertices] = vertex;
          vertices += 1;
        }
        partIndices[at * 3 + k] = numberIn[vertex]!;
      }
    }
    return { group, vertexOf: vertexOf.subarray(0, vertices), indices: partIndices, vertices, triangles: count };
  });
}
