import { describe, expect, it } from "vitest";
import { DEVIATION_MAX_SAMPLES, meshDeviation } from "../src/index.js";
import { box, cylinder, moved } from "./fixtures.js";

/** A soup of triangles as positions and indices. */
function soup(positions: Float32Array): [Float32Array, Uint32Array] {
  return [positions, Uint32Array.from({ length: positions.length / 3 }, (_, at) => at)];
}

describe("how far a detail level is from the full one", () => {
  it("is zero for the same surface, also when it is cut into other triangles", () => {
    const a = box([0, 0, 0], [2, 1, 1]);
    expect(meshDeviation(...soup(a.positions), ...soup(a.positions))).toBeCloseTo(0, 9);
    // The same box with each side cut along its other diagonal.
    const turnedPositions = Float32Array.from(a.positions);
    for (let quad = 0; quad < turnedPositions.length; quad += 18) {
      const corner = (at: number) => [...a.positions.subarray(quad + at * 3, quad + at * 3 + 3)];
      // Two triangles (p0, p1, p2) and (p0, p2, p3) become (p0, p1, p3) and (p1, p2, p3).
      turnedPositions.set([...corner(0), ...corner(1), ...corner(5), ...corner(1), ...corner(2), ...corner(5)], quad);
    }
    expect(meshDeviation(...soup(a.positions), ...soup(turnedPositions))).toBeCloseTo(0, 9);
  });

  it("is the distance a mesh was moved, for a small move", () => {
    const a = box([0, 0, 0], [2, 1, 1]);
    expect(meshDeviation(...soup(a.positions), ...soup(moved(a, [0.01, 0, 0]).positions))).toBeCloseTo(0.01, 6);
    expect(meshDeviation(...soup(a.positions), ...soup(moved(a, [0, 0, -0.25]).positions))).toBeCloseTo(0.25, 6);
  });

  it("is how far the flat sides of a round shape with fewer sides sit inside the round one", () => {
    // A cylinder of radius r with n sides has the middle of each side r * (1 - cos(pi / n)) inside the circle.
    const radius = 150;
    const full = cylinder(radius, 400, 96);
    for (const sides of [48, 24, 12, 6]) {
      const lower = cylinder(radius, 400, sides);
      const sagitta = radius * (1 - Math.cos(Math.PI / sides));
      const measured = meshDeviation(...soup(full.positions), ...soup(lower.positions));
      // The full one has flat sides of its own, a little inside the circle too, and its corners
      // are on the circle: the measure lies between the two.
      const own = radius * (1 - Math.cos(Math.PI / 96));
      expect(measured).toBeGreaterThan(sagitta - own - 1e-3);
      expect(measured).toBeLessThanOrEqual(sagitta + 1e-3);
    }
  });

  it("is the same whichever mesh comes first", () => {
    const [a, b] = [cylinder(150, 400, 48), cylinder(150, 400, 8)];
    expect(meshDeviation(...soup(a.positions), ...soup(b.positions))).toBe(meshDeviation(...soup(b.positions), ...soup(a.positions)));
  });

  it("sees a part that is gone from the lower level", () => {
    // A box with a small box on top, against the box alone: the top of the small box is its height away.
    const base = box([0, 0, 0], [1, 1, 1]);
    const knob = box([0.4, 0.4, 1], [0.6, 0.6, 1.3]);
    const both = new Float32Array(base.positions.length + knob.positions.length);
    both.set(base.positions);
    both.set(knob.positions, base.positions.length);
    expect(meshDeviation(...soup(both), ...soup(base.positions))).toBeCloseTo(0.3, 6);
  });

  it("is zero against an empty mesh, and measures a large mesh at a sample of its points", () => {
    const a = box([0, 0, 0], [1, 1, 1]);
    expect(meshDeviation(...soup(a.positions), new Float32Array(0), new Uint32Array(0))).toBe(0);
    expect(DEVIATION_MAX_SAMPLES).toBe(20_000);
    // With one sample in three the answer is still the move: every corner is as far.
    const [full, lower] = [cylinder(150, 400, 64), moved(cylinder(150, 400, 64), [0, 0, 5])];
    expect(meshDeviation(...soup(full.positions), ...soup(lower.positions), 100)).toBeCloseTo(5, 4);
  });
});
