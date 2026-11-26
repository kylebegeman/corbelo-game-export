// Shapes built in code for the tests. Every shape is triangle soup wound so its faces point
// outwards, with one face id per triangle naming the exact face it came from.

export type Point = [number, number, number];

export interface Shape {
  positions: Float32Array;
  faceIds: Uint32Array;
}

function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Point, b: Point): Point {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

class ShapeBuilder {
  private readonly numbers: number[] = [];
  private readonly ids: number[] = [];
  private nextFace = 0;

  triangle(a: Point, b: Point, c: Point, face: number): void {
    this.numbers.push(...a, ...b, ...c);
    this.ids.push(face);
  }

  /** Starts a new exact face and returns its id. */
  face(): number {
    this.nextFace += 1;
    return this.nextFace - 1;
  }

  /**
   * Adds a flat convex polygon as a fan of triangles in one new face. The corners may come in
   * any order; they are sorted around the middle and wound to face away from `inside`.
   */
  polygon(corners: Point[], inside: Point): void {
    const middle: Point = [0, 1, 2].map((axis) => corners.reduce((sum, corner) => sum + corner[axis]!, 0) / corners.length) as Point;
    const outward = sub(middle, inside);
    const first = sub(corners[0]!, middle);
    let normal: Point = [0, 0, 0];
    for (const corner of corners.slice(1)) {
      const candidate = cross(first, sub(corner, middle));
      if (Math.hypot(...candidate) > Math.hypot(...normal)) normal = candidate;
    }
    if (dot(normal, outward) < 0) normal = [-normal[0], -normal[1], -normal[2]];
    const side = cross(normal, first);
    const sorted = [...corners].sort((a, b) => {
      const angle = (corner: Point) => Math.atan2(dot(sub(corner, middle), side), dot(sub(corner, middle), first));
      return angle(a) - angle(b);
    });
    const face = this.face();
    for (let i = 1; i + 1 < sorted.length; i += 1) this.triangle(sorted[0]!, sorted[i]!, sorted[i + 1]!, face);
  }

  build(): Shape {
    return { positions: Float32Array.from(this.numbers), faceIds: Uint32Array.from(this.ids) };
  }
}

const SIGNS = [-1, 1] as const;

/** A box from `min` to `max`: 12 triangles, 6 faces. */
export function box(min: Point, max: Point): Shape {
  const shape = new ShapeBuilder();
  const inside: Point = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const pick = (sx: number, sy: number, sz: number): Point => [sx < 0 ? min[0] : max[0], sy < 0 ? min[1] : max[1], sz < 0 ? min[2] : max[2]];
  for (const s of SIGNS) {
    shape.polygon(SIGNS.flatMap((a) => SIGNS.map((b) => pick(s, a, b))), inside);
    shape.polygon(SIGNS.flatMap((a) => SIGNS.map((b) => pick(a, s, b))), inside);
    shape.polygon(SIGNS.flatMap((a) => SIGNS.map((b) => pick(a, b, s))), inside);
  }
  return shape.build();
}

/**
 * A block from the origin to `size` with every edge chamfered at 45 degrees: 6 main faces,
 * 12 chamfer strips and 8 corner triangles. 44 triangles on 24 distinct points.
 */
export function chamferedBlock(size: Point, chamfer: number): Shape {
  const shape = new ShapeBuilder();
  const half: Point = [size[0] / 2, size[1] / 2, size[2] / 2];
  // The point near corner `signs` that lies on the main face across `axis`.
  const point = (signs: Point, axis: number): Point =>
    [0, 1, 2].map((a) => half[a]! + signs[a]! * (a === axis ? half[a]! : half[a]! - chamfer)) as Point;
  const corner = (axis: number, own: number, b: number, c: number): Point => {
    const signs: Point = [0, 0, 0];
    signs[axis] = own;
    signs[(axis + 1) % 3] = b;
    signs[(axis + 2) % 3] = c;
    return signs;
  };
  for (let axis = 0; axis < 3; axis += 1) {
    // Main faces.
    for (const s of SIGNS) shape.polygon(SIGNS.flatMap((b) => SIGNS.map((c) => point(corner(axis, s, b, c), axis))), half);
    // Chamfer strips along the edges parallel to this axis.
    for (const b of SIGNS) {
      for (const c of SIGNS) {
        shape.polygon(SIGNS.flatMap((s) => [point(corner(axis, s, b, c), (axis + 1) % 3), point(corner(axis, s, b, c), (axis + 2) % 3)]), half);
      }
    }
  }
  for (const x of SIGNS) for (const y of SIGNS) for (const z of SIGNS) shape.polygon([0, 1, 2].map((axis) => point([x, y, z], axis)), half);
  return shape.build();
}

/**
 * A cylinder standing on z = 0 along +Z. Face 0 is the side, face 1 the top, face 2 the
 * bottom. 4 x segments triangles.
 */
export function cylinder(radius: number, height: number, segments: number): Shape {
  const shape = new ShapeBuilder();
  const [side, top, bottom] = [shape.face(), shape.face(), shape.face()];
  const ring = (i: number, z: number): Point => {
    const angle = ((i % segments) / segments) * Math.PI * 2;
    return [radius * Math.cos(angle), radius * Math.sin(angle), z];
  };
  for (let i = 0; i < segments; i += 1) {
    shape.triangle(ring(i, 0), ring(i + 1, 0), ring(i + 1, height), side);
    shape.triangle(ring(i, 0), ring(i + 1, height), ring(i, height), side);
    shape.triangle([0, 0, height], ring(i, height), ring(i + 1, height), top);
    shape.triangle([0, 0, 0], ring(i + 1, 0), ring(i, 0), bottom);
  }
  return shape.build();
}

/**
 * Face colours for `cylinder(radius, height, segments)`: `color` on the side for the first half
 * of the way round, and nothing, so the body's own colour, on the other half and on both ends.
 * The two colours meet along two straight lines down the smooth side.
 */
export function halfPaintedSide(segments: number, color: string): (string | null)[] {
  // The cylinder's triangles come four to a segment: two of the side, one of the top, one of the bottom.
  return Array.from({ length: segments * 4 }, (_, triangle) => (triangle % 4 < 2 && Math.floor(triangle / 4) < segments / 2 ? color : null));
}

/**
 * Face colours for `box(min, max)`: `color` on the two triangles of the face at the high end of
 * the third axis, which is the top of a Z-up box, and nothing on the other five faces.
 */
export function paintedTop(color: string): (string | null)[] {
  return Array.from({ length: 12 }, (_, triangle) => (triangle >= 10 ? color : null));
}

/** A shape that is a finer cut of another: its triangles, and the triangle of the other each lies in. */
export interface CutShape extends Shape {
  triangleOf: Uint32Array;
}

/** The point a quarter of the way along an edge, the same whichever end the edge is named from. */
function quarter(p: Point, q: Point): Point {
  const swap = p[0] !== q[0] ? p[0] > q[0] : p[1] !== q[1] ? p[1] > q[1] : p[2] > q[2];
  const [from, to] = swap ? [q, p] : [p, q];
  return [from[0] + (to[0] - from[0]) / 4, from[1] + (to[1] - from[1]) / 4, from[2] + (to[2] - from[2]) / 4];
}

function corners(shape: Shape, triangle: number): [Point, Point, Point] {
  return [0, 1, 2].map((k) => [...shape.positions.subarray(triangle * 9 + k * 3, triangle * 9 + k * 3 + 3)] as Point) as [Point, Point, Point];
}

/**
 * `cylinder(radius, height, segments)` cut finer without moving its surface, as paint cuts a
 * body: no point leaves the flat triangle it was cut into. Every triangle of the side becomes
 * six, around a new point at its middle and a new point a quarter of the way along each of its
 * edges. Every triangle of an end becomes two, at the new point on the rim. The result is closed.
 * 16 x segments triangles, in the order of the triangles they were cut from.
 *
 * None of the new points of the side lies where a flat side's own direction is also the
 * direction straight out from the axis, so shading them along the flat side shows.
 */
export function cutCylinder(radius: number, height: number, segments: number): CutShape {
  const coarse = cylinder(radius, height, segments);
  const numbers: number[] = [];
  const ids: number[] = [];
  const of: number[] = [];
  const add = (a: Point, b: Point, c: Point, triangle: number) => {
    numbers.push(...a, ...b, ...c);
    ids.push(coarse.faceIds[triangle]!);
    of.push(triangle);
  };
  for (let triangle = 0; triangle < coarse.faceIds.length; triangle += 1) {
    const [a, b, c] = corners(coarse, triangle);
    if (triangle % 4 < 2) {
      const middle: Point = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      const around = [a, quarter(a, b), b, quarter(b, c), c, quarter(c, a)];
      for (let k = 0; k < 6; k += 1) add(around[k]!, around[(k + 1) % 6]!, middle, triangle);
    } else {
      // An end: `a` is the centre and the edge from `b` to `c` runs along the rim.
      add(a, b, quarter(b, c), triangle);
      add(a, quarter(b, c), c, triangle);
    }
  }
  return { positions: Float32Array.from(numbers), faceIds: Uint32Array.from(ids), triangleOf: Uint32Array.from(of) };
}

/**
 * Face colours for `cutCylinder(radius, height, segments)`: `color` on half of the six triangles
 * of every side triangle for the first half of the way round, and nothing elsewhere. The two
 * colours meet along edges of the cylinder's own triangles and along edges inside them.
 */
export function paintedPatch(segments: number, color: string): (string | null)[] {
  return Array.from({ length: segments * 16 }, (_, triangle) => (triangle % 16 < 12 && triangle % 6 < 3 && Math.floor(triangle / 16) < segments / 2 ? color : null));
}

/**
 * `cylinder(radius, height, segments)` with the same points and other triangles, as a cut leaves
 * a flat part of a body: each flat side is divided along its other diagonal, and each end is a
 * fan from one point of its rim, with no point at its middle. No triangle of it lies in one
 * triangle of the cylinder: each reaches across two or more of them, and names one it touches.
 * 4 x segments - 4 triangles.
 */
export function cylinderCutAcross(radius: number, height: number, segments: number): CutShape {
  const coarse = cylinder(radius, height, segments);
  const numbers: number[] = [];
  const ids: number[] = [];
  const of: number[] = [];
  const add = (a: Point, b: Point, c: Point, triangle: number) => {
    numbers.push(...a, ...b, ...c);
    ids.push(coarse.faceIds[triangle]!);
    of.push(triangle);
  };
  const [topStart] = corners(coarse, 2).slice(1) as [Point];
  const [, bottomStart] = corners(coarse, 3).slice(1) as [Point, Point];
  for (let segment = 0; segment < segments; segment += 1) {
    // The side's two triangles are (low, next low, next high) and (low, next high, high).
    const [low, nextLow, nextHigh] = corners(coarse, segment * 4);
    const high = corners(coarse, segment * 4 + 1)[2];
    add(low, nextLow, high, segment * 4);
    add(nextLow, nextHigh, high, segment * 4 + 1);
    if (segment === 0 || segment === segments - 1) continue;
    const [, topFrom, topTo] = corners(coarse, segment * 4 + 2);
    add(topStart, topFrom, topTo, segment * 4 + 2);
    const [, bottomFrom, bottomTo] = corners(coarse, segment * 4 + 3);
    add(bottomStart, bottomFrom, bottomTo, segment * 4 + 3);
  }
  return { positions: Float32Array.from(numbers), faceIds: Uint32Array.from(ids), triangleOf: Uint32Array.from(of) };
}

/** Any shape with each triangle cut in three around a new point at its middle. */
export function cutAtMiddles(shape: Shape): CutShape {
  const numbers: number[] = [];
  const ids: number[] = [];
  const of: number[] = [];
  for (let triangle = 0; triangle < shape.faceIds.length; triangle += 1) {
    const [a, b, c] = corners(shape, triangle);
    const middle: Point = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      numbers.push(...p, ...q, ...middle);
      ids.push(shape.faceIds[triangle]!);
      of.push(triangle);
    }
  }
  return { positions: Float32Array.from(numbers), faceIds: Uint32Array.from(ids), triangleOf: Uint32Array.from(of) };
}

/** A shape with every triangle turned to face the other way: what cuts a hole, seen from inside the hole. */
export function turned(shape: Shape): Shape {
  const positions = Float32Array.from(shape.positions);
  for (let at = 0; at < positions.length; at += 9) {
    for (let axis = 0; axis < 3; axis += 1) {
      positions[at + 3 + axis] = shape.positions[at + 6 + axis]!;
      positions[at + 6 + axis] = shape.positions[at + 3 + axis]!;
    }
  }
  return { positions, faceIds: shape.faceIds };
}

/**
 * A tube: `cylinder(outer, height, segments)` with `cylinder(inner, height, segments)` taken out
 * of its middle. Every triangle lies in a triangle of one of the two: `surfaceOf` says which, 0
 * for the outer cylinder and 1 for `turned` of the inner one, and `triangleOf` which triangle.
 * 8 x segments triangles.
 */
export function tube(outer: number, inner: number, height: number, segments: number): CutShape & { surfaceOf: Uint32Array } {
  const body = cylinder(outer, height, segments);
  const hole = turned(cylinder(inner, height, segments));
  const numbers: number[] = [];
  const ids: number[] = [];
  const of: number[] = [];
  const surfaces: number[] = [];
  const add = (points: Point[], face: number, surface: number, triangle: number) => {
    numbers.push(...points.flat());
    ids.push(face);
    surfaces.push(surface);
    of.push(triangle);
  };
  for (let triangle = 0; triangle < body.faceIds.length; triangle += 1) {
    if (triangle % 4 < 2) {
      // The outer side as it is, and the wall of the hole as the turned inner side is.
      add(corners(body, triangle), 0, 0, triangle);
      add(corners(hole, triangle), 3, 1, triangle);
    } else {
      // An end: the part of the outer cylinder's triangle that is outside the hole. The inner
      // cylinder has the same triangle, smaller, with its rim corners in the other order.
      const [, b, c] = corners(body, triangle);
      const [, innerC, innerB] = corners(hole, triangle);
      add([innerB, b, c], body.faceIds[triangle]!, 0, triangle);
      add([innerB, c, innerC], body.faceIds[triangle]!, 0, triangle);
    }
  }
  return { positions: Float32Array.from(numbers), faceIds: Uint32Array.from(ids), triangleOf: Uint32Array.from(of), surfaceOf: Uint32Array.from(surfaces) };
}

/** Two triangles sharing an edge along X, folded so their normals are `degrees` apart. */
export function fold(degrees: number): Shape {
  const shape = new ShapeBuilder();
  const angle = (degrees * Math.PI) / 180;
  shape.triangle([0, 0, 0], [1, 0, 0], [0.5, 1, 0], shape.face());
  shape.triangle([1, 0, 0], [0, 0, 0], [0.5, -Math.cos(angle), -Math.sin(angle)], shape.face());
  return shape.build();
}

/** The signed volume enclosed by a triangle list. Positive when faces point outwards. */
export function signedVolume(positions: ArrayLike<number>, indices?: ArrayLike<number>): number {
  const count = indices === undefined ? positions.length / 3 : indices.length;
  let volume = 0;
  for (let corner = 0; corner < count; corner += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => {
      const vertex = indices === undefined ? corner + k : indices[corner + k]!;
      return [positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!] as Point;
    }) as [Point, Point, Point];
    volume += dot(a, cross(b, c)) / 6;
  }
  return volume;
}

export function binaryStl(positions: ArrayLike<number>, header = "binary stl"): Uint8Array {
  const triangles = positions.length / 9;
  const bytes = new Uint8Array(84 + triangles * 50);
  bytes.set(new TextEncoder().encode(header).subarray(0, 80));
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles, true);
  for (let t = 0; t < triangles; t += 1) {
    for (let k = 0; k < 9; k += 1) view.setFloat32(84 + t * 50 + 12 + k * 4, positions[t * 9 + k]!, true);
  }
  return bytes;
}

export function asciiStl(positions: ArrayLike<number>, name = "shape"): Uint8Array {
  const lines = [`solid ${name}`];
  for (let t = 0; t < positions.length / 9; t += 1) {
    lines.push("  facet normal 0 0 0", "    outer loop");
    for (let k = 0; k < 3; k += 1) lines.push(`      vertex ${positions[t * 9 + k * 3]} ${positions[t * 9 + k * 3 + 1]} ${positions[t * 9 + k * 3 + 2]}`);
    lines.push("    endloop", "  endfacet");
  }
  lines.push(`endsolid ${name}`, "");
  return new TextEncoder().encode(lines.join("\n"));
}

/** The millimetre, Z-up space both CAD consumers of this package model in. */
export const MM_Z_UP = { unit: 0.001, up: "Z" } as const;
