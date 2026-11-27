import { describe, expect, it } from "vitest";
import { encodeGlb } from "../src/glb-write.js";
import {
  ASSET_BUDGETS,
  ASSET_SIZE_RANGES,
  CHECK_IDS,
  checkGameAsset,
  exportGameAsset,
  exportGameGlb,
  GameExportError,
  GENERATOR,
  PLAYER_PROFILES,
  readGlb,
  type AssetInput,
  type CheckId,
  type CheckOptions,
  type CheckReport,
  type CheckResult,
  type GameExportErrorCode,
  type PlayerProfile,
} from "../src/index.js";
import { box, chamferedBlock, cylinder, doorFrame, doorway, ell, halfPaintedSide, joined, MM_Z_UP, moved, ramp, stairs, turned, type Point, type Shape } from "./fixtures.js";

type ResultOf<Id extends CheckId> = Extract<CheckResult, { id: Id }>;

function asset(positions: ArrayLike<number>, more: Partial<AssetInput> = {}, body: Partial<AssetInput["bodies"][number]> = {}): Uint8Array {
  return exportGameAsset({ bodies: [{ name: "Part", positions, ...body }], source: MM_Z_UP, ...more }).glb;
}

function result<Id extends CheckId>(report: CheckReport, id: Id): ResultOf<Id> {
  const found = report.results.find((entry) => entry.id === id);
  expect(found, `no result for ${id}`).toBeDefined();
  return found as ResultOf<Id>;
}

function check<Id extends CheckId>(id: Id, glb: Uint8Array, options: CheckOptions = {}): ResultOf<Id> {
  return result(checkGameAsset(glb, options), id);
}

function refusal(run: () => unknown): { code: GameExportErrorCode; message: string } {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GameExportError);
    return { code: (error as GameExportError).code, message: (error as Error).message };
  }
  throw new Error("Expected a refusal.");
}

/** A shape turned a quarter about the up axis: what ran along X runs along Y. */
function quarterTurn(shape: Shape): Shape {
  const positions = Float32Array.from(shape.positions);
  for (let at = 0; at < positions.length; at += 3) {
    positions[at] = -shape.positions[at + 1]!;
    positions[at + 1] = shape.positions[at]!;
  }
  return { positions, faceIds: shape.faceIds };
}

const crate = box([0, 0, 0], [500, 500, 500]);
const post = cylinder(150, 400, 48);
const frame = doorFrame(3000, 300, 2800, 1200, 2200);

describe("the report", () => {
  it("has one result for every check, in a fixed order, and counts them", () => {
    const report = checkGameAsset(asset(crate.positions));
    expect(report.results.map((entry) => entry.id)).toEqual(CHECK_IDS);
    expect(CHECK_IDS).toEqual(["size", "pivot", "triangles", "vertices", "shading", "clean-mesh", "material-slots", "collision", "detail-levels", "player-openings", "player-steps", "player-ramps"]);
    expect(report).toMatchObject({ schema: 1, generator: GENERATOR, profile: "godot4", assetClass: "small-prop", gridMeters: 1, status: "pass" });
    expect(report.budget).toEqual(ASSET_BUDGETS["small-prop"]);
    expect(report.player).toEqual(PLAYER_PROFILES.godot4);
    // A plain crate has no detail levels, openings, steps or ramps: those are not measured, and say why.
    expect(report.counts).toEqual({ pass: 8, warn: 0, fail: 0, notMeasured: 4 });
    for (const entry of report.results) {
      expect(entry.message).not.toBe("");
      expect(entry.values).toBeTypeOf("object");
      if (entry.status === "not-measured") expect(entry.reason).toBeTypeOf("string");
      else expect(entry).not.toHaveProperty("reason");
    }
    // Machine readable: the whole report goes through JSON unchanged.
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("takes the worst result as its status, and leaves what was not measured out of it", () => {
    const warned = checkGameAsset(asset(crate.positions, { source: { unit: 1, up: "Z" } }));
    expect(warned.status).toBe("warn");
    expect(warned.counts.warn).toBeGreaterThan(0);
    expect(warned.counts.fail).toBe(0);
    const failed = checkGameAsset(asset(crate.positions, { source: { unit: 1, up: "Z" } }), { budget: { maxTriangles: 4 } });
    expect(failed.status).toBe("fail");
    expect(failed.counts.fail).toBe(1);
  });

  it("is the same for the same file", () => {
    const glb = asset(frame.positions);
    expect(checkGameAsset(glb)).toEqual(checkGameAsset(glb));
    expect(checkGameAsset(readGlb(glb))).toEqual(checkGameAsset(glb));
  });

  it("checks a file written by exportGameGlb too, with collision not measured", () => {
    const report = checkGameAsset(exportGameGlb({ bodies: [{ name: "Crate", positions: crate.positions }], source: MM_Z_UP }).glb);
    expect(report.status).toBe("pass");
    expect(result(report, "collision")).toMatchObject({ status: "not-measured" });
  });

  it("refuses a file this package did not write, and options it cannot read", () => {
    const document = readGlb(asset(crate.positions));
    const stripped = JSON.parse(JSON.stringify(document.json)) as typeof document.json;
    delete stripped.scenes![0]!.extras;
    expect(refusal(() => checkGameAsset(encodeGlb(stripped, document.bin)))).toMatchObject({ code: "BAD_GLB" });
    expect(refusal(() => checkGameAsset(new Uint8Array(8))).code).toBe("BAD_GLB");
    const glb = asset(crate.positions);
    for (const options of [
      { assetClass: "vehicle" },
      { budget: { maxTriangles: 0 } },
      { budget: { maxVertices: 1.5 } },
      { player: "godot" },
      { player: { ...PLAYER_PROFILES.godot4, capsuleRadiusM: 0 } },
      { player: { ...PLAYER_PROFILES.godot4, walkableSlopeDeg: 120 } },
      { player: { ...PLAYER_PROFILES.godot4, id: "" } },
      { gridMeters: 0 },
      { lodDeviationShare: -1 },
      { collisionTolerance: Number.NaN },
    ]) {
      expect(refusal(() => checkGameAsset(glb, options as never)).code, JSON.stringify(options)).toBe("BAD_OPTION");
    }
  });
});

describe("budgets and players", () => {
  it("starts each class of asset with its own budget and size", () => {
    expect(ASSET_BUDGETS).toEqual({
      "small-prop": { maxTriangles: 2000, maxVertices: 4000, maxMaterialSlots: 2 },
      "large-prop": { maxTriangles: 10000, maxVertices: 20000, maxMaterialSlots: 4 },
      "kit-piece": { maxTriangles: 3000, maxVertices: 6000, maxMaterialSlots: 3 },
    });
    expect(ASSET_SIZE_RANGES).toEqual({ "small-prop": { minMeters: 0.05, maxMeters: 2 }, "large-prop": { minMeters: 1, maxMeters: 30 }, "kit-piece": { minMeters: 0.5, maxMeters: 12 } });
    const glb = asset(crate.positions);
    expect(checkGameAsset(glb, { assetClass: "large-prop" }).budget).toEqual(ASSET_BUDGETS["large-prop"]);
    // A budget of the caller's own replaces one limit and keeps the others.
    expect(checkGameAsset(glb, { assetClass: "kit-piece", budget: { maxTriangles: 500 } }).budget).toEqual({ maxTriangles: 500, maxVertices: 6000, maxMaterialSlots: 3 });
  });

  it("defaults the player to the character of the engine the file was written for", () => {
    expect(PLAYER_PROFILES.godot4).toMatchObject({ id: "godot4-character-body", origin: "built-in", engine: "godot", capsuleRadiusM: 0.5, capsuleHeightM: 2, stepHeightM: 0, walkableSlopeDeg: 45, jumpHeightM: 1.03 });
    expect(PLAYER_PROFILES.unity6).toMatchObject({ id: "unity6-character-controller", origin: "built-in", engine: "unity", capsuleRadiusM: 0.5, capsuleHeightM: 2, stepHeightM: 0.3, walkableSlopeDeg: 45, jumpHeightM: 1.5 });
    expect(PLAYER_PROFILES.unreal5).toMatchObject({ id: "unreal5-character", origin: "built-in", engine: "unreal", capsuleRadiusM: 0.34, capsuleHeightM: 1.76, stepHeightM: 0.45, walkableSlopeDeg: 44.765, jumpHeightM: 0.9 });
    // A jump is as high as its speed carries it against gravity: v * v / (2 * g).
    expect(4.5 ** 2 / (2 * 9.8)).toBeCloseTo(PLAYER_PROFILES.godot4.jumpHeightM, 2);
    expect(420 ** 2 / (2 * 980) / 100).toBeCloseTo(PLAYER_PROFILES.unreal5.jumpHeightM, 9);
    for (const profile of ["godot4", "unity6", "unreal5"] as const) {
      expect(checkGameAsset(asset(crate.positions, { profile })).player).toEqual(PLAYER_PROFILES[profile]);
      expect(PLAYER_PROFILES[profile].id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
    }
    const glb = asset(crate.positions);
    expect(checkGameAsset(glb, { player: "unreal5" }).player).toEqual(PLAYER_PROFILES.unreal5);
    const mine: PlayerProfile = { id: "scout", name: "Scout", origin: "account", capsuleRadiusM: 0.3, capsuleHeightM: 1.2, stepHeightM: 0.25, walkableSlopeDeg: 50, jumpHeightM: 2 };
    expect(checkGameAsset(glb, { player: mine }).player).toEqual(mine);
    // A profile of the caller's own has no engine character: it gets Godot's, the default profile's.
    const custom = { id: "mine", name: "Mine", unit: "m", unitMeters: 1, up: "Y" as const, conventions: { collision: [], lod: [] } };
    expect(checkGameAsset(asset(crate.positions, { profile: custom })).player).toEqual(PLAYER_PROFILES.godot4);
  });
});

describe("size", () => {
  it("passes an asset the size its class has, in metres and in the engine's unit", () => {
    const size = check("size", asset(crate.positions, { profile: "unreal5" }));
    expect(size.status).toBe("pass");
    expect(size.values.meters.map((value) => Math.round(value * 1e6) / 1e6)).toEqual([0.5, 0.5, 0.5]);
    expect(size.values.engine.map((value) => Math.round(value * 1e4) / 1e4)).toEqual([50, 50, 50]);
    expect(size.values).toMatchObject({ unit: "cm", expectedMeters: [0.05, 2], suggestedScale: null });
    expect(size.values.largestMeters).toBeCloseTo(0.5, 6);
    expect(size.message).toContain("50 cm");
  });

  it("warns about a wrong scale, and says which mix-up of units would explain it", () => {
    // Modelled in millimetres and exported as if the numbers were metres: a crate 500 m wide.
    const huge = check("size", asset(crate.positions, { source: { unit: 1, up: "Z" } }));
    expect(huge.status).toBe("warn");
    expect(huge.values.largestMeters).toBeCloseTo(500, 3);
    expect(huge.values.suggestedScale).toBe(0.001);
    expect(huge.message).toContain("millimetres read as metres");
    // Modelled in metres and exported as millimetres: half a millimetre.
    const tiny = check("size", asset(box([0, 0, 0], [0.5, 0.5, 0.5]).positions));
    expect(tiny.status).toBe("warn");
    expect(tiny.values.suggestedScale).toBe(1000);
    expect(tiny.message).toContain("metres read as millimetres");
    // Inches read as millimetres would not help a size no unit explains: no scale is offered.
    const odd = check("size", asset(box([0, 0, 0], [50_000_000, 1000, 1000]).positions));
    expect(odd.status).toBe("warn");
    expect(odd.values.suggestedScale).toBeNull();
  });

  it("goes by the class: a crate is too small for a large prop", () => {
    const glb = asset(crate.positions);
    expect(check("size", glb, { assetClass: "small-prop" }).status).toBe("pass");
    expect(check("size", glb, { assetClass: "kit-piece" }).status).toBe("pass");
    expect(check("size", glb, { assetClass: "large-prop" })).toMatchObject({ status: "warn", values: { expectedMeters: [1, 30] } });
  });
});

describe("pivot", () => {
  it("says where the pivot is and passes a kit piece that sits on the grid", () => {
    // A wall piece 2 m wide and 3 m tall with its pivot at the middle of its base: a whole metre from each end.
    const wall = box([0, 0, 0], [2000, 200, 3000]).positions;
    const pivot = check("pivot", asset(wall), { assetClass: "kit-piece" });
    expect(pivot.status).toBe("pass");
    expect(pivot.values.gridMeters).toBe(1);
    expect(pivot.values.bodies).toHaveLength(1);
    expect(pivot.values.bodies[0]).toMatchObject({ name: "Part", mode: "base-center", inside: true, onGrid: true });
    expect(pivot.values.bodies[0]!.fromMinCorner.map((value) => Math.round(value * 1e4) / 1e4)).toEqual([1, 0, 0.1]);
    expect(pivot.message).toBe("The pivot is at the middle of the base, on the 1 m grid.");
  });

  it("fails a kit piece whose pivot is off the grid, and passes it on a finer grid or with a corner pivot", () => {
    // 3 m wide: the middle of its base is a metre and a half from each end.
    const wall = box([0, 0, 0], [3000, 200, 3000]).positions;
    const off = check("pivot", asset(wall), { assetClass: "kit-piece" });
    expect(off.status).toBe("fail");
    expect(off.values.bodies[0]).toMatchObject({ inside: true, onGrid: false });
    expect(off.message).toContain("off the 1 m grid");
    expect(check("pivot", asset(wall), { assetClass: "kit-piece", gridMeters: 0.5 }).status).toBe("pass");
    expect(check("pivot", asset(wall, { pivot: "min-corner" }), { assetClass: "kit-piece" })).toMatchObject({ status: "pass", values: { bodies: [{ mode: "min-corner", onGrid: true }] } });
    // A prop is not snapped to a grid: the same pivot passes, and the numbers still say it is off.
    expect(check("pivot", asset(wall), { assetClass: "large-prop" })).toMatchObject({ status: "pass", values: { bodies: [{ onGrid: false }] } });
  });

  it("warns when the pivot is far outside the body", () => {
    const far = check("pivot", asset(crate.positions, { pivot: [20000, 0, 0] }));
    expect(far.status).toBe("warn");
    expect(far.values.bodies[0]).toMatchObject({ mode: "point", inside: false });
    // Just outside, the message says the pivot in words, as it does for every way of placing one.
    const pivotOf = (pivot: AssetInput["pivot"]) => check("pivot", asset(crate.positions, { pivot })).message;
    expect(([[-100, 250, 0], "center", "min-corner", "origin"] as const).map(pivotOf)).toEqual([
      "The pivot is at a point that was given, on the 1 m grid.",
      "The pivot is at the middle of the body, on the 1 m grid.",
      "The pivot is at the lowest corner of the box around the body, on the 1 m grid.",
      "The pivot is at the origin the body was modelled around, on the 1 m grid.",
    ]);
    // Just outside is a choice, like a hinge: no warning.
    expect(check("pivot", asset(crate.positions, { pivot: [-100, 250, 0] })).status).toBe("pass");
  });
});

describe("triangles and vertices", () => {
  it("counts triangles, and vertices after hard edges split them, against the budget", () => {
    const report = checkGameAsset(asset(chamferedBlock([1000, 500, 250], 20).positions));
    expect(result(report, "triangles")).toMatchObject({ status: "pass", values: { count: 44, budget: 2000, bodies: [{ name: "Part", count: 44 }] } });
    // 24 places in space, 96 vertices once every hard edge has split them.
    expect(result(report, "vertices")).toMatchObject({ status: "pass", values: { count: 96, budget: 4000 } });
  });

  it("fails over the budget, each on its own", () => {
    const glb = asset(chamferedBlock([1000, 500, 250], 20).positions);
    const few = checkGameAsset(glb, { budget: { maxTriangles: 43 } });
    expect(result(few, "triangles")).toMatchObject({ status: "fail", values: { count: 44, budget: 43 } });
    expect(result(few, "vertices").status).toBe("pass");
    const fewer = checkGameAsset(glb, { budget: { maxVertices: 95 } });
    expect(result(fewer, "vertices")).toMatchObject({ status: "fail", values: { count: 96, budget: 95 } });
    expect(result(fewer, "triangles").status).toBe("pass");
    expect(check("triangles", glb, { budget: { maxTriangles: 44 } }).status).toBe("pass");
  });

  it("adds up the bodies of an asset", () => {
    const glb = exportGameAsset({ bodies: [{ name: "A", positions: crate.positions }, { name: "B", positions: post.positions }], source: MM_Z_UP, placement: "designed" }).glb;
    expect(check("triangles", glb).values).toMatchObject({ count: 12 + 192, bodies: [{ name: "A", count: 12 }, { name: "B", count: 192 }] });
  });
});

describe("shading", () => {
  it("counts hard and soft edges and says face-weighted normals are there to ask for", () => {
    // A post: the rims at top and bottom are hard, the lines down its side are soft.
    const shading = check("shading", asset(post.positions));
    expect(shading.status).toBe("pass");
    expect(shading.values).toMatchObject({ normals: "angle-area", creaseAngle: 30, hardEdges: 96, backFacingNormals: 0 });
    // 48 lines down the side, 48 across the quads of the side, and the spokes of the two ends.
    expect(shading.values.softEdges).toBe(48 + 48 + 2 * 48);
    expect(shading.values.maxNormalAngle).toBeLessThan(5);
    expect(shading.message).toBe("96 hard edges and 192 soft edges. Normals are weighted by the area and angle of each triangle. Weighting by the whole flat face is there to ask for.");
    const weighted = check("shading", asset(post.positions, { normals: "face-weighted" }));
    expect(weighted).toMatchObject({ status: "pass", values: { normals: "face-weighted" } });
    expect(weighted.message).toBe("96 hard edges and 192 soft edges. Normals are weighted by the whole flat face each triangle belongs to.");
  });

  it("warns when a normal is far from a face it shades", () => {
    // A post shaded as one smooth surface: around its rims one normal has to serve the side and
    // the end, which are a right angle apart.
    const smooth = check("shading", asset(post.positions, { creaseAngle: 180 }));
    expect(smooth.status).toBe("warn");
    expect(smooth.values.maxNormalAngle).toBeGreaterThan(60);
    expect(smooth.values.maxNormalAngle).toBeLessThan(90);
    expect(smooth.values).toMatchObject({ hardEdges: 0, backFacingNormals: 0 });
    expect(smooth.message).toContain("over 60. A lower crease angle would make that edge hard.");
    // A thin wedge shaded the same way: along its sharp edge the normal ends up behind one of
    // the faces it shades, and that fails.
    const wedge = ramp(4000, 2000, 500).positions;
    expect(check("shading", asset(wedge, { creaseAngle: 180 })).status).toBe("fail");
    expect(check("shading", asset(wedge)).status).toBe("pass");
  });

  it("fails normals that point away from their own triangles", () => {
    const document = readGlb(asset(crate.positions));
    const json = document.json;
    const accessor = json.accessors![json.meshes![0]!.primitives[0]!.attributes["NORMAL"]!]!;
    const view = json.bufferViews![accessor.bufferView!]!;
    const bin = Uint8Array.from(document.bin);
    const normals = new Float32Array(bin.buffer, view.byteOffset ?? 0, accessor.count * 3);
    for (let at = 0; at < normals.length; at += 1) normals[at] = -normals[at]!;
    const shading = check("shading", encodeGlb(json, bin));
    expect(shading.status).toBe("fail");
    expect(shading.values.backFacingNormals).toBe(36);
    expect(shading.values.maxNormalAngle).toBeCloseTo(180, 3);
  });
});

describe("clean mesh", () => {
  it("passes a closed body that faces outwards", () => {
    expect(check("clean-mesh", asset(crate.positions))).toMatchObject({
      status: "pass",
      values: { degenerateTrianglesDropped: 0, sliverTriangles: 0, flippedEdges: 0, insideOutBodies: 0, openEdges: 0, nonManifoldEdges: 0 },
    });
  });

  it("fails a flipped face and a body turned inside out", () => {
    // One triangle of the crate turned over.
    const positions = Float32Array.from(crate.positions);
    positions.set(crate.positions.subarray(6, 9), 3);
    positions.set(crate.positions.subarray(3, 6), 6);
    const flipped = check("clean-mesh", asset(positions));
    expect(flipped.status).toBe("fail");
    expect(flipped.values.flippedEdges).toBe(3);
    expect(flipped.message).toContain("3 edges between faces that point opposite ways");

    const insideOut = check("clean-mesh", asset(turned(crate).positions));
    expect(insideOut.status).toBe("fail");
    expect(insideOut.values).toMatchObject({ flippedEdges: 0, insideOutBodies: 1 });
  });

  it("warns about open edges, doubled edges, slivers and triangles with no area", () => {
    // A crate that lost a triangle.
    const open = check("clean-mesh", asset(crate.positions.slice(9)));
    expect(open).toMatchObject({ status: "warn", values: { openEdges: 3 } });
    // Three boxes that touch along edges: where they meet, an edge has four triangles.
    const touching = check("clean-mesh", asset(doorway(3000, 300, 2800, 1200, 2200).positions));
    expect(touching.status).toBe("warn");
    expect(touching.values.nonManifoldEdges).toBe(2);
    // A plate a metre square and a millimetre thick: the triangles of its rim are slivers.
    const plate = check("clean-mesh", asset(box([0, 0, 0], [1000, 1000, 1]).positions));
    expect(plate).toMatchObject({ status: "warn", values: { sliverTriangles: 8, openEdges: 0 } });
    // A triangle with two corners in one place is left out of the file, and counted.
    const withPoint = new Float32Array(crate.positions.length + 9);
    withPoint.set(crate.positions);
    withPoint.set([0, 0, 0, 0, 0, 0, 500, 0, 0], crate.positions.length);
    const dropped = check("clean-mesh", asset(withPoint));
    expect(dropped).toMatchObject({ status: "warn", values: { degenerateTrianglesDropped: 1, openEdges: 0 } });
  });
});

describe("material slots", () => {
  const painted = { color: "#2980ba", faceColors: halfPaintedSide(48, "#c0392b") };

  it("counts the slots of the body with the most against the budget", () => {
    expect(check("material-slots", asset(post.positions, {}, painted))).toMatchObject({ status: "pass", values: { count: 2, budget: 2, fileMaterials: 2, bodies: [{ name: "Part", count: 2 }] } });
    expect(check("material-slots", asset(post.positions))).toMatchObject({ status: "pass", values: { count: 1 } });
  });

  it("fails over the budget", () => {
    const slots = check("material-slots", asset(post.positions, {}, painted), { budget: { maxMaterialSlots: 1 } });
    expect(slots).toMatchObject({ status: "fail", values: { count: 2, budget: 1 } });
  });

  it("counts slots per body: two bodies in one colour each are one slot each", () => {
    const glb = exportGameAsset({
      bodies: [{ name: "A", positions: crate.positions, color: "#ff0000" }, { name: "B", positions: moved(crate, [600, 0, 0]).positions, color: "#00ff00" }, { name: "C", positions: moved(crate, [1200, 0, 0]).positions, color: "#0000ff" }],
      source: MM_Z_UP,
      placement: "designed",
    }).glb;
    expect(check("material-slots", glb)).toMatchObject({ status: "pass", values: { count: 1, fileMaterials: 3 } });
  });
});

describe("collision", () => {
  it("passes a shape within the tolerance", () => {
    const collision = check("collision", asset(crate.positions));
    expect(collision).toMatchObject({ status: "pass", values: { tolerance: 0.05, bodies: [{ name: "Part", requested: "auto", shape: "box", pieces: 1, withinTolerance: true }] } });
    expect(collision.values.bodies[0]!.error).toBeCloseTo(0, 9);
  });

  it("fails when nothing near enough could be built", () => {
    // The hull of an L is a sixth more than the L, and with no pieces and no kernel that is the nearest there is.
    const collision = check("collision", asset(ell(1000, 500).positions));
    expect(collision.status).toBe("fail");
    expect(collision.values.bodies[0]).toMatchObject({ requested: "auto", shape: "hull", withinTolerance: false });
    expect(collision.values.bodies[0]!.error).toBeCloseTo(1 / 6, 6);
    expect(collision.message).toContain("16.7% more volume");
  });

  it("only warns about a shape the caller named", () => {
    const collision = check("collision", asset(ell(1000, 500).positions, { collision: "box" }));
    expect(collision.status).toBe("warn");
    expect(collision.values.bodies[0]).toMatchObject({ requested: "box", shape: "box", withinTolerance: false });
  });

  it("judges by the tolerance given to the check, or else the one the file was written with", () => {
    const glb = asset(ell(1000, 500).positions);
    expect(check("collision", glb, { collisionTolerance: 0.2 })).toMatchObject({ status: "pass", values: { tolerance: 0.2 } });
    const loose = asset(ell(1000, 500).positions, { collision: { tolerance: 0.2 } });
    expect(check("collision", loose)).toMatchObject({ status: "pass", values: { tolerance: 0.2 } });
    expect(check("collision", loose, { collisionTolerance: 0.01 }).status).toBe("fail");
  });

  it("is not measured without a shape, or for a body with no volume to compare", () => {
    const none = check("collision", asset(crate.positions, { collision: "none" }));
    expect(none).toMatchObject({ status: "not-measured", values: { bodies: [{ shape: "none", pieces: 0, error: null, withinTolerance: null }] } });
    expect(none.reason).toBe("No collision was written with the file. Write it again with a collision shape to have it measured.");
    const open = check("collision", asset(crate.positions.slice(9)));
    expect(open).toMatchObject({ status: "not-measured", values: { bodies: [{ shape: "hull", pieces: 1, error: null }] } });
    expect(open.reason).toContain("encloses no volume");
  });
});

describe("detail levels", () => {
  const levels = (...sides: number[]) => ({ lods: sides.map((count) => ({ positions: cylinder(150, 400, count).positions })) });

  it("passes levels that each have fewer triangles and stay near the outline", () => {
    const detail = check("detail-levels", asset(post.positions, {}, levels(24, 12)));
    expect(detail.status).toBe("pass");
    expect(detail.values.maxDeviationShare).toBe(0.05);
    expect(detail.values.bodies[0]!.levels.map((level) => [level.level, level.triangles, level.openEdges])).toEqual([[0, 192, 0], [1, 96, 0], [2, 48, 0]]);
    expect(detail.values.bodies[0]!.levels[2]!.deviationMeters).toBeCloseTo(0.15 * (1 - Math.cos(Math.PI / 12)), 3);
    expect(detail.message).toBe("2 lower detail levels, each smaller than the one above and within 5% of the outline.");
  });

  it("fails a level with more triangles than the one above, and one that is open when the body is closed", () => {
    const more = check("detail-levels", asset(post.positions, {}, levels(12, 24)));
    expect(more.status).toBe("fail");
    expect(more.message).toContain('level 2 of "Part" has more triangles than level 1');
    const open = check("detail-levels", asset(post.positions, {}, { lods: [{ positions: cylinder(150, 400, 12).positions.slice(9) }] }));
    expect(open.status).toBe("fail");
    expect(open.message).toContain("is not closed, and level 0 is");
    expect(open.values.bodies[0]!.levels[1]!.openEdges).toBe(3);
  });

  it("warns about a level that moves the outline too far, by the share given", () => {
    // Four sides for a round post: the flat sides sit 44 mm inside a post 583 mm across its box.
    const glb = asset(post.positions, {}, levels(4));
    const far = check("detail-levels", glb);
    expect(far.status).toBe("warn");
    expect(far.values.bodies[0]!.levels[1]!.deviationShare).toBeGreaterThan(0.05);
    expect(far.message).toContain("moves the outline by 7.");
    expect(check("detail-levels", glb, { lodDeviationShare: 0.1 }).status).toBe("pass");
    expect(check("detail-levels", asset(post.positions, {}, levels(24)), { lodDeviationShare: 0.001 }).status).toBe("warn");
    // A level that saves nothing is worth a word too.
    expect(check("detail-levels", asset(post.positions, {}, levels(48))).status).toBe("warn");
  });

  it("is not measured for an asset without lower levels", () => {
    const detail = check("detail-levels", asset(post.positions));
    expect(detail).toMatchObject({ status: "not-measured", values: { bodies: [] } });
    expect(detail.reason).toBe("No body was given lower detail levels. Engines that make their own levels on import need none.");
  });
});

describe("player fit: openings", () => {
  it("passes a doorway the capsule walks through, and measures it", () => {
    const opening = check("player-openings", asset(frame.positions));
    expect(opening.status).toBe("pass");
    expect(opening.values).toMatchObject({ player: "godot4-character-body", capsuleRadiusMeters: 0.5, capsuleHeightMeters: 2, ignored: 0 });
    expect(opening.values.openings).toHaveLength(1);
    const [door] = opening.values.openings;
    expect(door).toMatchObject({ axis: "z", sillMeters: 0, fits: true, walkIn: true });
    // Good to about two cells of the picture it was measured in.
    const cell = opening.values.cellMeters;
    expect(cell).toBeLessThan(0.01);
    expect(Math.abs(door!.widthMeters - 1.2)).toBeLessThanOrEqual(2 * cell);
    expect(Math.abs(door!.heightMeters - 2.2)).toBeLessThanOrEqual(2 * cell);
  });

  it("finds the opening whichever way the asset is turned, and in a body of touching parts", () => {
    const turnedFrame = check("player-openings", asset(quarterTurn(frame).positions));
    expect(turnedFrame.status).toBe("pass");
    expect(turnedFrame.values.openings.map((opening) => opening.axis)).toEqual(["x"]);
    expect(check("player-openings", asset(doorway(3000, 300, 2800, 1200, 2200).positions)).status).toBe("pass");
  });

  it("warns when the capsule does not fit, and fails when the opening was meant for the player", () => {
    // Too narrow: 0.8 m for a capsule 1 m wide.
    const narrow = asset(doorFrame(3000, 300, 2800, 800, 2200).positions);
    const opening = check("player-openings", narrow);
    expect(opening.status).toBe("warn");
    expect(opening.values.openings[0]).toMatchObject({ fits: false, walkIn: false });
    expect(check("player-openings", narrow, { expect: { opening: true } }).status).toBe("fail");
    // Too low: 1.9 m for a capsule 2 m tall.
    expect(check("player-openings", asset(doorFrame(3000, 300, 2800, 1200, 1900).positions)).status).toBe("warn");
    // A slimmer player walks through both.
    expect(check("player-openings", narrow, { player: "unreal5" }).status).toBe("pass");
  });

  it("is exact to about a cell: a door as wide as the capsule fits, and one a tenth narrower does not", () => {
    expect(check("player-openings", asset(doorFrame(3000, 300, 2800, 1000, 2200).positions)).values.openings[0]!.fits).toBe(true);
    expect(check("player-openings", asset(doorFrame(3000, 300, 2800, 900, 2200).positions)).values.openings[0]!.fits).toBe(false);
    expect(check("player-openings", asset(doorFrame(3000, 300, 2800, 1200, 2000).positions)).values.openings[0]!.fits).toBe(true);
  });

  it("measures the sill, and goes by the step height for walking in", () => {
    // A window: the doorway lifted onto a wall below it.
    const window = (sill: number): Shape => joined(box([0, 0, 0], [3000, 300, sill]), moved(doorway(3000, 300, 2400, 1200, 2100), [0, 0, sill]));
    const low = check("player-openings", asset(window(200).positions), { player: "unity6" });
    expect(low.status).toBe("pass");
    expect(low.values.openings[0]!.sillMeters).toBeCloseTo(0.2, 1);
    expect(low.values.openings[0]).toMatchObject({ fits: true, walkIn: true });
    const high = check("player-openings", asset(window(900).positions), { player: "unity6" });
    expect(high.status).toBe("warn");
    expect(high.values.openings[0]).toMatchObject({ fits: true, walkIn: false });
    expect(high.values.openings[0]!.sillMeters).toBeCloseTo(0.9, 1);
    expect(high.message).toContain("sill");
    expect(check("player-openings", asset(window(900).positions), { player: "unity6", expect: { opening: true } }).status).toBe("fail");
  });

  it("ignores holes too small to be meant for a player", () => {
    // A slot 0.2 m wide and 0.3 m tall, through a wall.
    const slot = check("player-openings", asset(doorFrame(3000, 300, 2800, 200, 300).positions));
    expect(slot).toMatchObject({ status: "not-measured", values: { openings: [], ignored: 1 } });
  });

  it("is not measured for an asset with no opening, and fails if one was expected", () => {
    const none = check("player-openings", asset(crate.positions));
    expect(none).toMatchObject({ status: "not-measured", values: { openings: [], ignored: 0 } });
    expect(none.reason).toContain("open to the sky is not counted");
    expect(check("player-openings", asset(crate.positions), { expect: { opening: true } }).status).toBe("fail");
    // Two posts with nothing over them: a gap, not an opening.
    const posts = joined(box([0, 0, 0], [900, 300, 2800]), box([2100, 0, 0], [3000, 300, 2800]));
    expect(check("player-openings", asset(posts.positions)).status).toBe("not-measured");
  });
});

describe("player fit: steps", () => {
  // Five steps of 180 mm, each 280 mm deep and 1.2 m wide.
  const flight = stairs(5, 180, 280, 1200).positions;

  it("passes stairs the player steps up, and lists the rises", () => {
    const steps = check("player-steps", asset(flight, { profile: "unity6" }));
    expect(steps.status).toBe("pass");
    expect(steps.values).toMatchObject({ player: "unity6-character-controller", stepHeightMeters: 0.3, jumpHeightMeters: 1.5, levels: [0.18, 0.36, 0.54, 0.72, 0.9], rises: [0.18, 0.18, 0.18, 0.18, 0.18], maxRiseMeters: 0.18 });
    expect(check("player-steps", asset(flight, { profile: "unreal5" })).status).toBe("pass");
  });

  it("warns when a rise is taller than the step height, and fails when the stairs were meant for the player", () => {
    // Godot's CharacterBody3D climbs no steps by itself.
    const godot = check("player-steps", asset(flight));
    expect(godot.status).toBe("warn");
    expect(godot.message).toBe("The tallest rise is 0.18 m, and this player climbs no steps. A jump clears it, or collision can be a ramp.");
    expect(check("player-steps", asset(flight), { expect: { stairs: true } }).status).toBe("fail");
    // Steps of 400 mm are too tall for Unity's 0.3 m and fine for Unreal's 0.45 m.
    const tall = stairs(3, 400, 300, 1200).positions;
    expect(check("player-steps", asset(tall, { profile: "unity6" }))).toMatchObject({ status: "warn", values: { maxRiseMeters: 0.4 } });
    expect(check("player-steps", asset(tall, { profile: "unreal5" })).status).toBe("pass");
  });

  it("is not measured for an asset without stairs, and fails if stairs were expected", () => {
    // A crate has one flat top: one rise is a ledge, not a stair.
    const none = check("player-steps", asset(crate.positions));
    expect(none).toMatchObject({ status: "not-measured", values: { levels: [0.5], rises: [], maxRiseMeters: null } });
    expect(none.reason).toContain("No two rises in a row");
    // Said to be a step, one rise is enough to judge.
    expect(check("player-steps", asset(crate.positions), { player: "unity6", expect: { stairs: true } })).toMatchObject({ status: "fail", values: { rises: [0.5] } });
    expect(check("player-steps", asset(box([0, 0, 0], [500, 500, 250]).positions), { player: "unity6", expect: { stairs: true } }).status).toBe("pass");
    // Rises over 0.6 m are ledges whatever is said.
    const ledges = check("player-steps", asset(stairs(3, 800, 800, 1200).positions), { expect: { stairs: true } });
    expect(ledges).toMatchObject({ status: "fail", values: { rises: [] } });
    expect(ledges.message).toBe("Steps were expected, and none were found.");
  });
});

describe("player fit: ramps", () => {
  it("passes a ramp the player walks up, and measures its slope", () => {
    // 1.5 m up over 4 m along.
    const ramps = check("player-ramps", asset(ramp(4000, 2000, 1500).positions));
    expect(ramps.status).toBe("pass");
    expect(ramps.values.walkableSlopeDegrees).toBe(45);
    expect(ramps.values.ramps).toHaveLength(1);
    expect(ramps.values.ramps[0]!.angleDegrees).toBeCloseTo((Math.atan2(1.5, 4) * 180) / Math.PI, 2);
    expect(ramps.values.ramps[0]!.areaSquareMeters).toBeCloseTo(2 * Math.hypot(4, 1.5), 4);
    expect(ramps.values.ramps[0]!.walkable).toBe(true);
  });

  it("warns about a ramp that is too steep, and fails when the ramp was meant for the player", () => {
    // 2.5 m up over 2 m along: 51 degrees.
    const steep = asset(ramp(2000, 2000, 2500).positions);
    const ramps = check("player-ramps", steep);
    expect(ramps.status).toBe("warn");
    expect(ramps.values.ramps[0]).toMatchObject({ walkable: false });
    expect(ramps.message).toContain("steeper than the 45 degrees");
    expect(check("player-ramps", steep, { expect: { ramp: true } }).status).toBe("fail");
  });

  it("goes by the player: 45 degrees is walkable in Godot and Unity, and a hair too steep for Unreal", () => {
    const diagonal = ramp(2000, 2000, 2000).positions;
    expect(check("player-ramps", asset(diagonal, { profile: "godot4" })).status).toBe("pass");
    expect(check("player-ramps", asset(diagonal, { profile: "unity6" })).status).toBe("pass");
    expect(check("player-ramps", asset(diagonal, { profile: "unreal5" }))).toMatchObject({ status: "warn", values: { walkableSlopeDegrees: 44.765 } });
  });

  it("is not measured for an asset without a ramp, and fails if one was expected", () => {
    const none = check("player-ramps", asset(crate.positions));
    expect(none).toMatchObject({ status: "not-measured", values: { ramps: [] } });
    expect(none.reason).toContain("from 2 to 60 degrees");
    expect(check("player-ramps", asset(crate.positions), { expect: { ramp: true } }).status).toBe("fail");
    // A roof at 70 degrees is a wall to walk into, not a ramp. The round side of a post is not one either.
    expect(check("player-ramps", asset(ramp(1000, 2000, 2750).positions)).status).toBe("not-measured");
    expect(check("player-ramps", asset(post.positions)).status).toBe("not-measured");
    // A chamfer is a slope too small to stand on.
    expect(check("player-ramps", asset(chamferedBlock([1000, 500, 250], 20).positions)).status).toBe("not-measured");
  });
});

/** Keeps the Point type in use for fixtures built here. */
export type { Point };
