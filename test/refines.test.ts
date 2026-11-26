// A body that says which coarser mesh its triangles were cut from takes its shading from that
// mesh: cutting a surface without moving it does not change how it is shaded.
import { describe, expect, it } from "vitest";
import {
  exportGameGlb,
  GameExportError,
  readGlb,
  readPack,
  type BodyInput,
  type ExportInput,
  type ExportOptions,
  type GameExportErrorCode,
  type PackBody,
  type SourceSpace,
} from "../src/index.js";
import { box, chamferedBlock, cutAtMiddles, cutCylinder, cylinder, cylinderCutAcross, fold, MM_Z_UP, paintedPatch, signedVolume, tube, turned, type Shape } from "./fixtures.js";

const Z_UP = { unit: 1, up: "Z" } as const;
const SEGMENTS = 8;
const round = cylinder(1, 2, SEGMENTS);
const cut = cutCylinder(1, 2, SEGMENTS);
const DEGREES = 180 / Math.PI;
/** Degrees. So near to straight out, the last digit of a 32-bit normal is 0.03 degrees. */
const STRAIGHT_OUT = 0.1;

function run(body: Partial<BodyInput> & { positions: ArrayLike<number> }, options: ExportOptions & { source?: SourceSpace } = {}) {
  const result = exportGameGlb({ bodies: [{ name: "shape", ...body }], source: Z_UP, pivot: "origin", ...options });
  return { ...result, body: readPack(result.glb).bodies[0]! };
}

function refusal(body: Record<string, unknown>, options: Record<string, unknown> = {}): { code: GameExportErrorCode; message: string } {
  try {
    exportGameGlb({ bodies: [{ name: "part", positions: cut.positions, ...body }], source: Z_UP, ...options } as ExportInput);
  } catch (error) {
    expect(error).toBeInstanceOf(GameExportError);
    const { code, message } = error as GameExportError;
    return { code, message };
  }
  throw new Error("Expected the export to be refused, but it went through.");
}

function refusalError(input: unknown): GameExportError {
  try {
    exportGameGlb(input as ExportInput);
  } catch (error) {
    expect(error).toBeInstanceOf(GameExportError);
    return error as GameExportError;
  }
  throw new Error("Expected the export to be refused, but it went through.");
}

/** The cut cylinder as a body that says what it was cut from. */
function refined(extra: Partial<BodyInput> = {}): BodyInput {
  return { name: "shape", positions: cut.positions, refines: { surfaces: [{ positions: round.positions, faceIds: round.faceIds }], triangleOf: cut.triangleOf }, ...extra };
}

/**
 * How far, in degrees, the normal of each vertex of the round side is from the direction straight
 * out from the axis at that vertex. The axis is +Y in the file. Vertices of the two ends are left out.
 */
function offRound(body: PackBody): number[] {
  const off: number[] = [];
  for (let at = 0; at < body.positions.length; at += 3) {
    const [nx, ny, nz] = body.normals.subarray(at, at + 3);
    if (Math.abs(ny!) > 0.5) continue;
    const [x, , z] = body.positions.subarray(at, at + 3);
    const along = (nx! * x! + nz! * z!) / Math.hypot(x!, z!);
    off.push(Math.acos(Math.min(1, along)) * DEGREES);
  }
  return off;
}

/** Every written vertex as its position and normal, each pair once, in a form that sorts and compares. */
function shading(body: PackBody): string[] {
  const seen = new Set<string>();
  for (let at = 0; at < body.positions.length; at += 3) {
    seen.add([...body.positions.subarray(at, at + 3), ...body.normals.subarray(at, at + 3)].map((value) => value + 0).join(","));
  }
  return [...seen].sort();
}

/** The normals written at each position, by position. */
function normalsByPosition(body: PackBody): Map<string, string[]> {
  const found = new Map<string, Set<string>>();
  for (let at = 0; at < body.positions.length; at += 3) {
    const key = [...body.positions.subarray(at, at + 3)].map((value) => value + 0).join(",");
    const normal = [...body.normals.subarray(at, at + 3)].map((value) => value + 0).join(",");
    found.set(key, (found.get(key) ?? new Set()).add(normal));
  }
  return new Map([...found].map(([key, normals]) => [key, [...normals].sort()]));
}

describe("a round wall cut finer without moving it", () => {
  it("is shaded along its flat sides where it was cut, when nothing says what it was cut from", () => {
    // The cut mesh with its own exact faces: the side is one face, so it is smooth all round.
    const { body, facts } = run({ positions: cut.positions, faceIds: cut.faceIds });
    expect(facts.bodies[0]).not.toHaveProperty("shadedFrom");
    const off = offRound(body);
    // A point cut into a flat side has that side's direction. A quarter of the way along a side
    // that turns 45 degrees, that is over 11 degrees away from straight out.
    expect(Math.max(...off)).toBeGreaterThan(11);
    expect(Math.max(...off)).toBeLessThan(180 / SEGMENTS);
  });

  it("joins the points of a cut that lie a rounding error off the edge they are on", () => {
    // A cutting tool hands its points back rounded. On a wall 50 mm from the axis, in 32 bits,
    // that is a few millionths of a millimetre off the edge between two sides: still one point
    // of that edge. Here every number of the cut is moved by up to that much, each its own way.
    const wall = cylinder(50, 30, 64);
    const sliced = cutCylinder(50, 30, 64);
    const from = { surfaces: [{ positions: wall.positions }], triangleOf: sliced.triangleOf };
    const exact = run({ positions: sliced.positions, refines: from }, { source: MM_Z_UP });
    const off = Float64Array.from(sliced.positions, (value, index) => value + ((((index + 1) * 2654435761) % 1000) / 1000 - 0.5) * 8e-6);
    const rounded = run({ positions: off, refines: from }, { source: MM_Z_UP });
    expect(rounded.facts.bodies[0]!.vertices).toBe(exact.facts.bodies[0]!.vertices);
    expect(rounded.facts.bodies[0]!.triangles).toBe(exact.facts.bodies[0]!.triangles);
    expect(Math.max(...offRound(rounded.body))).toBeLessThan(STRAIGHT_OUT);
    expect(offRound(rounded.body)).toHaveLength(offRound(exact.body).length);
  });

  it("is shaded as it was before the cut when the body says what it was cut from", () => {
    const { body, facts } = run(refined());
    const off = offRound(body);
    // Six points of the side for each segment on the rings, and two inside each segment's two triangles.
    expect(off).toHaveLength(8 * SEGMENTS);
    expect(Math.max(...off)).toBeLessThan(STRAIGHT_OUT);
    expect(facts.bodies[0]!.triangles).toBe(16 * SEGMENTS);
    // The side's vertices, and for each end its middle, its rim and the points cut into its rim.
    expect(facts.bodies[0]!.vertices).toBe(8 * SEGMENTS + 2 * (2 * SEGMENTS + 1));
    expect(facts.bodies[0]!.shadedFrom).toEqual({ surfaces: 1, triangles: 4 * SEGMENTS });
    expect(facts.bodies[0]!.openEdges).toBe(0);
    expect(facts.bodies[0]!.nonManifoldEdges).toBe(0);
    expect(signedVolume(body.positions, body.indices)).toBeGreaterThan(0);
  });

  it("gives every point that was there before the cut the very normals it had", () => {
    const before = normalsByPosition(run({ positions: round.positions, faceIds: round.faceIds }).body);
    const after = normalsByPosition(run(refined()).body);
    expect(before.size).toBe(2 * SEGMENTS + 2);
    for (const [position, normals] of before) expect(after.get(position)).toEqual(normals);
  });

  it("keeps the hard edge round each end hard, at the points cut into it too", () => {
    const { body } = run(refined());
    let onRim = 0;
    for (const [position, normals] of normalsByPosition(body)) {
      const [x, y, z] = position.split(",").map(Number);
      if (Math.hypot(x!, z!) < 0.9 || (Math.abs(y!) > 1e-6 && Math.abs(y! - 2) > 1e-6)) continue;
      onRim += 1;
      // One normal for the side and one for the end.
      expect(normals).toHaveLength(2);
      expect(normals.map((normal) => Math.abs(Number(normal.split(",")[1])) > 0.5).sort()).toEqual([false, true]);
    }
    expect(onRim).toBe(4 * SEGMENTS);
  });

  it("is shaded the same whatever is painted on it", () => {
    const plain = run(refined());
    const painted = run(refined({ color: "#2980ba", faceColors: paintedPatch(SEGMENTS, "#c0392b") }));
    expect(painted.facts.bodies[0]!.materialSlots).toBe(2);
    // The vertices between the two colours are written once for each, so there are more of them,
    expect(painted.facts.bodies[0]!.vertices).toBeGreaterThan(plain.facts.bodies[0]!.vertices);
    // and they are the same points with the same normals.
    expect(shading(painted.body)).toEqual(shading(plain.body));
    expect(Math.max(...offRound(painted.body))).toBeLessThan(STRAIGHT_OUT);
    // A vertex on the border has the same normal in both colours. The points on the two rims
    // are left out: there a point of the side shares its place with a point of the end.
    const [red, blue] = painted.body.surfaces.map((surface) => {
      const [from, to] = [surface.firstVertex * 3, (surface.firstVertex + surface.vertices) * 3];
      return normalsByPosition({ positions: painted.body.positions.subarray(from, to), normals: painted.body.normals.subarray(from, to) } as PackBody);
    });
    let shared = 0;
    for (const [position, normals] of red!) {
      const height = Number(position.split(",")[1]);
      const other = blue!.get(position);
      if (other === undefined || height < 1e-6 || height > 2 - 1e-6) continue;
      shared += 1;
      expect(normals).toHaveLength(1);
      expect(other).toEqual(normals);
    }
    expect(shared).toBeGreaterThan(SEGMENTS);
  });

  it("works the same for a source that is mirrored, in millimetres or Y-up", () => {
    for (const source of [{ unit: 0.001, up: "Z" }, { unit: 1, up: "Z", handedness: "left" }] as const) {
      const { body } = run(refined(), { source });
      expect(Math.max(...offRound(body))).toBeLessThan(STRAIGHT_OUT);
      expect(signedVolume(body.positions, body.indices)).toBeGreaterThan(0);
    }
  });

  it("takes the surface as the options shade it: crease angle, face ids and normal mode", () => {
    // Without face ids the eight sides are 45 degrees apart, so the default crease angle keeps them flat.
    const faceted = run({ positions: cut.positions, refines: { surfaces: [{ positions: round.positions }], triangleOf: cut.triangleOf } });
    expect(Math.max(...offRound(faceted.body))).toBeCloseTo(180 / SEGMENTS, 3);
    expect(faceted.facts.settings.faceIds).toBe(false);
    // A wider crease angle makes them one round wall again.
    const smooth = run({ positions: cut.positions, refines: { surfaces: [{ positions: round.positions }], triangleOf: cut.triangleOf } }, { creaseAngle: 50 });
    expect(Math.max(...offRound(smooth.body))).toBeLessThan(STRAIGHT_OUT);
    const weighted = run(refined(), { normals: "face-weighted" });
    expect(Math.max(...offRound(weighted.body))).toBeLessThan(STRAIGHT_OUT);
    expect(weighted.facts.settings.faceIds).toBe(true);
  });

  it("leaves the body's own face ids out of the shading", () => {
    // Face ids that would make every triangle of the body a face of its own.
    const own = Uint32Array.from({ length: cut.faceIds.length }, (_, triangle) => triangle);
    const withOwn = run(refined({ faceIds: own }));
    const without = run(refined());
    expect(readGlb(withOwn.glb).bin).toEqual(readGlb(without.glb).bin);
    // The face ids that had a say are the surface's.
    expect(withOwn.facts.settings.faceIds).toBe(true);
    const neither = run({ positions: cut.positions, faceIds: own, refines: { surfaces: [{ positions: round.positions }], triangleOf: cut.triangleOf } });
    expect(neither.facts.settings.faceIds).toBe(false);
  });
});

describe("a mesh whose triangles were cut and whose corners carry mixed normals", () => {
  const block = chamferedBlock([10, 5, 2.5], 0.2);
  const split = cutAtMiddles(block);
  // At 50 degrees the chamfers are soft, so every corner mixes the normals of the faces round it.
  const options = { creaseAngle: 50 } as const;

  it("has other normals at the same corners when only the triangles changed", () => {
    const before = normalsByPosition(run({ positions: block.positions }, options).body);
    const after = normalsByPosition(run({ positions: split.positions }, options).body);
    let moved = 0;
    for (const [position, normals] of before) if (after.get(position)!.join() !== normals.join()) moved += 1;
    expect(moved).toBeGreaterThan(0);
  });

  it("keeps the normals at those corners when the body says what it was cut from", () => {
    const before = normalsByPosition(run({ positions: block.positions }, options).body);
    const { body, facts } = run({ positions: split.positions, refines: { surfaces: [{ positions: block.positions }], triangleOf: split.triangleOf } }, options);
    for (const [position, normals] of before) expect(normalsByPosition(body).get(position)).toEqual(normals);
    // The 24 corners and one new point in each of the 44 triangles.
    expect(facts.bodies[0]!.vertices).toBe(24 + 44);
    expect(facts.bodies[0]!.shadedFrom).toEqual({ surfaces: 1, triangles: 44 });
  });

  it("keeps a box's edges hard and its faces flat", () => {
    const cube = box([0, 0, 0], [1, 2, 3]);
    const pieces = cutAtMiddles(cube);
    const { body, facts } = run({ positions: pieces.positions, refines: { surfaces: [{ positions: cube.positions }], triangleOf: pieces.triangleOf } });
    expect(facts.bodies[0]!.vertices).toBe(24 + 12);
    for (let at = 0; at < body.normals.length; at += 3) {
      expect([...body.normals.subarray(at, at + 3)].map((value) => Math.abs(value)).sort()).toEqual([0, 0, 1]);
    }
  });
});

describe("triangles that reach across several triangles of a flat part", () => {
  it("shades a cylinder whose flat sides and ends were divided another way as the cylinder", () => {
    const across = cylinderCutAcross(1, 2, SEGMENTS);
    const before = normalsByPosition(run({ positions: round.positions, faceIds: round.faceIds }).body);
    const { body, facts } = run({ positions: across.positions, refines: { surfaces: [{ positions: round.positions, faceIds: round.faceIds }], triangleOf: across.triangleOf } });
    // The same points with the very same normals, but for the two middles of the ends, which are gone.
    const after = normalsByPosition(body);
    expect(after.size).toBe(2 * SEGMENTS);
    for (const [position, normals] of after) expect(normals).toEqual(before.get(position));
    expect(facts.bodies[0]!.vertices).toBe(4 * SEGMENTS);
    expect(facts.bodies[0]!.openEdges).toBe(0);
    expect(Math.max(...offRound(body))).toBeLessThan(STRAIGHT_OUT);
    // Alone, with its own exact faces, the same mesh is round too, but not with the same numbers.
    const alone = normalsByPosition(run({ positions: across.positions, faceIds: across.faceIds }).body);
    expect([...alone].some(([position, normals]) => normals.join() !== before.get(position)!.join())).toBe(true);
  });

  // A flat square in two triangles, with a flap hanging from each of its edges at a slope of its
  // own. All of it is shaded smoothly, so each corner of the square has a normal of its own, and
  // the normal inside the square bends at the diagonal.
  const [a, b, c, d] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] as const;
  const flaps = [[a, [0.5, -1, -0.3], b], [b, [2, 0.5, -0.5], c], [c, [0.5, 2, -0.2], d], [d, [-1, 0.5, -0.8], a]] as const;
  const tent = Float32Array.from([a, b, c, a, c, d, ...flaps.flat()].flat());
  const smooth = { creaseAngle: 60 } as const;
  const at = (body: PackBody, point: readonly number[]) => {
    // Source z is up: the file has (x, z, -y).
    const found = normalsByPosition(body).get([point[0]!, point[2]!, -point[1]!].map((value) => Math.fround(value) + 0).join(","))!;
    expect(found).toHaveLength(1);
    return found[0]!.split(",").map(Number);
  };

  it("finds each corner in the triangle it really lies in, not in the one its triangle names", () => {
    // The square divided round a point inside its first triangle. Two of the four pieces reach
    // across the diagonal, and name the second triangle.
    const p = [0.7, 0.2, 0] as const;
    const pieces = Float32Array.from([a, b, p, b, c, p, c, d, p, d, a, p, ...flaps.flat()].flat());
    const before = run({ positions: tent }, smooth).body;
    const { body, facts } = run({ positions: pieces, refines: { surfaces: [{ positions: tent }], triangleOf: [0, 0, 1, 1, 2, 3, 4, 5] } }, smooth);
    expect(facts.bodies[0]!.vertices).toBe(9);
    for (const corner of [a, b, c, d]) expect(at(body, corner)).toEqual(at(before, corner));
    // The point is three tenths `a`, a half `b` and two tenths `c` of the first triangle.
    const [na, nb, nc] = [at(before, a), at(before, b), at(before, c)];
    const mixed = [0, 1, 2].map((axis) => 0.3 * na[axis]! + 0.5 * nb[axis]! + 0.2 * nc[axis]!);
    const length = Math.hypot(...mixed);
    at(body, p).forEach((value, axis) => expect(value).toBeCloseTo(mixed[axis]! / length, 6));
    // Not what the second triangle's corners would give it.
    expect(Math.abs(at(body, p)[0]! - at(before, d)[0]!)).toBeGreaterThan(0.01);
  });

  it("gives a point on the diagonal one normal, whichever triangle each piece names", () => {
    const p = [0.5, 0.5, 0] as const;
    const pieces = Float32Array.from([a, b, p, b, c, p, c, d, p, d, a, p, ...flaps.flat()].flat());
    const before = run({ positions: tent }, smooth).body;
    const [na, nc] = [at(before, a), at(before, c)];
    const mixed = [0, 1, 2].map((axis) => 0.5 * na[axis]! + 0.5 * nc[axis]!);
    for (const triangleOf of [[0, 0, 1, 1, 2, 3, 4, 5], [1, 0, 0, 1, 2, 3, 4, 5], [1, 1, 0, 0, 2, 3, 4, 5]]) {
      const { body, facts } = run({ positions: pieces, refines: { surfaces: [{ positions: tent }], triangleOf } }, smooth);
      expect(facts.bodies[0]!.vertices).toBe(9);
      at(body, p).forEach((value, axis) => expect(value).toBeCloseTo(mixed[axis]! / Math.hypot(...mixed), 6));
    }
  });

  it("does not look across a hard edge for where a corner lies", () => {
    // The top of a box, said to lie in a triangle of one of its sides.
    const cube = box([0, 0, 0], [1, 1, 1]);
    const triangleOf = Array.from({ length: 12 }, (_, triangle) => (triangle === 10 ? 0 : triangle));
    const { code, message } = refusal({ positions: cube.positions, refines: { surfaces: [{ positions: cube.positions }], triangleOf } });
    expect(code).toBe("BAD_REFINEMENT");
    expect(message).toContain("triangle 10 is said to lie in triangle 0 of the mesh it refines, but one of its corners is 1.00 m away from the mesh there.");
  });
});

describe("a mesh that refines itself", () => {
  const block = chamferedBlock([10, 5, 2.5], 0.2);
  const itself = (shape: Shape, withIds: boolean) => ({
    surfaces: [{ positions: shape.positions, ...(withIds ? { faceIds: shape.faceIds } : {}) }],
    triangleOf: Uint32Array.from({ length: shape.faceIds.length }, (_, triangle) => triangle),
  });
  const cases: [string, Shape, boolean, ExportOptions][] = [
    ["a cylinder with face ids", round, true, {}],
    ["a faceted cylinder", round, false, {}],
    ["a chamfered block with soft chamfers", block, false, { creaseAngle: 50 }],
    ["a chamfered block with face-weighted normals", block, true, { creaseAngle: 50, normals: "face-weighted" }],
    ["a cylinder that was cut, with face ids", cut, true, { pivot: "base-center" }],
  ];

  it.each(cases)("is written with the vertex data it has without it: %s", (_, shape, withIds, options) => {
    const plain = run({ positions: shape.positions, ...(withIds ? { faceIds: shape.faceIds } : {}) }, options);
    const same = run({ positions: shape.positions, refines: itself(shape, withIds) }, options);
    expect(readGlb(same.glb).bin).toEqual(readGlb(plain.glb).bin);
    expect(same.facts.bodies[0]!.vertices).toBe(plain.facts.bodies[0]!.vertices);
    expect(same.facts.bodies[0]!.shadedFrom).toEqual({ surfaces: 1, triangles: shape.faceIds.length });
  });
});

describe("a body cut from more than one surface", () => {
  const pipe = tube(2, 1, 3, SEGMENTS);
  const outer = cylinder(2, 3, SEGMENTS);
  const hole = turned(cylinder(1, 3, SEGMENTS));
  const refines = { surfaces: [{ positions: outer.positions, faceIds: outer.faceIds }, { positions: hole.positions, faceIds: hole.faceIds }], surfaceOf: pipe.surfaceOf, triangleOf: pipe.triangleOf };

  it("shades a tube round outside and round inside, with the wall of the hole facing into it", () => {
    const { body, facts } = run({ positions: pipe.positions, refines });
    expect(facts.bodies[0]!.shadedFrom).toEqual({ surfaces: 2, triangles: 8 * SEGMENTS });
    expect(facts.bodies[0]!.openEdges).toBe(0);
    let outside = 0;
    let inside = 0;
    for (let at = 0; at < body.positions.length; at += 3) {
      const [nx, ny, nz] = body.normals.subarray(at, at + 3);
      if (Math.abs(ny!) > 0.5) continue;
      const [x, , z] = body.positions.subarray(at, at + 3);
      const radius = Math.hypot(x!, z!);
      const along = (nx! * x! + nz! * z!) / radius;
      if (radius > 1.5) {
        outside += 1;
        expect(along).toBeGreaterThan(0.999999);
      } else {
        inside += 1;
        expect(along).toBeLessThan(-0.999999);
      }
    }
    // One vertex for each point of the four rings.
    expect([outside, inside]).toEqual([2 * SEGMENTS, 2 * SEGMENTS]);
    // And each of them once more for the flat end it is on.
    expect(facts.bodies[0]!.vertices).toBe(8 * SEGMENTS);
  });

  it("gives the same tube flat sides when its surfaces have no face ids", () => {
    const { facts } = run({ positions: pipe.positions, refines: { ...refines, surfaces: [{ positions: outer.positions }, { positions: hole.positions }] } });
    // Every flat side of the two walls has four vertices of its own, and each end has its sixteen.
    expect(facts.bodies[0]!.vertices).toBe(2 * 4 * SEGMENTS + 2 * 2 * SEGMENTS);
  });

  it("never shades across from one surface to another, however flat they meet", () => {
    const bend = fold(10);
    const [first, second] = [bend.positions.subarray(0, 9), bend.positions.subarray(9)];
    const one = run({ positions: bend.positions, refines: { surfaces: [{ positions: bend.positions }], triangleOf: [0, 1] } }, { source: { unit: 1, up: "Y" } });
    expect(one.facts.bodies[0]!.vertices).toBe(4);
    const two = run({ positions: bend.positions, refines: { surfaces: [{ positions: first }, { positions: second }], surfaceOf: [0, 1], triangleOf: [0, 0] } }, { source: { unit: 1, up: "Y" } });
    expect(two.facts.bodies[0]!.vertices).toBe(6);
  });
});

describe("limits and refusals of refines", () => {
  const surfaces = [{ positions: round.positions }];
  const triangles = cut.triangleOf.length;

  it("counts the triangles of the body, not those of what it was cut from, against maxTriangles", () => {
    expect(() => exportGameGlb({ bodies: [refined()], source: Z_UP, maxTriangles: triangles })).not.toThrow();
    expect(refusal({ refines: refined().refines }, { maxTriangles: triangles - 1 }).code).toBe("TOO_MANY_TRIANGLES");
    // What bodies were cut from has the same limit, counted on its own.
    const twice = { surfaces: [surfaces[0]!, surfaces[0]!], surfaceOf: new Uint8Array(triangles), triangleOf: cut.triangleOf };
    expect(() => exportGameGlb({ bodies: [refined({ refines: twice })], source: Z_UP, maxTriangles: triangles })).not.toThrow();
    const many = { surfaces: Array.from({ length: 5 }, () => surfaces[0]!), surfaceOf: new Uint8Array(triangles), triangleOf: cut.triangleOf };
    expect(refusal({ refines: many }, { maxTriangles: triangles })).toEqual({
      code: "TOO_MANY_TRIANGLES",
      message: `The meshes that bodies refine hold more than ${triangles} triangles, the limit for one export. Raise maxTriangles.`,
    });
  });

  it("refuses refines that is not what it should be", () => {
    expect(refusal({ refines: 7 })).toEqual({ code: "BAD_REFINEMENT", message: 'Body "part": refines must be { surfaces, triangleOf }.' });
    expect(refusal({ refines: { surfaces: [], triangleOf: cut.triangleOf } }).message).toBe('Body "part": refines.surfaces must be an array with at least one mesh.');
    expect(refusal({ refines: { triangleOf: cut.triangleOf } }).code).toBe("BAD_REFINEMENT");
    expect(refusal({ refines: { surfaces: [null], triangleOf: cut.triangleOf } })).toEqual({ code: "BAD_REFINEMENT", message: 'Body "part", surface 0 of refines is not an object.' });
    expect(refusal({ refines: { surfaces } })).toEqual({ code: "BAD_REFINEMENT", message: 'Body "part": refines.triangleOf must be a typed array or an array of numbers.' });
  });

  it("checks each surface as it checks a body", () => {
    const withSurface = (surface: Record<string, unknown>) => refusal({ refines: { surfaces: [surfaces[0], surface], surfaceOf: new Uint8Array(triangles), triangleOf: cut.triangleOf } });
    expect(withSurface({ positions: [] })).toEqual({ code: "EMPTY_BODY", message: 'Body "part", surface 1 of refines has no vertices.' });
    expect(withSurface({ positions: [0, 0, 0, 1, 0, 0, 0, NaN, 0] }).code).toBe("NON_FINITE_POSITION");
    expect(withSurface({ positions: round.positions.subarray(0, 12) }).code).toBe("BAD_POSITIONS");
    expect(withSurface({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 3] })).toEqual({
      code: "INDEX_OUT_OF_RANGE",
      message: 'Body "part", surface 1 of refines: index 2 points at vertex 3, but the surface has 3 vertices.',
    });
    expect(withSurface({ positions: round.positions, faceIds: [1, 2] }).code).toBe("BAD_FACE_IDS");
  });

  it("refuses lists that do not have one whole number per triangle, or point past what there is", () => {
    expect(refusal({ refines: { surfaces, triangleOf: cut.triangleOf.subarray(1) } })).toEqual({
      code: "BAD_REFINEMENT",
      message: `Body "part": refines.triangleOf holds ${triangles - 1} numbers for ${triangles} triangles. It needs exactly one per triangle.`,
    });
    const bad = (value: number) => refusal({ refines: { surfaces, triangleOf: [value, ...cut.triangleOf.subarray(1)] } });
    expect(bad(0.5).message).toBe(`Body "part": refines.triangleOf says triangle 0 lies in triangle 0.5, but the surface has ${4 * SEGMENTS} triangles, numbered from 0.`);
    expect(bad(-1).code).toBe("BAD_REFINEMENT");
    expect(bad(4 * SEGMENTS).code).toBe("BAD_REFINEMENT");
    const two = [surfaces[0]!, surfaces[0]!];
    expect(refusal({ refines: { surfaces: two, triangleOf: cut.triangleOf } })).toEqual({
      code: "BAD_REFINEMENT",
      message: 'Body "part": refines has 2 surfaces, so it needs surfaceOf to say which one each triangle lies in.',
    });
    expect(refusal({ refines: { surfaces: two, surfaceOf: [0], triangleOf: cut.triangleOf } }).code).toBe("BAD_REFINEMENT");
    const surfaceOf = new Array<number>(triangles).fill(0);
    surfaceOf[3] = 2;
    expect(refusal({ refines: { surfaces: two, surfaceOf, triangleOf: cut.triangleOf } }).message).toBe(
      'Body "part": refines.surfaceOf says triangle 3 lies in surface 2, but there are 2 surfaces, numbered from 0.',
    );
  });

  it("refuses a triangle that does not lie in the triangle it names, and says how far off it is", () => {
    // Triangle 0 of the cut cylinder lies in triangle 0 of the cylinder. Triangle 9, across the wall, is not it.
    const triangleOf = Uint32Array.from(cut.triangleOf);
    triangleOf[0] = 9;
    const { code, message } = refusal({ refines: { surfaces, triangleOf } });
    expect(code).toBe("BAD_REFINEMENT");
    expect(message).toMatch(/^Body "part": triangle 0 is said to lie in triangle 9 of the mesh it refines, but one of its corners is \d\.\d+ m away from the mesh there\. A corner may be 0\.00\d+ m away at most\.$/);
    const two = { surfaces: [surfaces[0]!, surfaces[0]!], surfaceOf: new Uint8Array(triangles).fill(1), triangleOf };
    expect(refusal({ refines: two }).message).toContain("is said to lie in triangle 9 of surface 1 of the mesh it refines");
  });

  it("allows a corner a thousandth of the triangle's longest edge away, and no more", () => {
    // One triangle with an edge of 10, and the same triangle lifted off it.
    const flat = [0, 0, 0, 10, 0, 0, 0, 5, 0];
    const lifted = (by: number) => ({ name: "part", positions: [0, 0, by, 10, 0, by, 0, 5, by], refines: { surfaces: [{ positions: flat }], triangleOf: [0] } });
    const longest = Math.hypot(10, 5);
    expect(() => exportGameGlb({ bodies: [lifted(longest * 0.9e-3)], source: Z_UP })).not.toThrow();
    expect(() => exportGameGlb({ bodies: [lifted(longest * 1.1e-3)], source: Z_UP })).toThrowError(/one of its corners is 0\.0123 m away from the mesh there\. A corner may be 0\.0112 m away at most\./);
    // A wider weld tolerance allows twice itself.
    expect(() => exportGameGlb({ bodies: [lifted(0.05)], source: Z_UP, weldTolerance: 0.03 })).not.toThrow();
  });

  it("says which body it refused, so the caller can write that one without refines", () => {
    const triangleOf = Uint32Array.from(cut.triangleOf);
    triangleOf[0] = 9;
    const bodies: BodyInput[] = [{ name: "fine", positions: round.positions }, refined({ refines: { surfaces, triangleOf } }), refined({ name: "third", refines: { surfaces: [], triangleOf } })];
    const attempt = () => {
      try {
        return exportGameGlb({ bodies, source: Z_UP });
      } catch (error) {
        return error as GameExportError;
      }
    };
    // What is wrong in how a body is written is found first, for every body, then what is wrong in where its triangles lie.
    expect(attempt()).toMatchObject({ code: "BAD_REFINEMENT", body: 2 });
    bodies[2] = { name: "third", positions: cut.positions };
    expect(attempt()).toMatchObject({ code: "BAD_REFINEMENT", body: 1 });
    bodies[1] = { name: "shape", positions: cut.positions };
    expect(attempt()).not.toBeInstanceOf(GameExportError);
    // A refusal about a body's arrays names the body too. One about names read across bodies does not.
    expect(refusalError({ bodies: [bodies[0]!, { name: "empty", positions: [] }], source: Z_UP }).body).toBe(1);
    expect(refusalError({ bodies: [{ ...bodies[0]!, color: "#f00", materialName: "x" }, { ...bodies[0]!, color: "#0f0", materialName: "x" }], source: Z_UP }).body).toBeUndefined();
    expect(refusalError({ bodies: [], source: Z_UP }).body).toBeUndefined();
  });

  it("refuses a triangle that names one without area", () => {
    const flat = [0, 0, 0, 10, 0, 0, 0, 5, 0, 1, 1, 0, 2, 2, 0, 3, 3, 0];
    const { code, message } = refusal({ positions: flat.slice(0, 9), refines: { surfaces: [{ positions: flat }], triangleOf: [1] } });
    expect(code).toBe("BAD_REFINEMENT");
    expect(message).toBe('Body "part": triangle 0 is said to lie in triangle 1 of the mesh it refines, but that triangle has no area.');
  });

  it("does not ask where a triangle without area lies", () => {
    const flat = [0, 0, 0, 10, 0, 0, 0, 5, 0];
    const { facts } = exportGameGlb({
      bodies: [{ name: "part", positions: [...flat, 50, 50, 50, 50, 50, 50, 50, 50, 50], refines: { surfaces: [{ positions: flat }], triangleOf: [0, 0] } }],
      source: Z_UP,
    });
    expect(facts.bodies[0]!.degenerateTrianglesDropped).toBe(1);
    expect(facts.bodies[0]!.triangles).toBe(1);
  });
});
