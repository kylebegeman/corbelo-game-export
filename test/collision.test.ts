import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_COLLISION_TOLERANCE,
  DEFAULT_MAX_COLLISION_PIECES,
  DEFAULT_MAX_HULL_VERTICES,
  checkGameAsset,
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
import { box, chamferedBlock, cylinder, doorFrame, ell, fold, holedBlock, MM_Z_UP, tube } from "./fixtures.js";
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

describe("a block with a hole through it, given as a mesh alone", () => {
  // 600 by 600 by 450 with a hole of radius 120 and 32 sides: the hull, and the box, fill the hole.
  const holed = holedBlock(600, 450, 120, 32).positions;
  const hullError = 0.14267;
  const collisionCheck = (input: Omit<AssetInput, "source">) => {
    const { glb, facts } = exportGameAsset({ ...input, source: MM_Z_UP });
    return { facts: facts.bodies[0]!.collision!, check: checkGameAsset(glb).results.find((result) => result.id === "collision")! };
  };

  it("is cut into pieces within the tolerance at 8, 16 and 32 pieces allowed, and passes the collision check", () => {
    for (const maxPieces of [8, 16, 32]) {
      const { facts, check } = collisionCheck({ bodies: [{ name: "Block", positions: holed }], collision: { shape: "decomposition", maxPieces }, kernel });
      expect(facts, `${maxPieces} pieces allowed`).toMatchObject({ requested: "decomposition", shape: "decomposition", withinTolerance: true, notes: [] });
      expect(facts.pieces).toBeGreaterThan(1);
      expect(facts.pieces).toBeLessThanOrEqual(maxPieces);
      expect(Math.abs(facts.volume.error!)).toBeLessThanOrEqual(DEFAULT_COLLISION_TOLERANCE);
      // The pieces as written add up to the volume the facts say: the hole is not filled.
      expect(facts.nodes.reduce((total, node) => total + node.volume, 0)).toBeCloseTo(facts.volume.collision, 9);
      expect(facts.volume.collision).toBeLessThan(facts.volume.visible! * (1 + DEFAULT_COLLISION_TOLERANCE));
      expect(check.status).toBe("pass");
    }
  });

  it("reaches the decomposition by itself with a kernel, where the box and the hull fill the hole", () => {
    const counted = counting(kernel);
    const { facts, check } = collisionCheck({ bodies: [{ name: "Block", positions: holed }], kernel: counted.kernel });
    expect(facts.tried.map((tier) => [tier.shape, tier.withinTolerance])).toEqual([["box", false], ["hull", false], ["decomposition", true]]);
    expect(facts.tried[0]!.error).toBeCloseTo(hullError, 4);
    expect(facts.tried[1]!.error).toBeCloseTo(hullError, 4);
    expect(facts).toMatchObject({ requested: "auto", shape: "decomposition", withinTolerance: true });
    expect(facts.pieces).toBeLessThanOrEqual(DEFAULT_MAX_COLLISION_PIECES);
    expect(check).toMatchObject({ status: "pass" });
    expect(counted.freed()).toBe(counted.made());
  });

  it("is cut the same wherever the hole runs and wherever the block sits", () => {
    for (const up of ["Y", "Z"] as const) {
      for (const by of [[0, 0, 0], [137.25, -52.5, 12.75]] as const) {
        const positions = Float32Array.from(holed, (value, at) => value + by[at % 3]!);
        const facts = exportGameAsset({ bodies: [{ name: "Block", positions }], source: { unit: 0.001, up }, kernel }).facts.bodies[0]!.collision!;
        expect(facts, `up ${up}, moved by ${by.join(", ")}`).toMatchObject({ shape: "decomposition", withinTolerance: true });
      }
    }
  });

  it("opens a ring too: one 1.2 m across is within the tolerance at 13 parts and 9% over at 8", () => {
    const ring = tube(600, 400, 400, 48).positions;
    const cut = (maxPieces: number) => collisionOf({ bodies: [{ name: "Ring", positions: ring }], collision: { shape: "decomposition", maxPieces }, kernel });
    expect(cut(13)).toMatchObject({ shape: "decomposition", pieces: 13, withinTolerance: true });
    const eight = cut(8);
    expect(eight).toMatchObject({ pieces: 8, withinTolerance: false });
    expect(eight.volume.error!).toBeGreaterThan(0.09);
    expect(eight.volume.error!).toBeLessThan(0.1);
  });

  it("without a kernel takes the box, and the check asks for pieces or a kernel", () => {
    const { facts, check } = collisionCheck({ bodies: [{ name: "Block", positions: holed }] });
    expect(facts).toMatchObject({ requested: "auto", shape: "box", pieces: 1, withinTolerance: false });
    expect(facts.volume.error).toBeCloseTo(hullError, 4);
    expect(facts.notes).toEqual([
      "No collision pieces were given for the body.",
      "No kernel was given, and a general convex decomposition needs one.",
      "No tier is within the tolerance. The nearest was taken.",
    ]);
    expect(check.status).toBe("fail");
    expect(check.message).toBe(
      'The collision of "Block" (box, 1 piece) is 14.3% more volume than the visible part, over the 5% allowed. The pieces the part was built from, or a solid kernel to cut it into convex pieces, would bring it nearer.',
    );
  });

  it("with a kernel and too few pieces allowed, the check asks for more pieces and not for a kernel", () => {
    const pipe = tube(300, 250, 1000, 24).positions;
    const { facts, check } = collisionCheck({ bodies: [{ name: "Pipe", positions: pipe }], kernel });
    expect(facts).toMatchObject({ requested: "auto", shape: "decomposition", pieces: DEFAULT_MAX_COLLISION_PIECES, withinTolerance: false });
    expect(check.status).toBe("fail");
    expect(check.message).toContain("was cut into 8 convex pieces, the most allowed");
    expect(check.message).toContain("More pieces, or the pieces the part was built from, would bring it nearer.");
    expect(check.message).not.toContain("kernel");
  });

  it("says why an open mesh was not cut up, and does not ask for the kernel it was given", () => {
    // The same block with one triangle of its top left out.
    const open = holed.slice(9);
    const { facts, check } = collisionCheck({ bodies: [{ name: "Block", positions: open }], kernel });
    expect(facts).toMatchObject({ requested: "auto", shape: "hull", pieces: 1, withinTolerance: null });
    expect(facts.notes).toEqual([
      "The body is not closed, so it has no volume to compare collision with.",
      "No convex decomposition was made. A body that is not closed has no inside to cut into pieces.",
    ]);
    expect(check.status).toBe("not-measured");
    expect(check.message).toBe('A collision shape was written, but "Block" is not closed.');
    expect(check.reason).toBe('"Block" has 3 open edges, so it encloses no volume to compare the collision volume with. Close the mesh to have its collision measured.');
    expect(`${check.message} ${check.reason}`).not.toContain("kernel");

    const named = refusal(() => collisionOf({ bodies: [{ name: "Block", positions: open }], collision: "decomposition", kernel }));
    expect(named.message).toBe('Body "Block": collision "decomposition" cannot be built. A general convex decomposition needs a closed body with a volume.');
  });

  it("says why a mesh with a face turned the wrong way was not cut up", () => {
    // Closed edge for edge, but one triangle of the top faces down into the block.
    const turned = Float32Array.from(holed);
    turned.set(holed.subarray(3, 6), 6);
    turned.set(holed.subarray(6, 9), 3);
    const why = "3 edges join faces that point opposite ways, so the body has no clear inside. Turn every face to point outwards.";
    const { facts, check } = collisionCheck({ bodies: [{ name: "Block", positions: turned }], kernel });
    expect(facts.tried.map((tier) => tier.shape)).toEqual(["box", "hull"]);
    expect(facts.notes).toEqual(["No collision pieces were given for the body.", `No convex decomposition was made. ${why}`, "No tier is within the tolerance. The nearest was taken."]);
    expect(check.status).toBe("fail");
    expect(check.message).toContain(`A kernel was given, but no convex decomposition was made. ${why}`);
    expect(check.message).not.toContain("would bring it nearer");

    const named = refusal(() => collisionOf({ bodies: [{ name: "Block", positions: turned }], collision: "decomposition", kernel }));
    expect(named).toMatchObject({ code: "BAD_COLLISION", body: 0 });
    expect(named.message).toBe(`Body "Block": collision "decomposition" cannot be built. ${why}`);
  });

  it("passes a kernel's own failure over with a note when the shape is left to it, and names what the kernel said", () => {
    const broken: CollisionKernel = {
      solid: () => {
        throw new Error("not manifold");
      },
    };
    const { facts, check } = collisionCheck({ bodies: [{ name: "Block", positions: holed }], kernel: broken });
    expect(facts).toMatchObject({ requested: "auto", shape: "box", withinTolerance: false });
    expect(facts.notes[1]).toBe("No convex decomposition was made. The kernel did not take the body as a closed solid. It said: not manifold");
    expect(check.message).toContain("A kernel was given, but no convex decomposition was made. The kernel did not take the body as a closed solid. It said: not manifold");
  });

  it("does not trust parts that do not add up to the body: a hollow shut inside it", () => {
    // A box with a smaller box turned inside out in its middle: closed, with a hollow no cut from outside reaches.
    const outer = box([0, 0, 0], [600, 600, 600]).positions;
    const inner = box([200, 200, 200], [400, 400, 400]).positions;
    const hollow = new Float32Array(outer.length + inner.length);
    hollow.set(outer);
    for (let at = 0; at < inner.length; at += 9) {
      hollow.set(inner.subarray(at, at + 3), outer.length + at);
      hollow.set(inner.subarray(at + 6, at + 9), outer.length + at + 3);
      hollow.set(inner.subarray(at + 3, at + 6), outer.length + at + 6);
    }
    const refused = refusal(() => collisionOf({ bodies: [{ name: "Shell", positions: hollow }], collision: "decomposition", kernel }));
    expect(refused.message).toBe(
      'Body "Shell": collision "decomposition" cannot be built. The parts the kernel made hold 3.8% more volume than the body. That happens when its surface crosses itself or it has a hollow shut inside it.',
    );
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
