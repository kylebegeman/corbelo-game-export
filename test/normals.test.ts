import { describe, expect, it } from "vitest";
import { exportGameGlb, readPack, type ExportOptions, type SourceSpace } from "../src/index.js";
import { chamferedBlock, cylinder, fold, MM_Z_UP, type Shape } from "./fixtures.js";

const METRES = { unit: 1, up: "Y" } as const;

type RunOptions = ExportOptions & { faceIds?: boolean; source?: SourceSpace };

function run(shape: Shape, options: RunOptions = {}) {
  const { faceIds, ...rest } = options;
  const result = exportGameGlb({
    bodies: [{ name: "shape", positions: shape.positions, ...(faceIds ? { faceIds: shape.faceIds } : {}) }],
    source: METRES,
    pivot: "origin",
    ...rest,
  });
  return { ...result, body: readPack(result.glb).bodies[0]! };
}

function normalAt(body: { positions: Float32Array; normals: Float32Array }, point: readonly number[]): number[][] {
  const found: number[][] = [];
  for (let at = 0; at < body.positions.length; at += 3) {
    if ([0, 1, 2].every((axis) => Math.abs(body.positions[at + axis]! - point[axis]!) < 1e-6)) found.push([...body.normals.slice(at, at + 3)]);
  }
  return found;
}

describe("hard and soft edges", () => {
  it("keeps an edge soft up to the crease angle and splits it beyond", () => {
    expect(run(fold(20)).facts.bodies[0]!.vertices).toBe(4);
    expect(run(fold(40)).facts.bodies[0]!.vertices).toBe(6);
  });

  it("follows the crease angle option", () => {
    expect(run(fold(40), { creaseAngle: 45 }).facts.bodies[0]!.vertices).toBe(4);
    expect(run(fold(20), { creaseAngle: 10 }).facts.bodies[0]!.vertices).toBe(6);
  });

  it("gives a split vertex the normal of its own side", () => {
    const { body } = run(fold(90));
    const normals = normalAt(body, [0, 0, 0]);
    expect(normals).toHaveLength(2);
    expect(normals.some((normal) => Math.abs(normal[2]! - 1) < 1e-6)).toBe(true);
    expect(normals.some((normal) => Math.abs(normal[1]! + 1) < 1e-6)).toBe(true);
  });

  it("never splits inside one exact face, however sharp its triangles meet", () => {
    const shape = fold(40);
    const oneFace = { positions: shape.positions, faceIds: Uint32Array.from([7, 7]) };
    expect(run(oneFace, { faceIds: true }).facts.bodies[0]!.vertices).toBe(4);
  });

  it("splits between two exact faces only when they meet sharper than the crease angle", () => {
    expect(run(fold(40), { faceIds: true }).facts.bodies[0]!.vertices).toBe(6);
    expect(run(fold(20), { faceIds: true }).facts.bodies[0]!.vertices).toBe(4);
  });

  it("shades a coarse cylinder in facets without face ids and round with them", () => {
    const coarse = cylinder(1, 2, 8);
    // Eight side strips 45 degrees apart: four corners each, plus two caps of nine vertices.
    expect(run(coarse).facts.bodies[0]!.vertices).toBe(8 * 4 + 2 * 9);
    const round = run(coarse, { faceIds: true, source: { unit: 1, up: "Z" } });
    // Two shared rings of eight, plus the caps.
    expect(round.facts.bodies[0]!.vertices).toBe(2 * 8 + 2 * 9);
    // Side normals point straight out from the axis, which is +Y after the conversion.
    let sideVertices = 0;
    for (let at = 0; at < round.body.positions.length; at += 3) {
      const [x, , z] = round.body.positions.slice(at, at + 3);
      const [nx, ny, nz] = round.body.normals.slice(at, at + 3);
      if (Math.abs(ny!) > 0.5) continue;
      sideVertices += 1;
      expect(ny).toBeCloseTo(0, 6);
      expect(nx).toBeCloseTo(x! / Math.hypot(x!, z!), 5);
      expect(nz).toBeCloseTo(z! / Math.hypot(x!, z!), 5);
    }
    expect(sideVertices).toBe(16);
  });

  it("writes one flat normal per face of a chamfered block", () => {
    const result = exportGameGlb({ bodies: [{ name: "block", positions: chamferedBlock([1000, 500, 250], 20).positions }], source: MM_Z_UP });
    const body = readPack(result.glb).bodies[0]!;
    expect(result.facts.bodies[0]).toMatchObject({ triangles: 44, vertices: 6 * 4 + 12 * 4 + 8 * 3 });
    const top: number[][] = [];
    for (let at = 0; at < body.positions.length; at += 3) {
      if (Math.abs(body.positions[at + 1]! - 0.25) < 1e-6) top.push([...body.normals.slice(at, at + 3)]);
    }
    // Sixteen written vertices lie in the top plane: four of the top face, eight of the chamfer
    // strips around it and four of the corner triangles. Only the top face's own point straight up.
    const up = top.filter((normal) => normal[1] === 1);
    expect(up).toHaveLength(4);
    expect(up.every((normal) => normal[0] === 0 && normal[2] === 0)).toBe(true);
    expect(top).toHaveLength(16);
  });

  it("writes unit-length normals", () => {
    const { body } = run(cylinder(0.3, 1, 24), { faceIds: true });
    for (let at = 0; at < body.normals.length; at += 3) {
      expect(Math.hypot(body.normals[at]!, body.normals[at + 1]!, body.normals[at + 2]!)).toBeCloseTo(1, 6);
    }
  });
});

describe("normal weighting", () => {
  it("weights each triangle by its area times its angle at the vertex by default", () => {
    const tilt = (20 * Math.PI) / 180;
    const [c, s] = [Math.cos(tilt), Math.sin(tilt)];
    // A small triangle and one three times as tall, folded 20 degrees along their shared edge.
    const positions = [0, 0, 0, 1, 0, 0, 0.5, 1, 0, 1, 0, 0, 0, 0, 0, 0.5, -3 * c, -3 * s];
    const { body } = run({ positions: Float32Array.from(positions), faceIds: Uint32Array.from([0, 1]) });
    const weightSmall = 0.5 * Math.atan2(1, 0.5);
    const weightLarge = 1.5 * Math.atan2(3, 0.5);
    const expected = [0, -s * weightLarge, weightSmall + c * weightLarge];
    const length = Math.hypot(...expected);
    const [normal] = normalAt(body, [0, 0, 0]);
    expect(normal![0]).toBeCloseTo(0, 6);
    expect(normal![1]).toBeCloseTo(expected[1]! / length, 5);
    expect(normal![2]).toBeCloseTo(expected[2]! / length, 5);
  });

  // A 10 x 10 flat face cut into slivers around a point near its corner, with a bevel strip
  // 2 wide folded down 20 degrees along one edge. At the shared corner the flat face only has
  // small triangles, so plain area weighting lets the bevel bend the flat face's shading.
  function flatFaceWithBevel(): Shape {
    const tilt = (20 * Math.PI) / 180;
    const corners = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]];
    const hub = [0.1, 0.1, 0];
    const low = [[0, -2 * Math.cos(tilt), -2 * Math.sin(tilt)], [10, -2 * Math.cos(tilt), -2 * Math.sin(tilt)]];
    const triangles = [
      ...[0, 1, 2, 3].map((i) => [hub, corners[i]!, corners[(i + 1) % 4]!]),
      [corners[1]!, corners[0]!, low[0]!],
      [corners[1]!, low[0]!, low[1]!],
    ];
    return { positions: Float32Array.from(triangles.flat(2)), faceIds: Uint32Array.from([0, 0, 0, 0, 1, 1]) };
  }

  function tiltAtCorner(options: RunOptions): number {
    const [normal] = normalAt(run(flatFaceWithBevel(), options).body, [0, 0, 0]);
    return (Math.acos(normal![2]!) * 180) / Math.PI;
  }

  it("lets a large flat face dominate with face-weighted normals", () => {
    expect(tiltAtCorner({})).toBeGreaterThan(15);
    expect(tiltAtCorner({ normals: "face-weighted" })).toBeLessThan(4);
  });

  it("finds flat faces from face ids or, without them, from triangles lying in one plane", () => {
    const withIds = tiltAtCorner({ normals: "face-weighted", faceIds: true });
    const withoutIds = tiltAtCorner({ normals: "face-weighted" });
    expect(withIds).toBeCloseTo(withoutIds, 4);
    // Flat face 100, bevel 20: the normal leans by atan(20 sin 20 / (100 + 20 cos 20)).
    expect(withIds).toBeCloseTo((Math.atan2(20 * Math.sin((20 * Math.PI) / 180), 100 + 20 * Math.cos((20 * Math.PI) / 180)) * 180) / Math.PI, 3);
  });
});
