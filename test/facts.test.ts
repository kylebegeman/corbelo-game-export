import { describe, expect, it } from "vitest";
import { ENGINE_PROFILES, exportGameGlb, EXTRAS_KEY, GENERATOR, readGlb, readPack, type PackBody, type PackExtras } from "../src/index.js";
import { box, chamferedBlock, cylinder, MM_Z_UP } from "./fixtures.js";

const block = chamferedBlock([1000, 500, 250], 20);

/** Counts triangles, vertices, bounds and edge kinds straight from what a GLB holds. */
function measure(body: PackBody) {
  const key = (vertex: number) => [0, 1, 2].map((axis) => body.positions[vertex * 3 + axis]! + 0).join(",");
  const uses = new Map<string, number>();
  for (let corner = 0; corner < body.indices.length; corner += 3) {
    for (let k = 0; k < 3; k += 1) {
      const pair = [key(body.indices[corner + k]!), key(body.indices[corner + ((k + 1) % 3)]!)].sort().join("|");
      uses.set(pair, (uses.get(pair) ?? 0) + 1);
    }
  }
  const axis = (at: number) => body.positions.filter((_, index) => index % 3 === at);
  return {
    triangles: body.indices.length / 3,
    vertices: body.positions.length / 3,
    openEdges: [...uses.values()].filter((count) => count === 1).length,
    nonManifoldEdges: [...uses.values()].filter((count) => count > 2).length,
    min: [0, 1, 2].map((at) => Math.min(...axis(at)) + body.translation[at]!),
    max: [0, 1, 2].map((at) => Math.max(...axis(at)) + body.translation[at]!),
  };
}

describe("facts", () => {
  it("counts a closed chamfered block", () => {
    const { facts } = exportGameGlb({ bodies: [{ name: "block", positions: block.positions }], source: MM_Z_UP });
    expect(facts.bodies[0]).toMatchObject({
      triangles: 44,
      vertices: 96,
      materialSlots: 1,
      degenerateTrianglesDropped: 0,
      openEdges: 0,
      nonManifoldEdges: 0,
    });
    expect(facts.total).toMatchObject({ bodies: 1, triangles: 44, vertices: 96, materialSlots: 1, degenerateTrianglesDropped: 0, openEdges: 0, nonManifoldEdges: 0 });
    expect(facts.bodies[0]!.bounds.meters).toEqual({ min: [-0.5, 0, -0.25], max: [0.5, 0.25, 0.25], size: [1, 0.25, 0.5] });
  });

  it("matches what the written file holds, for every fixture and setting", () => {
    const cases = [
      exportGameGlb({ bodies: [{ name: "block", positions: block.positions, faceIds: block.faceIds }], source: MM_Z_UP }),
      exportGameGlb({ bodies: [{ name: "cylinder", positions: cylinder(150, 400, 48).positions }], source: MM_Z_UP, normals: "face-weighted" }),
      exportGameGlb({
        bodies: [
          { name: "a", positions: box([0, 0, 0], [100, 100, 100]).positions },
          { name: "b", positions: box([300, 0, 0], [400, 50, 20]).positions.slice(0, 81) },
        ],
        source: MM_Z_UP,
        placement: "designed",
        pivot: "center",
      }),
    ];
    for (const { glb, facts } of cases) {
      const pack = readPack(glb);
      expect(pack.bodies).toHaveLength(facts.bodies.length);
      pack.bodies.forEach((body, index) => {
        const measured = measure(body);
        const stated = facts.bodies[index]!;
        expect(stated).toMatchObject({ triangles: measured.triangles, vertices: measured.vertices, openEdges: measured.openEdges, nonManifoldEdges: measured.nonManifoldEdges });
        expect(stated.bounds.meters.min).toEqual(measured.min);
        expect(stated.bounds.meters.max).toEqual(measured.max);
      });
    }
  });

  it("counts open edges", () => {
    // A box with its last face left out has four open edges.
    const open = box([0, 0, 0], [1, 1, 1]).positions.slice(0, 5 * 18);
    const { facts } = exportGameGlb({ bodies: [{ name: "open", positions: open }], source: { unit: 1, up: "Y" } });
    expect(facts.bodies[0]).toMatchObject({ triangles: 10, openEdges: 4, nonManifoldEdges: 0 });
  });

  it("counts edges shared by more than two triangles", () => {
    // A fin standing on one edge of a closed box: that edge now has three triangles.
    const fin = [0, 0, 0, 1, 0, 0, 0.5, -1, -1];
    const { facts } = exportGameGlb({ bodies: [{ name: "fin", positions: [...box([0, 0, 0], [1, 1, 1]).positions, ...fin] }], source: { unit: 1, up: "Y" } });
    expect(facts.bodies[0]).toMatchObject({ triangles: 13, nonManifoldEdges: 1, openEdges: 2 });
  });

  it("drops triangles without area and says how many", () => {
    const repeated = [0, 0, 0, 0, 0, 0, 1, 1, 1];
    const onOneLine = [0, 0, 0, 1, 0, 0, 2, 0, 0];
    const { glb, facts } = exportGameGlb({
      bodies: [{ name: "box", positions: [...repeated, ...box([0, 0, 0], [1, 1, 1]).positions, ...onOneLine] }],
      source: { unit: 1, up: "Y" },
    });
    expect(facts.bodies[0]).toMatchObject({ triangles: 12, degenerateTrianglesDropped: 2, openEdges: 0 });
    expect(facts.total.degenerateTrianglesDropped).toBe(2);
    expect(readPack(glb).bodies[0]!.indices).toHaveLength(36);
    // The dropped triangles do not stretch the bounds either.
    expect(facts.bodies[0]!.bounds.meters.size).toEqual([1, 1, 1]);
  });

  it("keeps face ids lined up with triangles when some are dropped", () => {
    const shape = cylinder(1, 2, 8);
    const positions = [0, 0, 0, 0, 0, 0, 1, 1, 1, ...shape.positions];
    const { facts } = exportGameGlb({ bodies: [{ name: "c", positions, faceIds: [99, ...shape.faceIds] }], source: { unit: 1, up: "Z" } });
    expect(facts.bodies[0]).toMatchObject({ vertices: 2 * 8 + 2 * 9, degenerateTrianglesDropped: 1 });
  });

  it("adds bodies up and joins their bounds", () => {
    const { facts } = exportGameGlb({
      bodies: [
        { name: "a", positions: box([0, 0, 0], [100, 100, 100]).positions, color: "#ff0000" },
        { name: "b", positions: box([300, 0, 0], [400, 50, 20]).positions, color: "#0000ff" },
      ],
      source: MM_Z_UP,
      placement: "designed",
    });
    expect(facts.total).toMatchObject({ bodies: 2, triangles: 24, vertices: 48, materialSlots: 2 });
    expect(facts.total.bounds.meters.size[0]).toBeCloseTo(0.4, 6);
    expect(facts.total.bounds.meters.size[1]).toBeCloseTo(0.1, 6);
    expect(facts.total.bounds.meters.size[2]).toBeCloseTo(0.1, 6);
    expect(facts.bodies.map((body) => [body.node, body.mesh])).toEqual([[0, 0], [1, 1]]);
  });

  it("records the settings used", () => {
    const { facts } = exportGameGlb({ bodies: [{ name: "block", positions: block.positions, faceIds: block.faceIds }], source: MM_Z_UP, creaseAngle: 45, normals: "face-weighted" });
    expect(facts.schema).toBe(1);
    expect(facts.generator).toBe(GENERATOR);
    expect(facts.source).toEqual({ unit: 0.001, up: "Z", handedness: "right" });
    expect(facts.settings).toEqual({ pivot: "base-center", placement: "origin", creaseAngle: 45, normals: "face-weighted", weldTolerance: 1e-6, faceIds: true });
  });
});

describe("engine profiles", () => {
  it("reports metres with Y up for Godot and Unity", () => {
    for (const profile of ["godot4", "unity6"] as const) {
      const { facts } = exportGameGlb({ bodies: [{ name: "block", positions: block.positions }], source: MM_Z_UP, profile });
      expect(facts.profile).toBe(profile);
      expect(facts.engine).toEqual({ unit: "m", unitMeters: 1, up: "Y" });
      expect(facts.total.bounds.engine).toEqual(facts.total.bounds.meters);
    }
  });

  it("reports centimetres with Z up for Unreal", () => {
    const { facts } = exportGameGlb({ bodies: [{ name: "block", positions: block.positions }], source: MM_Z_UP, profile: "unreal5", placement: "designed" });
    expect(facts.engine).toEqual({ unit: "cm", unitMeters: 0.01, up: "Z" });
    expect(facts.total.bounds.engine.size).toEqual([100, 50, 25]);
    expect(facts.bodies[0]!.localBounds.engine.min).toEqual([-50, -25, 0]);
    // The pivot is at source (500, 250, 0) mm: glTF (0.5, 0, -0.25) m, so (50, -25, 0) cm with Z up.
    expect(facts.bodies[0]!.pivot.engine).toEqual([50, -25, 0]);
    // The file itself stays in metres with Y up whatever the profile is.
    expect(facts.total.bounds.meters.size).toEqual([1, 0.25, 0.5]);
  });

  it("writes the same geometry for every profile", () => {
    const bodies = [{ name: "block", positions: block.positions }];
    const godot = readPack(exportGameGlb({ bodies, source: MM_Z_UP, profile: "godot4" }).glb).bodies[0]!;
    const unreal = readPack(exportGameGlb({ bodies, source: MM_Z_UP, profile: "unreal5" }).glb).bodies[0]!;
    expect(unreal.positions).toEqual(godot.positions);
    expect(unreal.normals).toEqual(godot.normals);
    expect(unreal.indices).toEqual(godot.indices);
  });

  it("records the node names each engine reads, as data", () => {
    expect(ENGINE_PROFILES.godot4.conventions.collision.map((rule) => rule.text)).toEqual(["-col", "-convcol", "-colonly", "-convcolonly"]);
    expect(ENGINE_PROFILES.godot4.conventions.collision.every((rule) => rule.affix === "suffix")).toBe(true);
    expect(ENGINE_PROFILES.godot4.conventions.collision[0]).toMatchObject({ role: "collision-trimesh", pattern: "{name}-col" });
    expect(ENGINE_PROFILES.unreal5.conventions.collision.map((rule) => rule.text)).toEqual(["UCX_", "UBX_", "USP_", "UCP_"]);
    expect(ENGINE_PROFILES.unreal5.conventions.collision[0]).toMatchObject({ role: "collision-convex", affix: "prefix", pattern: "UCX_{name}_{nn}" });
    expect(ENGINE_PROFILES.unreal5.conventions.lod[0]).toMatchObject({ pattern: "{name}_LOD{n}" });
    expect(ENGINE_PROFILES.unity6.conventions.lod[0]).toMatchObject({ pattern: "{name}_LOD{n}" });
    expect(ENGINE_PROFILES.unity6.conventions.collision).toEqual([]);
  });

  it("accepts a custom profile", () => {
    const profile = { id: "inches", name: "Inches", unit: "in", unitMeters: 0.0254, up: "Y" as const, conventions: { collision: [], lod: [] } };
    const { facts } = exportGameGlb({ bodies: [{ name: "inch", positions: box([0, 0, 0], [1, 2, 3]).positions }], source: { unit: 0.0254, up: "Y" }, profile });
    expect(facts.profile).toBe("inches");
    facts.total.bounds.engine.size.forEach((value, axis) => expect(value).toBeCloseTo(axis + 1, 5));
  });
});

describe("scene extras", () => {
  it("holds the profile, the facts and the caller's provenance", () => {
    const provenance = { model: "bracket", revision: 7, tags: ["a", "b"], nested: { exact: true, note: null } };
    const { glb, facts } = exportGameGlb({ bodies: [{ name: "block", positions: block.positions }], source: MM_Z_UP, profile: "unreal5", provenance });
    const { json } = readGlb(glb);
    expect(json.asset).toEqual({ version: "2.0", generator: GENERATOR });
    const extras = json.scenes![0]!.extras![EXTRAS_KEY] as PackExtras;
    expect(extras.schema).toBe(1);
    expect(extras.profile).toEqual(ENGINE_PROFILES.unreal5);
    expect(extras.facts).toEqual(facts);
    expect(extras.provenance).toEqual(provenance);
    const pack = readPack(glb);
    expect(pack.facts).toEqual(facts);
    expect(pack.profile).toEqual(ENGINE_PROFILES.unreal5);
    expect(pack.provenance).toEqual(provenance);
    expect(pack.generator).toBe(GENERATOR);
  });

  it("leaves provenance out when none is given", () => {
    const { glb } = exportGameGlb({ bodies: [{ name: "block", positions: block.positions }], source: MM_Z_UP });
    expect(readGlb(glb).json.scenes![0]!.extras![EXTRAS_KEY]).not.toHaveProperty("provenance");
    expect(readPack(glb).provenance).toBeNull();
  });
});
