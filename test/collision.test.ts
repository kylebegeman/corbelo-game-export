import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_COLLISION_TOLERANCE,
  DEFAULT_MAX_COLLISION_PIECES,
  DEFAULT_MAX_HULL_VERTICES,
  exportGameAsset,
  GameExportError,
  meshVolume,
  readAccessor,
  readGlb,
  type AssetInput,
  type CollisionFacts,
  type CollisionKernel,
  type GameExportErrorCode,
} from "../src/index.js";
import { box, chamferedBlock, cylinder, doorFrame, ell, fold, MM_Z_UP, tube } from "./fixtures.js";
import { counting, loadKernel } from "./kernel.js";

let kernel: CollisionKernel;
beforeAll(async () => {
  kernel = await loadKernel();
});

function collisionOf(input: Omit<AssetInput, "source">): CollisionFacts {
  return exportGameAsset({ ...input, source: MM_Z_UP }).facts.bodies[0]!.collision!;
}

function refusal(run: () => unknown): { code: GameExportErrorCode; message: string; body?: number } {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GameExportError);
    const refused = error as GameExportError;
    return { code: refused.code, message: refused.message, ...(refused.body !== undefined ? { body: refused.body } : {}) };
  }
  throw new Error("Expected a refusal.");
}

const crate = box([0, 0, 0], [1000, 500, 250]);
const block = chamferedBlock([1000, 500, 250], 20);
const frame = doorFrame(3000, 300, 2800, 1200, 2200);
const framePieces = [box([0, 0, 0], [900, 300, 2800]), box([2100, 0, 0], [3000, 300, 2800]), box([900, 0, 2200], [2100, 300, 2800])];

describe("collision tiers", () => {
  it("takes one box for a box, the cheapest shape there is", () => {
    const facts = collisionOf({ bodies: [{ name: "Crate", positions: crate.positions }] });
    expect(facts).toMatchObject({ requested: "auto", shape: "box", pieces: 1, tolerance: DEFAULT_COLLISION_TOLERANCE, withinTolerance: true, notes: [] });
    expect(facts.volume.visible).toBeCloseTo(0.125, 9);
    expect(facts.volume.collision).toBeCloseTo(0.125, 9);
    expect(facts.volume.error).toBeCloseTo(0, 9);
    // Auto stops at the first tier that is near enough.
    expect(facts.tried.map((tier) => tier.shape)).toEqual(["box"]);
    expect(facts.nodes).toHaveLength(1);
    expect(facts.nodes[0]).toMatchObject({ kind: "box", vertices: 8, triangles: 12, capped: false });
  });

  it("takes the box for a block whose chamfers are within the tolerance, and the hull when they are not", () => {
    // Chamfers of 20 on a block of 1000 by 500 by 250 take off about one percent.
    const loose = collisionOf({ bodies: [{ name: "Block", positions: block.positions }] });
    expect(loose.shape).toBe("box");
    expect(loose.volume.error).toBeGreaterThan(0);
    expect(loose.volume.error).toBeLessThan(0.02);

    const tight = collisionOf({ bodies: [{ name: "Block", positions: block.positions }], collision: { tolerance: 0.0001 } });
    expect(tight.tried.map((tier) => tier.shape)).toEqual(["box", "hull"]);
    expect(tight.tried[0]!.withinTolerance).toBe(false);
    expect(tight.shape).toBe("hull");
    // The block is convex, so its hull is the block.
    expect(tight.volume.error).toBeCloseTo(0, 6);
    expect(tight.nodes[0]).toMatchObject({ kind: "convex", vertices: 24, capped: false });
  });

  it("takes the hull for a round post, whose box is a quarter too large", () => {
    const facts = collisionOf({ bodies: [{ name: "Post", positions: cylinder(150, 400, 24).positions }] });
    expect(facts.tried[0]).toMatchObject({ shape: "box", withinTolerance: false });
    expect(facts.tried[0]!.error).toBeGreaterThan(0.2);
    expect(facts).toMatchObject({ shape: "hull", pieces: 1, withinTolerance: true });
    expect(facts.nodes[0]!.vertices).toBe(48);
  });

  it("stops a hull at the most corners allowed, and says so", () => {
    const facts = collisionOf({ bodies: [{ name: "Post", positions: cylinder(150, 400, 48).positions }] });
    expect(facts.nodes[0]).toMatchObject({ vertices: DEFAULT_MAX_HULL_VERTICES, capped: true });
    // A capped hull lies inside the body, so it has a little less volume.
    expect(facts.volume.error).toBeLessThan(0);
    expect(facts.withinTolerance).toBe(true);

    const few = collisionOf({ bodies: [{ name: "Post", positions: cylinder(150, 400, 48).positions }], collision: { shape: "hull", maxHullVertices: 12 } });
    expect(few.nodes[0]).toMatchObject({ vertices: 12, capped: true });
    const all = collisionOf({ bodies: [{ name: "Post", positions: cylinder(150, 400, 48).positions }], collision: { shape: "hull", maxHullVertices: 200 } });
    expect(all.nodes[0]).toMatchObject({ vertices: 96, capped: false });
    expect(all.volume.error).toBeCloseTo(0, 6);
  });

  it("uses the pieces the body was made from when the hull fills a hole", () => {
    const facts = collisionOf({ bodies: [{ name: "Frame", positions: frame.positions, collisionPieces: framePieces.map((piece) => ({ positions: piece.positions })) }] });
    expect(facts.tried.map((tier) => [tier.shape, tier.pieces, tier.withinTolerance])).toEqual([
      ["box", 1, false],
      ["hull", 1, false],
      ["pieces", 3, true],
    ]);
    // The hull of a door frame fills the door: 3 by 0.3 by 2.8 against 1.728 of frame.
    expect(facts.tried[1]!.error).toBeCloseTo(2.52 / 1.728 - 1, 5);
    expect(facts).toMatchObject({ shape: "pieces", pieces: 3, withinTolerance: true });
    expect(facts.volume.visible).toBeCloseTo(1.728, 6);
    expect(facts.volume.collision).toBeCloseTo(1.728, 6);
    expect(facts.nodes.map((node) => node.volume).map((volume) => Math.round(volume * 1000) / 1000)).toEqual([0.756, 0.756, 0.216]);
  });

  it("makes each piece given convex: only its points count", () => {
    // An L given as a piece becomes the hull of the L.
    const piece = ell(1000, 500);
    const facts = collisionOf({ bodies: [{ name: "Ell", positions: piece.positions, collisionPieces: [{ positions: piece.positions }] }], collision: "pieces" });
    expect(facts.pieces).toBe(1);
    expect(facts.volume.collision).toBeCloseTo(0.4375, 6);
    expect(facts.volume.error).toBeCloseTo(1 / 6, 6);
    expect(facts.withinTolerance).toBe(false);
  });

  it("decomposes what is left with a kernel: an L into two boxes, a door frame into three", () => {
    const counted = counting(kernel);
    const corner = collisionOf({ bodies: [{ name: "Ell", positions: ell(1000, 500).positions }], kernel: counted.kernel });
    expect(corner.tried.map((tier) => tier.shape)).toEqual(["box", "hull", "decomposition"]);
    expect(corner.tried[0]!.error).toBeCloseTo(1 / 3, 6);
    expect(corner.tried[1]!.error).toBeCloseTo(1 / 6, 6);
    expect(corner).toMatchObject({ shape: "decomposition", pieces: 2, withinTolerance: true });
    expect(corner.volume.error).toBeCloseTo(0, 6);
    expect(corner.notes).toEqual(["No collision pieces were given for the body."]);
    // Every solid the package asked the kernel for was given back.
    expect(counted.made()).toBeGreaterThan(0);
    expect(counted.freed()).toBe(counted.made());

    const door = collisionOf({ bodies: [{ name: "Frame", positions: frame.positions }], kernel });
    expect(door).toMatchObject({ shape: "decomposition", pieces: 3, withinTolerance: true });
    expect(door.volume.collision).toBeCloseTo(1.728, 5);
    for (const node of door.nodes) expect(node).toMatchObject({ kind: "convex", vertices: 8, triangles: 12 });
  });

  it("stops a decomposition at the most pieces allowed and takes the nearest when nothing is near enough", () => {
    const pipe = tube(300, 250, 1000, 24).positions;
    const eight = collisionOf({ bodies: [{ name: "Pipe", positions: pipe }], kernel });
    expect(eight).toMatchObject({ shape: "decomposition", pieces: DEFAULT_MAX_COLLISION_PIECES, withinTolerance: false });
    expect(eight.notes).toContain("No tier is within the tolerance. The nearest was taken.");
    // Far nearer than the hull, which fills the bore.
    expect(eight.tried[1]!.error).toBeGreaterThan(2);
    expect(eight.volume.error).toBeLessThan(0.3);

    const many = collisionOf({ bodies: [{ name: "Pipe", positions: pipe }], kernel, collision: { maxPieces: 32 } });
    expect(many.withinTolerance).toBe(true);
    expect(many.pieces).toBeGreaterThan(8);
    expect(many.pieces).toBeLessThanOrEqual(32);
    expect(Math.abs(many.volume.error!)).toBeLessThanOrEqual(DEFAULT_COLLISION_TOLERANCE);
  });

  it("without a kernel or pieces, takes the nearer of the box and the hull and says what was missing", () => {
    const facts = collisionOf({ bodies: [{ name: "Ell", positions: ell(1000, 500).positions }] });
    expect(facts).toMatchObject({ shape: "hull", pieces: 1, withinTolerance: false });
    expect(facts.notes).toEqual([
      "No collision pieces were given for the body.",
      "No kernel was given, and a general convex decomposition needs one.",
      "No tier is within the tolerance. The nearest was taken.",
    ]);
  });

  it("builds the shape asked for by name, whatever its volume", () => {
    const post = cylinder(150, 400, 24).positions;
    const asBox = collisionOf({ bodies: [{ name: "Post", positions: post }], collision: "box" });
    expect(asBox).toMatchObject({ requested: "box", shape: "box", pieces: 1, withinTolerance: false });
    expect(asBox.tried).toHaveLength(1);
    const asHull = collisionOf({ bodies: [{ name: "Crate", positions: crate.positions }], collision: { shape: "hull" } });
    expect(asHull).toMatchObject({ requested: "hull", shape: "hull" });
    expect(asHull.nodes[0]!.kind).toBe("convex");
  });

  it("writes no collision for \"none\"", () => {
    const { glb, facts } = exportGameAsset({ bodies: [{ name: "Crate", positions: crate.positions }], source: MM_Z_UP, collision: "none" });
    expect(facts.bodies[0]).not.toHaveProperty("collision");
    expect(facts.settings.collision).toMatchObject({ shape: "none" });
    expect(readGlb(glb).json.nodes).toHaveLength(1);
  });

  it("gives a body that is not closed its hull, with no volume to compare", () => {
    // A fold of two faces encloses nothing.
    const facts = collisionOf({ bodies: [{ name: "Fold", positions: fold(60).positions }] });
    expect(facts).toMatchObject({ shape: "hull", pieces: 1, withinTolerance: null });
    expect(facts.volume).toMatchObject({ visible: null, error: null });
    expect(facts.notes).toEqual(["The body is not closed, so it has no volume to compare collision with."]);
  });

  it("refuses a shape that cannot be built, naming the body", () => {
    const noPieces = refusal(() => collisionOf({ bodies: [{ name: "Crate", positions: crate.positions }], collision: "pieces" }));
    expect(noPieces).toMatchObject({ code: "BAD_COLLISION", body: 0 });
    expect(noPieces.message).toBe('Body "Crate": collision "pieces" cannot be built. No collision pieces were given for the body.');
    const noKernel = refusal(() => collisionOf({ bodies: [{ name: "Crate", positions: crate.positions }], collision: "decomposition" }));
    expect(noKernel.message).toBe('Body "Crate": collision "decomposition" cannot be built. No kernel was given, and a general convex decomposition needs one.');
    const open = refusal(() => collisionOf({ bodies: [{ name: "Fold", positions: fold(60).positions }], collision: "decomposition", kernel }));
    expect(open.code).toBe("BAD_COLLISION");
    expect(open.message).toBe('Body "Fold": collision "decomposition" cannot be built. A general convex decomposition needs a closed body with a volume.');
  });

  it("refuses settings and pieces it cannot read", () => {
    const body = { name: "Crate", positions: crate.positions };
    expect(refusal(() => collisionOf({ bodies: [body], collision: "sphere" as never })).code).toBe("BAD_OPTION");
    expect(refusal(() => collisionOf({ bodies: [body], collision: { tolerance: -1 } })).code).toBe("BAD_OPTION");
    expect(refusal(() => collisionOf({ bodies: [body], collision: { maxPieces: 0 } })).code).toBe("BAD_OPTION");
    expect(refusal(() => collisionOf({ bodies: [body], collision: { maxHullVertices: 3 } })).code).toBe("BAD_OPTION");
    expect(refusal(() => collisionOf({ bodies: [body], kernel: {} as never })).code).toBe("BAD_OPTION");
    expect(refusal(() => collisionOf({ bodies: [{ ...body, collisionPieces: [{ positions: [0, 0, 0, 1, 1, 1] }] }] }))).toMatchObject({ code: "BAD_COLLISION", body: 0 });
    expect(refusal(() => collisionOf({ bodies: [{ ...body, collisionPieces: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, Number.NaN] }] }] })).code).toBe("BAD_COLLISION");
    // Four points in one plane have no hull.
    const flat = refusal(() => collisionOf({ bodies: [{ ...body, collisionPieces: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0] }] }], collision: "pieces" }));
    expect(flat.code).toBe("BAD_COLLISION");
  });

  it("turns a kernel's own failure into a refusal", () => {
    const broken: CollisionKernel = {
      solid: () => {
        throw new Error("not manifold");
      },
    };
    const refused = refusal(() => collisionOf({ bodies: [{ name: "Ell", positions: ell(1000, 500).positions }], collision: "decomposition", kernel: broken }));
    expect(refused.code).toBe("BAD_COLLISION");
    expect(refused.message).toContain("not manifold");
  });
});

describe("collision as written", () => {
  it("writes each piece as a mesh of positions only, with no material, as a child of its body", () => {
    const { glb, facts } = exportGameAsset({
      bodies: [{ name: "Frame", positions: frame.positions, collisionPieces: framePieces.map((piece) => ({ positions: piece.positions })) }],
      source: MM_Z_UP,
    });
    const document = readGlb(glb);
    const { nodes, meshes } = document.json;
    const collision = facts.bodies[0]!.collision!;
    expect(nodes![0]!.children).toEqual(collision.nodes.map((node) => node.node));
    for (const piece of collision.nodes) {
      const node = nodes![piece.node]!;
      expect(node.name).toBe(piece.name);
      expect(node.mesh).toBe(piece.mesh);
      expect(node.translation).toBeUndefined();
      const mesh = meshes![piece.mesh]!;
      expect(mesh.name).toBe(piece.name);
      expect(mesh.primitives).toHaveLength(1);
      expect(Object.keys(mesh.primitives[0]!.attributes)).toEqual(["POSITION"]);
      expect(mesh.primitives[0]!.material).toBeUndefined();
      // Closed, facing outwards and the volume the facts say.
      const positions = readAccessor(document, mesh.primitives[0]!.attributes["POSITION"]!);
      const indices = readAccessor(document, mesh.primitives[0]!.indices!);
      expect(positions.length / 3).toBe(piece.vertices);
      expect(indices.length / 3).toBe(piece.triangles);
      expect(meshVolume(positions, indices)).toBeCloseTo(piece.volume, 6);
    }
    // The pieces sit where the body sits: around its pivot at the middle of its base.
    expect(collision.nodes[0]!.bounds.meters.min.map((value) => Math.round(value * 1000) / 1000)).toEqual([-1.5, 0, -0.15]);
    expect(collision.nodes[2]!.bounds.meters.size.map((value) => Math.round(value * 1000) / 1000)).toEqual([1.2, 0.6, 0.3]);
  });

  it("names the nodes the way each engine reads them", () => {
    const names = (profile: AssetInput["profile"], positions: Float32Array) =>
      exportGameAsset({ bodies: [{ name: "Crate", positions }], source: MM_Z_UP, profile }).facts.bodies[0]!.collision!.nodes.map((node) => [node.name, node.role]);
    const post = cylinder(150, 400, 24).positions;
    // Godot builds a convex shape from a mesh whose name ends -convcolonly, and has no ending for a box.
    expect(names("godot4", crate.positions)).toEqual([["Crate_00-convcolonly", "collision-convex-only"]]);
    expect(names("godot4", post)).toEqual([["Crate_00-convcolonly", "collision-convex-only"]]);
    // Unreal reads UBX_ as a box and UCX_ as a convex shape.
    expect(names("unreal5", crate.positions)).toEqual([["UBX_Crate_00", "collision-box"]]);
    expect(names("unreal5", post)).toEqual([["UCX_Crate_00", "collision-convex"]]);
    // Unity reads no names: the nodes get plain, stable ones.
    expect(names("unity6", crate.positions)).toEqual([["Crate_collision_00", null]]);
    // A profile of the caller's own, by its own pattern.
    const mine = { id: "mine", name: "Mine", unit: "m", unitMeters: 1, up: "Y" as const, conventions: { collision: [{ role: "collision-convex" as const, affix: "suffix" as const, text: "_hull", pattern: "{name}_hull{n}" }], lod: [] } };
    expect(names(mine, post)).toEqual([["Crate_hull0", "collision-convex"]]);
  });

  it("counts the pieces of a shape in their names", () => {
    const result = exportGameAsset({ bodies: [{ name: "Frame", positions: frame.positions, collisionPieces: framePieces.map((piece) => ({ positions: piece.positions })) }], source: MM_Z_UP, profile: "unreal5" });
    expect(result.facts.bodies[0]!.collision!.nodes.map((node) => node.name)).toEqual(["UCX_Frame_00", "UCX_Frame_01", "UCX_Frame_02"]);
  });

  it("reports the collision of each body of several, in the engine's unit too", () => {
    const { facts } = exportGameAsset({
      bodies: [
        { name: "Crate", positions: crate.positions },
        { name: "Post", positions: cylinder(150, 400, 24).positions },
      ],
      source: MM_Z_UP,
      profile: "unreal5",
      placement: "designed",
    });
    expect(facts.bodies.map((body) => [body.collision!.shape, body.collision!.nodes[0]!.name])).toEqual([
      ["box", "UBX_Crate_00"],
      ["hull", "UCX_Post_00"],
    ]);
    // Unreal is in centimetres with Z up.
    expect(facts.bodies[0]!.collision!.nodes[0]!.bounds.engine.size.map((value) => Math.round(value))).toEqual([100, 50, 25]);
    expect(facts.settings.collision).toEqual({ shape: "auto", tolerance: 0.05, maxPieces: 8, maxHullVertices: 64, kernel: false });
  });
});
