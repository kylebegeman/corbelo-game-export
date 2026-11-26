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
