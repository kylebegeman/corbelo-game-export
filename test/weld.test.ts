import { describe, expect, it } from "vitest";
import { exportGameGlb, readPack } from "../src/index.js";
import { box } from "./fixtures.js";

const METRES = { unit: 1, up: "Y" } as const;
// A crease of 180 degrees keeps every edge soft, so the vertex count is the welded count.
const ALL_SOFT = { creaseAngle: 180, pivot: "origin" } as const;

/** Two triangles that share the edge (0,0,0)-(1,0,0), the second with its own copies moved by `gap`. */
function twoTriangles(gap: number, at = 0): number[] {
  return [at, 0, 0, at + 1, 0, 0, at, 1, 0, at + 1, 0, gap, at, 0, gap, at + 1, -1, 0];
}

describe("welding", () => {
  it("turns triangle soup into indexed geometry with shared vertices", () => {
    const shape = box([0, 0, 0], [1, 2, 3]);
    expect(shape.positions.length / 3).toBe(36);
    const { glb, facts } = exportGameGlb({ bodies: [{ name: "box", positions: shape.positions }], source: METRES, ...ALL_SOFT });
    const body = readPack(glb).bodies[0]!;
    expect(facts.bodies[0]!.vertices).toBe(8);
    expect(body.positions.length / 3).toBe(8);
    expect(body.indices.length).toBe(36);
    expect(Math.max(...body.indices)).toBe(7);
  });

  it("welds points closer than the tolerance and keeps points further apart", () => {
    const near = exportGameGlb({ bodies: [{ name: "near", positions: twoTriangles(4e-7) }], source: METRES, ...ALL_SOFT });
    expect(near.facts.bodies[0]).toMatchObject({ vertices: 4, openEdges: 4 });
    const far = exportGameGlb({ bodies: [{ name: "far", positions: twoTriangles(5e-6) }], source: METRES, ...ALL_SOFT });
    expect(far.facts.bodies[0]).toMatchObject({ vertices: 6, openEdges: 6 });
  });

  it("welds across the boundary between two cells of its search grid", () => {
    // The grid cells are two microns wide. 1.9 and 2.3 microns lie in different cells.
    const positions = [1.9e-6, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 2.3e-6, 0, 0, 0, -1, 0];
    const { facts } = exportGameGlb({ bodies: [{ name: "edge", positions }], source: METRES, ...ALL_SOFT });
    expect(facts.bodies[0]).toMatchObject({ vertices: 4, openEdges: 4 });
  });

  it("measures the tolerance in metres whatever the source unit is", () => {
    // Half a micron apart, written in millimetres.
    const { facts } = exportGameGlb({ bodies: [{ name: "mm", positions: twoTriangles(5e-4) }], source: { unit: 0.001, up: "Y" }, ...ALL_SOFT });
    expect(facts.bodies[0]!.vertices).toBe(4);
  });

  it("welds only identical points when the tolerance is zero, and treats -0 as 0", () => {
    const apart = exportGameGlb({ bodies: [{ name: "apart", positions: twoTriangles(1e-9) }], source: METRES, ...ALL_SOFT, weldTolerance: 0 });
    expect(apart.facts.bodies[0]!.vertices).toBe(6);
    const same = exportGameGlb({ bodies: [{ name: "same", positions: twoTriangles(-0) }], source: METRES, ...ALL_SOFT, weldTolerance: 0 });
    expect(same.facts.bodies[0]!.vertices).toBe(4);
  });

  it("welds indexed input whose vertices repeat a position", () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, -1, 0];
    const { facts } = exportGameGlb({ bodies: [{ name: "indexed", positions, indices: [0, 1, 2, 3, 4, 5] }], source: METRES, ...ALL_SOFT });
    expect(facts.bodies[0]).toMatchObject({ vertices: 4, triangles: 2 });
  });

  it("leaves out vertices no triangle uses", () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 50, 50, 50];
    const { facts } = exportGameGlb({ bodies: [{ name: "stray", positions, indices: [0, 1, 2] }], source: METRES, ...ALL_SOFT });
    expect(facts.bodies[0]!.vertices).toBe(3);
    expect(facts.bodies[0]!.bounds.meters.max).toEqual([1, 1, 0]);
  });

  it("copes with coordinates far too large for the tolerance to matter", () => {
    const positions = twoTriangles(0).map((value) => value * 1e20);
    const { facts } = exportGameGlb({ bodies: [{ name: "huge", positions }], source: METRES, ...ALL_SOFT });
    expect(facts.bodies[0]).toMatchObject({ vertices: 4, triangles: 2 });
  });
});
