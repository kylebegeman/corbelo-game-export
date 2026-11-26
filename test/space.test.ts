import { describe, expect, it } from "vitest";
import { exportGameGlb, readPack, type SourceSpace } from "../src/index.js";
import { box, chamferedBlock, MM_Z_UP, signedVolume } from "./fixtures.js";

/** Exports one triangle with the pivot at the source origin and returns where its corners went. */
function convert(source: SourceSpace, point: [number, number, number]): number[] {
  const positions = [...point, point[0] + 1, point[1], point[2], point[0], point[1] + 1, point[2]];
  const { glb } = exportGameGlb({ bodies: [{ name: "t", positions }], source, pivot: "origin" });
  return [...readPack(glb).bodies[0]!.positions.slice(0, 3)];
}

describe("source space", () => {
  it("keeps a right-handed Y-up source as it is, scaled to metres", () => {
    expect(convert({ unit: 1, up: "Y" }, [1, 2, 3])).toEqual([1, 2, 3]);
    expect(convert({ unit: 0.5, up: "Y" }, [1, 2, 3])).toEqual([0.5, 1, 1.5]);
  });

  it("turns a right-handed Z-up source so Z becomes up and Y points away", () => {
    expect(convert({ unit: 1, up: "Z" }, [1, 2, 3])).toEqual([1, 3, -2]);
  });

  it("mirrors a left-handed source", () => {
    expect(convert({ unit: 1, up: "Y", handedness: "left" }, [1, 2, 3])).toEqual([1, 2, -3]);
    expect(convert({ unit: 1, up: "Z", handedness: "left" }, [1, 2, 3])).toEqual([1, 3, 2]);
  });

  it("reports a 1000 x 500 x 250 mm Z-up block as 1.0 x 0.25 x 0.5 m with Y up", () => {
    const { facts } = exportGameGlb({ bodies: [{ name: "block", positions: chamferedBlock([1000, 500, 250], 20).positions }], source: MM_Z_UP });
    expect(facts.total.bounds.meters.size).toEqual([1, 0.25, 0.5]);
  });

  it("converts inches", () => {
    const { facts } = exportGameGlb({ bodies: [{ name: "inch", positions: box([0, 0, 0], [10, 20, 40]).positions }], source: { unit: 0.0254, up: "Y" } });
    const size = facts.total.bounds.meters.size;
    expect(size[0]).toBeCloseTo(0.254, 6);
    expect(size[1]).toBeCloseTo(0.508, 6);
    expect(size[2]).toBeCloseTo(1.016, 6);
  });
});

describe("winding", () => {
  const shape = chamferedBlock([1000, 500, 250], 40);
  const sourceVolume = signedVolume(shape.positions);
  const spaces: SourceSpace[] = [
    { unit: 0.001, up: "Y" },
    { unit: 0.001, up: "Z" },
    { unit: 0.001, up: "Y", handedness: "left" },
    { unit: 0.001, up: "Z", handedness: "left" },
  ];

  it("starts from a block whose faces point outwards", () => {
    expect(sourceVolume).toBeGreaterThan(0);
  });

  for (const source of spaces) {
    const label = `${source.handedness ?? "right"}-handed ${source.up}-up`;

    it(`keeps the signed volume positive from a ${label} source`, () => {
      const { glb } = exportGameGlb({ bodies: [{ name: "block", positions: shape.positions }], source });
      const body = readPack(glb).bodies[0]!;
      const volume = signedVolume(body.positions, body.indices);
      expect(volume).toBeGreaterThan(0);
      expect(volume).toBeCloseTo(sourceVolume * 1e-9, 6);
    });

    it(`keeps normals pointing outwards from a ${label} source`, () => {
      const { glb } = exportGameGlb({ bodies: [{ name: "block", positions: shape.positions }], source, pivot: "center" });
      const body = readPack(glb).bodies[0]!;
      for (let at = 0; at < body.positions.length; at += 3) {
        const outward = body.positions[at]! * body.normals[at]! + body.positions[at + 1]! * body.normals[at + 1]! + body.positions[at + 2]! * body.normals[at + 2]!;
        expect(outward).toBeGreaterThan(0);
      }
    });
  }
});
