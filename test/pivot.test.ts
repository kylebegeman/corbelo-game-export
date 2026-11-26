import { describe, expect, it } from "vitest";
import { exportGameGlb, readGlb, readPack, type ExportOptions } from "../src/index.js";
import { box, MM_Z_UP } from "./fixtures.js";

// A 1000 x 500 x 250 mm block away from the origin. In glTF space it spans
// x 0.1..1.1, y 0.3..0.55 and z -0.7..-0.2.
const block = box([100, 200, 300], [1100, 700, 550]);

function run(options: ExportOptions) {
  const result = exportGameGlb({ bodies: [{ name: "block", positions: block.positions }], source: MM_Z_UP, ...options });
  return { ...result, facts: result.facts.bodies[0]!, body: readPack(result.glb).bodies[0]! };
}

function near(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, at) => expect(actual[at]).toBeCloseTo(value, 6));
}

describe("pivot", () => {
  it("defaults to the centre of the footprint at the lowest point", () => {
    const { facts } = run({});
    expect(facts.pivot.mode).toBe("base-center");
    near(facts.pivot.meters, [0.6, 0.3, -0.45]);
    near(facts.pivot.source, [600, 450, 300]);
    near(facts.localBounds.meters.min, [-0.5, 0, -0.25]);
    near(facts.localBounds.meters.max, [0.5, 0.25, 0.25]);
  });

  it("can sit at the centre of the body", () => {
    const { facts } = run({ pivot: "center" });
    near(facts.pivot.meters, [0.6, 0.425, -0.45]);
    near(facts.localBounds.meters.min, [-0.5, -0.125, -0.25]);
  });

  it("can sit at the corner with the lowest source coordinates", () => {
    const { facts } = run({ pivot: "min-corner" });
    near(facts.pivot.source, [100, 200, 300]);
    near(facts.pivot.meters, [0.1, 0.3, -0.2]);
    near(facts.localBounds.meters.min, [0, 0, -0.5]);
    near(facts.localBounds.meters.max, [1, 0.25, 0]);
  });

  it("can keep the source origin", () => {
    const { facts } = run({ pivot: "origin" });
    expect(facts.pivot.meters).toEqual([0, 0, 0]);
    near(facts.localBounds.meters.min, [0.1, 0.3, -0.7]);
    near(facts.localBounds.meters.max, [1.1, 0.55, -0.2]);
  });

  it("takes an explicit point in source units and axes", () => {
    const { facts } = run({ pivot: [600, 450, 300] });
    expect(facts.pivot.mode).toBe("point");
    near(facts.pivot.meters, [0.6, 0.3, -0.45]);
    near(facts.localBounds.meters.min, [-0.5, 0, -0.25]);
  });

  it("stores vertex data relative to the pivot", () => {
    const { body, facts } = run({});
    const xs = body.positions.filter((_, at) => at % 3 === 0);
    const ys = body.positions.filter((_, at) => at % 3 === 1);
    expect(Math.min(...xs)).toBeCloseTo(-0.5, 6);
    expect(Math.min(...ys)).toBe(0);
    expect(facts.localBounds.meters.min[0]).toBe(Math.min(...xs));
  });
});

describe("placement", () => {
  it("leaves the node at the origin by default", () => {
    const { glb, facts } = run({});
    expect(readGlb(glb).json.nodes![0]).not.toHaveProperty("translation");
    expect(facts.translation).toEqual([0, 0, 0]);
    expect(facts.bounds).toEqual(facts.localBounds);
  });

  it("can keep the body where it was designed", () => {
    const { glb, facts, body } = run({ placement: "designed" });
    near(readGlb(glb).json.nodes![0]!.translation!, [0.6, 0.3, -0.45]);
    near(body.translation, [0.6, 0.3, -0.45]);
    near(facts.translation, facts.pivot.meters);
    near(facts.bounds.meters.min, [0.1, 0.3, -0.7]);
    near(facts.bounds.meters.max, [1.1, 0.55, -0.2]);
    near(facts.localBounds.meters.min, [-0.5, 0, -0.25]);
  });

  it("can stand a set of bodies on the origin as one thing", () => {
    // A seat away from the origin with a leg under one corner. In glTF space the seat spans
    // x 2.0..2.4, y 0.4..0.45, z -3.4..-3.0 and the leg x 2.0..2.05, y 0..0.4, z -3.05..-3.0.
    const seat = box([2000, 3000, 400], [2400, 3400, 450]);
    const leg = box([2000, 3000, 0], [2050, 3050, 400]);
    const result = exportGameGlb({
      bodies: [
        { name: "seat", positions: seat.positions },
        { name: "leg", positions: leg.positions },
      ],
      source: MM_Z_UP,
      placement: "assembly",
    });
    const { facts } = result;
    // The set's pivot: centre of the footprint of both bodies, at the lowest point of either.
    expect(facts.assemblyPivot!.mode).toBe("base-center");
    near(facts.assemblyPivot!.meters, [2.2, 0, -3.2]);
    near(facts.assemblyPivot!.source, [2200, 3200, 0]);
    // The whole set stands on the scene origin.
    near(facts.total.bounds.meters.min, [-0.2, 0, -0.2]);
    near(facts.total.bounds.meters.max, [0.2, 0.45, 0.2]);
    // Each body keeps its own pivot and its place relative to the other.
    const [seatFacts, legFacts] = facts.bodies;
    near(seatFacts!.translation, [0, 0.4, 0]);
    near(legFacts!.translation, [-0.175, 0, 0.175]);
    near(seatFacts!.localBounds.meters.min, [-0.2, 0, -0.2]);
    near(legFacts!.bounds.meters.min, [-0.2, 0, 0.15]);
    near(legFacts!.bounds.meters.max, [-0.15, 0.4, 0.2]);
    const nodes = readGlb(result.glb).json.nodes!;
    expect(nodes[0]).toHaveProperty("translation");
    near(nodes[1]!.translation!, [-0.175, 0, 0.175]);
    // The same bodies as designed differ from the assembly by exactly the set's pivot.
    const designed = exportGameGlb({ bodies: [{ name: "seat", positions: seat.positions }, { name: "leg", positions: leg.positions }], source: MM_Z_UP, placement: "designed" });
    expect(designed.facts.assemblyPivot).toBeUndefined();
    designed.facts.bodies.forEach((body, at) => {
      near(body.translation, [0, 1, 2].map((axis) => facts.bodies[at]!.translation[axis]! + facts.assemblyPivot!.meters[axis]!));
    });
  });

  it("treats an assembly of one body like a body at the origin, and an origin pivot like the design", () => {
    const one = run({ placement: "assembly" });
    expect(readGlb(one.glb).json.nodes![0]).not.toHaveProperty("translation");
    expect(one.facts.translation).toEqual([0, 0, 0]);
    const kept = run({ placement: "assembly", pivot: "origin" });
    near(kept.facts.bounds.meters.min, [0.1, 0.3, -0.7]);
  });

  it("writes no translation when the pivot is the source origin", () => {
    const { glb, facts } = run({ placement: "designed", pivot: "origin" });
    expect(readGlb(glb).json.nodes![0]).not.toHaveProperty("translation");
    near(facts.bounds.meters.min, [0.1, 0.3, -0.7]);
  });
});
