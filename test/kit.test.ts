// The kit checks on a corridor kit of seven pieces built from plain boxes: the kit as it should
// be passes every check, and each wrong piece fails the one check that is about what is wrong
// with it.
import { describe, expect, it } from "vitest";
import {
  checkKit,
  exportGameAsset,
  GameExportError,
  KIT_CHECK_IDS,
  kitLayouts,
  layoutJoints,
  resolveKit,
  turnCell,
  turnSide,
  type GameExportErrorCode,
  type KitCheckId,
  type KitCheckReport,
  type KitCheckResult,
  type KitGrid,
  type KitInput,
  type KitPieceInput,
  type PlayerProfile,
} from "../src/index.js";
import { box, joined, MM_Z_UP } from "./fixtures.js";
import { counting, loadKernel } from "./kernel.js";
import { bodyOf, CORRIDOR_GRID, corridorKit, corridorPieces, doorBoxes, flatBoxes, PIECE_NAMES, prismX, SLAB, stairsPiece, swap, WALL } from "./kit-fixtures.js";

type Statuses = Record<KitCheckId, KitCheckResult["status"]>;

function statuses(report: KitCheckReport): Statuses {
  return Object.fromEntries(report.results.map((result) => [result.id, result.status])) as Statuses;
}

const ALL_PASS: Statuses = { "on-grid": "pass", seams: "pass", "in-cells": "pass", layouts: "pass", corners: "pass", walkable: "pass", "collision-tiles": "pass" };

function result<Id extends KitCheckId>(report: KitCheckReport, id: Id): Extract<KitCheckResult, { id: Id }> {
  return report.results.find((one) => one.id === id) as Extract<KitCheckResult, { id: Id }>;
}

function refusal(run: () => unknown): { code: GameExportErrorCode; message: string } {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GameExportError);
    const { code, message } = error as GameExportError;
    return { code, message };
  }
  throw new Error("Expected a refusal, but it went through.");
}

const sizes = (grid: KitGrid): { M: number; S: number } => ({ M: grid.moduleMeters * 1000, S: grid.storeyMeters * 1000 });

describe("the corridor kit", () => {
  it("is seven pieces on one grid, each written as an asset with its sockets", () => {
    const kit = resolveKit(corridorKit());
    expect(kit.pieces.map((piece) => piece.name)).toEqual([...PIECE_NAMES]);
    expect(kit.grid).toEqual({ moduleMeters: 3, storeyMeters: 3, trimMeters: 0.1 });
    expect(kit.pieces.map((piece) => piece.asset)).toEqual(["corridor_straight", "corridor_corner", "corridor_tee", "corridor_cross", "corridor_doorway", "corridor_endcap", "corridor_stairs"]);
    expect(kit.pieces.map((piece) => piece.sockets.length)).toEqual([2, 2, 3, 4, 2, 1, 2]);
    const stairs = kit.pieces[6]!;
    expect(stairs.cells).toEqual([2, 1, 2]);
    expect(stairs.sockets.map((socket) => socket.name)).toEqual(["-x@0,0,0", "+x@1,0,1"]);
    expect(stairs.sockets.map((socket) => [socket.side, socket.cell, socket.passage, socket.offsetMeters])).toEqual([["-x", [0, 0, 0], true, 0], ["+x", [1, 0, 1], true, 0]]);
    // One body takes the asset's name, so the node and the mesh are named as the file is.
    expect(kit.pieces[0]!.facts.bodies.map((body) => body.name)).toEqual(["corridor_straight"]);
    expect(kit.pieces[0]!.facts.bodies[0]!.collision!.nodes).toHaveLength(3);
  });

  it("passes every check, with a kernel and without one", async () => {
    const without = checkKit(corridorKit());
    expect(statuses(without)).toEqual(ALL_PASS);
    expect(without.status).toBe("pass");
    expect(without.counts).toEqual({ pass: 7, warn: 0, fail: 0, notMeasured: 0 });
    expect(without.results.map((one) => one.id)).toEqual([...KIT_CHECK_IDS]);
    expect(without.kernel).toBe(false);
    const withKernel = checkKit(corridorKit(), { kernel: await loadKernel() });
    expect(statuses(withKernel)).toEqual(ALL_PASS);
    expect(withKernel.kernel).toBe(true);
    // Nothing of the kit is trim, so there was nothing for the kernel to measure.
    expect({ ...withKernel, kernel: false, results: withKernel.results.map((one) => (one.id === "layouts" ? { ...one, values: { ...one.values, kernel: false } } : one)) }).toEqual(without);
  });

  it("reports the numbers each check was judged by", () => {
    const report = checkKit(corridorKit());
    const grid = result(report, "on-grid").values;
    expect(grid.pieces.find((piece) => piece.piece === "stairs")).toEqual({ piece: "stairs", cells: [2, 1, 2], sizeMeters: [6, 3, 6], modules: [2, 1, 2], sizeOffMeters: 0, pivotOffMeters: 0, socketOffMeters: 0 });
    expect(grid.worstMeters).toBe(0);

    const seams = result(report, "seams").values;
    // 16 sockets of one type: every two of them, and each with its own mirror image.
    expect(seams.types).toEqual([{ type: "corridor", mates: "corridor", sockets: 16, pairs: 136, outlineSquareMeters: expect.closeTo(0.6 + 2 * 0.2 * 2.8, 2), mismatchSquareMeters: 0, worst: null }]);
    expect(seams.empty).toEqual([]);
    expect(seams.toleranceSquareMeters).toBeCloseTo(0.0003, 9);

    const cells = result(report, "in-cells").values;
    expect(cells.maxPokeMeters).toBe(0);
    expect(cells.pieces.every((piece) => piece.trimPokeMeters === null)).toBe(true);

    const layouts = result(report, "layouts").values;
    expect(layouts.layouts.map((layout) => [layout.name, layout.pieces, layout.joints, layout.open])).toEqual([["run", 5, 4, 0], ["corner", 3, 2, 2], ["tee", 4, 3, 3], ["cross", 5, 4, 4], ["rise", 3, 2, 2], ["room", 8, 8, 0]]);
    for (const layout of layouts.layouts) {
      expect(layout).toMatchObject({ origin: "generated", blocked: 0, mismatched: 0, doubledCells: 0, apart: 0, maxGapMeters: 0, maxOverlapMeters: 0, trimPairs: 0, trimOverlapCubicMeters: 0 });
      expect(layout.minContactSquareMeters).toBeCloseTo(1.72, 2);
    }
    expect(layouts.skipped).toEqual([]);

    const corners = result(report, "corners").values;
    expect(corners).toMatchObject({ pairs: 136, pairsSkipped: 0, onEdge: 0, off: 0, maxOffMeters: 0, worst: null });
    expect(corners.coincident).toBe(corners.points);
    expect(corners.points).toBeGreaterThan(1000);

    const walk = result(report, "walkable").values;
    expect(walk).toMatchObject({ player: "godot4-character-body", capsuleRadiusMeters: 0.5, capsuleHeightMeters: 2, stepHeightMeters: 0, maxFloorStepMeters: 0, maxRiseMeters: 0, maxRampDegrees: 33.69 });
    const door = walk.pieces.find((piece) => piece.piece === "doorway")!;
    expect(door.geometry).toBe("collision");
    for (const passage of door.passages) {
      expect(passage.fits).toBe(true);
      expect(passage.widthMeters).toBeCloseTo(1.4, 1);
      expect(passage.heightMeters).toBeCloseTo(2.3, 1);
      expect(passage.floorMeters).toBe(0.2);
    }
    const stairs = walk.pieces.find((piece) => piece.piece === "stairs")!;
    expect(stairs.ramps).toEqual([{ angleDegrees: 33.69, areaSquareMeters: expect.closeTo(14.06, 2), walkable: true }]);
    expect(stairs.rises).toEqual([]);
    expect(stairs.passages.map((passage) => [passage.socket, passage.fits, passage.floorMeters])).toEqual([["-x@0,0,0", true, 0.2], ["+x@1,0,1", true, 0.2]]);

    const tiles = result(report, "collision-tiles").values;
    expect(tiles.types[0]).toMatchObject({ pairs: 136, mismatchSquareMeters: 0, worst: null });
    expect(tiles.without).toEqual([]);
  });

  it("gives the same report for the same kit", () => {
    expect(JSON.stringify(checkKit(corridorKit()))).toBe(JSON.stringify(checkKit(corridorKit())));
  });

  it("checks another module size in one call", () => {
    const report = checkKit(corridorKit(), { grid: { moduleMeters: 4, storeyMeters: 3.5 } });
    expect(statuses(report)).toEqual(ALL_PASS);
    expect(report.grid).toEqual({ moduleMeters: 4, storeyMeters: 3.5, trimMeters: 0.1 });
    expect(result(report, "on-grid").values.pieces.find((piece) => piece.piece === "stairs")!.sizeMeters).toEqual([8, 4, 7]);
    // The stairs are longer and no taller by as much, so the slope is gentler.
    expect(result(report, "walkable").values.maxRampDegrees).toBeCloseTo(28.3, 1);
  });

  it("fails On the grid for pieces made for one module size and checked against another", () => {
    const fixed: KitInput = { ...corridorKit(), pieces: corridorPieces({ ...CORRIDOR_GRID, trimMeters: 0.1 }) };
    expect(statuses(checkKit(fixed))).toEqual(ALL_PASS);
    const report = checkKit(fixed, { grid: { moduleMeters: 2.5, storeyMeters: 3 } });
    const grid = result(report, "on-grid");
    expect(grid.status).toBe("fail");
    expect(grid.values.pieces.find((piece) => piece.piece === "straight")).toMatchObject({ sizeMeters: [3, 3, 3], modules: [1.2, 1.2, 1], sizeOffMeters: 0.5 });
    expect(grid.message).toContain('"straight" is 1.2 by 1.2 by 1 modules');
  });
});

describe("a wrong piece fails the check that is about it, and no other", () => {
  it("On the grid: a pivot that is not on a corner of the grid", () => {
    const report = checkKit(corridorKit(swap((grid) => ({ ...corridorPieces(grid)[0]!, pivot: [100, 0, 0] }))));
    expect(statuses(report)).toEqual({ ...ALL_PASS, "on-grid": "fail" });
    const grid = result(report, "on-grid");
    expect(grid.values.pieces[0]).toMatchObject({ piece: "straight", sizeOffMeters: 0, pivotOffMeters: 0.1 });
    expect(grid.values.worstMeters).toBe(0.1);
    expect(grid.message).toBe('Off the grid of 3 m by 3 m: the pivot of "straight" is 0.1 m from a corner of the grid.');
    expect(report.status).toBe("fail");
    expect(report.counts).toEqual({ pass: 6, warn: 0, fail: 1, notMeasured: 0 });
  });

  it("Seams match: walls a third thicker than the walls they meet", () => {
    const wrong = (grid: KitGrid): KitPieceInput => {
      const good = flatBoxes(grid, ["+x", "-x"]);
      const thick = flatBoxes(grid, ["+x", "-x"], 300);
      return { ...corridorPieces(grid)[0]!, bodies: [bodyOf("straight", good, { visible: joined(...thick.map(([min, max]) => box(min, max))) })] };
    };
    const report = checkKit(corridorKit(swap(wrong)));
    expect(statuses(report)).toEqual({ ...ALL_PASS, seams: "fail" });
    const seams = result(report, "seams");
    // Two walls, each 0.1 m thicker over 2.8 m of height.
    expect(seams.values.maxMismatchSquareMeters).toBeCloseTo(0.56, 2);
    expect(seams.values.types[0]!.worst!.some((label) => label.startsWith("straight/"))).toBe(true);
    expect(seams.message).toMatch(/^Sockets of type "corridor" do not have one outline: .* differ by 0\.56\d* m2\.$/);
    // The seams of the wrong piece have no shared outline to compare points along; every other seam does.
    expect(result(report, "corners").values).toMatchObject({ pairs: 136 - 28, pairsSkipped: 28, off: 0 });
  });

  it("Stays in its cells: trim that reaches three times as far as trim may", () => {
    const wrong = (grid: KitGrid): KitPieceInput => {
      const { M } = sizes(grid);
      const good = corridorPieces(grid)[5]!;
      return { ...good, bodies: [...good.bodies!, bodyOf("skirting", [[[-300, 500, 0], [100, M - 500, 100]]])], trim: ["skirting"] };
    };
    const report = checkKit(corridorKit(swap(wrong)));
    expect(statuses(report)).toEqual({ ...ALL_PASS, "in-cells": "fail" });
    const cells = result(report, "in-cells");
    expect(cells.values.pieces.find((piece) => piece.piece === "endcap")).toEqual({ piece: "endcap", pokeMeters: 0, trimPokeMeters: 0.3 });
    expect(cells.values).toMatchObject({ trimMeters: 0.1, maxPokeMeters: 0, maxTrimPokeMeters: 0.3 });
    expect(cells.message).toBe('Out of its cells: the trim of "endcap" reaches 0.3 m past its cells, and trim may reach 0.1 m.');
    // The same body not declared as trim is the piece itself out of its cells, and off the grid as well.
    const undeclared = checkKit(corridorKit(swap((grid) => ({ ...wrong(grid), trim: [] }))));
    expect(result(undeclared, "in-cells").values.pieces.find((piece) => piece.piece === "endcap")).toEqual({ piece: "endcap", pokeMeters: 0.3, trimPokeMeters: null });
    expect(statuses(undeclared)).toMatchObject({ "in-cells": "fail", "on-grid": "fail" });
  });

  it("Layouts close: trim that runs into the floor of the piece next to it, which takes a kernel to measure", async () => {
    const wrong = (grid: KitGrid): KitPieceInput => {
      const { M } = sizes(grid);
      const good = corridorPieces(grid)[0]!;
      return { ...good, bodies: [...good.bodies!, bodyOf("threshold", [[[M - 100, 500, 150], [M + 50, M - 500, 250]]])], trim: ["threshold"] };
    };
    const counted = counting(await loadKernel());
    const report = checkKit(corridorKit(swap(wrong)), { kernel: counted.kernel });
    expect(statuses(report)).toEqual({ ...ALL_PASS, layouts: "fail" });
    const layouts = result(report, "layouts");
    const run = layouts.values.layouts.find((layout) => layout.name === "run")!;
    // 0.05 m into the next piece, 2 m wide, and the 0.05 m of it that is under the top of the floor.
    expect(run.trimOverlapCubicMeters).toBeCloseTo(2 * 0.05 * 2 * 0.05, 6);
    expect(run.trimPairs).toBeGreaterThan(0);
    expect(run).toMatchObject({ apart: 0, maxOverlapMeters: 0 });
    expect(layouts.message).toContain("trim runs into the piece next to it by 0.01 m3");
    expect(counted.made()).toBeGreaterThan(0);
    expect(counted.freed()).toBe(counted.made());

    // Without a kernel the same kit is not judged: nothing else is wrong with it, and this was not measured.
    const without = checkKit(corridorKit(swap(wrong)));
    expect(statuses(without)).toEqual({ ...ALL_PASS, layouts: "not-measured" });
    const unmeasured = result(without, "layouts");
    expect(unmeasured.reason).toBe("No kernel was given, and measuring what two bodies both fill needs one.");
    expect(unmeasured.values.layouts.find((layout) => layout.name === "run")!.trimOverlapCubicMeters).toBeNull();
    expect(without.status).toBe("pass");
    expect(without.counts).toEqual({ pass: 6, warn: 0, fail: 0, notMeasured: 1 });

    // Trim that stops short of the next piece's bodies is proven clear by its box alone.
    const clear = (grid: KitGrid): KitPieceInput => {
      const { M } = sizes(grid);
      const good = corridorPieces(grid)[0]!;
      return { ...good, bodies: [...good.bodies!, bodyOf("lamp", [[[M - 100, 1400, 2000], [M + 50, 1600, 2100]]])], trim: ["lamp"] };
    };
    const proven = checkKit(corridorKit(swap(clear)));
    expect(statuses(proven)).toEqual(ALL_PASS);
    expect(result(proven, "layouts").values.layouts.find((layout) => layout.name === "run")).toMatchObject({ trimPairs: 0, trimOverlapCubicMeters: 0 });
    expect(result(proven, "in-cells").values.maxTrimPokeMeters).toBe(0.05);
  });

  it("Corners line up: a 2 mm chamfer on the corner of one wall", () => {
    const wrong = (grid: KitGrid): KitPieceInput => {
      const { M, S } = sizes(grid);
      const boxes = flatBoxes(grid, ["+x", "-x"]);
      // The wall on the low side, with its upper inner corner cut.
      const wall = prismX([[0, SLAB], [WALL, SLAB], [WALL, S - 2], [WALL - 2, S], [0, S]], 0, M);
      const visible = joined(box(...boxes[0]!), wall, box(...boxes[2]!));
      return { ...corridorPieces(grid)[0]!, bodies: [bodyOf("straight", boxes, { visible })] };
    };
    const report = checkKit(corridorKit(swap(wrong)));
    expect(statuses(report)).toEqual({ ...ALL_PASS, corners: "fail" });
    // Two square millimetres are far inside what Seams match allows.
    expect(result(report, "seams").values.maxMismatchSquareMeters).toBeLessThan(0.00001);
    const corners = result(report, "corners");
    expect(corners.values.pairsSkipped).toBe(0);
    expect(corners.values.off).toBeGreaterThan(0);
    expect(corners.values.maxOffMeters).toBeCloseTo(0.002, 4);
    expect(corners.values.worst!.some((label) => label.startsWith("straight/"))).toBe(true);
    expect(corners.message).toMatch(/lie off the outline they meet, by up to 0\.002 m/);
  });

  it("Corners line up: warns for a point along an edge that has no point there", () => {
    const wrong = (grid: KitGrid): KitPieceInput => {
      const { M, S } = sizes(grid);
      const boxes = flatBoxes(grid, ["+x", "-x"]);
      // One wall in two parts, one on the other: the same outline, with two more points half way up.
      const split: typeof boxes = [boxes[0]!, [[0, 0, SLAB], [M, WALL, 1500]], [[0, 0, 1500], [M, WALL, S]], boxes[2]!];
      return { ...corridorPieces(grid)[0]!, bodies: [bodyOf("straight", boxes, { visible: joined(...split.map(([min, max]) => box(min, max))) })] };
    };
    const report = checkKit(corridorKit(swap(wrong)));
    expect(statuses(report)).toEqual({ ...ALL_PASS, corners: "warn" });
    expect(report.status).toBe("warn");
    const corners = result(report, "corners");
    expect(corners.values.off).toBe(0);
    expect(corners.values.onEdge).toBeGreaterThan(0);
    expect(corners.message).toContain("a renderer can show a crack there");
  });

  it("Walkable: a doorway 0.8 m wide, for a player 1 m wide", () => {
    const wrong = (grid: KitGrid): KitPieceInput => ({ ...corridorPieces(grid)[4]!, bodies: [bodyOf("doorway", [...flatBoxes(grid, ["+x", "-x"]), ...doorBoxes(grid, 800)])] });
    const report = checkKit(corridorKit(swap(wrong)));
    expect(statuses(report)).toEqual({ ...ALL_PASS, walkable: "fail" });
    const walk = result(report, "walkable");
    const door = walk.values.pieces.find((piece) => piece.piece === "doorway")!;
    for (const passage of door.passages) {
      expect(passage.fits).toBe(false);
      expect(passage.widthMeters).toBeCloseTo(0.8, 1);
    }
    expect(walk.message).toContain('the player does not fit through +x of "doorway"');
    // A smaller player passes the same doorway.
    const small: PlayerProfile = { id: "small", name: "A small player", origin: "test", capsuleRadiusM: 0.3, capsuleHeightM: 1.6, stepHeightM: 0, walkableSlopeDeg: 45, jumpHeightM: 1 };
    const again = checkKit(corridorKit(swap(wrong)), { player: small });
    expect(statuses(again)).toEqual(ALL_PASS);
    expect(again.player).toEqual(small);
  });

  it("Walkable: steps as collision stop a character that climbs none, and not one that does", () => {
    const wrong = (grid: KitGrid): KitPieceInput => stairsPiece(grid, { steps: "steps" });
    const report = checkKit(corridorKit(swap(wrong)));
    expect(statuses(report)).toEqual({ ...ALL_PASS, walkable: "fail" });
    const walk = result(report, "walkable");
    expect(walk.values.pieces.find((piece) => piece.piece === "stairs")!.rises).toEqual(Array.from({ length: 15 }, () => 0.2));
    expect(walk.values.maxRiseMeters).toBe(0.2);
    expect(walk.message).toBe('Not walkable for Godot 4 CharacterBody3D: "stairs" has a rise of 0.2 m, and this player climbs no steps.');
    const stepping = checkKit(corridorKit(swap(wrong)), { player: "unity6" });
    expect(statuses(stepping)).toEqual(ALL_PASS);
    expect(stepping.player.id).toBe("unity6-character-controller");
  });

  it("Collision tiles: a collision wall thicker than the walls it meets, under a visible wall that matches", () => {
    const wrong = (grid: KitGrid): KitPieceInput => {
      const good = flatBoxes(grid, ["+x", "-x"]);
      const thick = flatBoxes(grid, ["+x", "-x"], 300);
      return { ...corridorPieces(grid)[0]!, bodies: [bodyOf("straight", good, { collision: thick.map(([min, max]) => box(min, max)) })] };
    };
    const report = checkKit(corridorKit(swap(wrong)));
    expect(statuses(report)).toEqual({ ...ALL_PASS, "collision-tiles": "fail" });
    const tiles = result(report, "collision-tiles");
    expect(tiles.values.maxMismatchSquareMeters).toBeCloseTo(0.56, 2);
    expect(tiles.message).toContain("a lip a moving body can catch on");
    expect(result(report, "seams").values.maxMismatchSquareMeters).toBe(0);
  });
});

describe("what is not measured says why", () => {
  it("a kit written with no collision has no collision to tile, and is walked on what is seen", () => {
    const report = checkKit(corridorKit(undefined, { collision: "none" }));
    expect(statuses(report)).toEqual({ ...ALL_PASS, walkable: "fail", "collision-tiles": "not-measured" });
    expect(result(report, "collision-tiles").reason).toBe("The kit was written with collision set to none.");
    const walk = result(report, "walkable");
    expect(walk.values.pieces.every((piece) => piece.geometry === "visible")).toBe(true);
    // With no slope for collision, the steps that are seen are the steps that are walked.
    expect(walk.values.maxRiseMeters).toBe(0.2);
  });

  it("a kit with no sockets has nothing that meets", () => {
    const report = checkKit(corridorKit((pieces) => pieces.slice(0, 2).map((piece) => ({ ...piece, sockets: [] }))));
    expect(statuses(report)).toEqual({ "on-grid": "pass", seams: "not-measured", "in-cells": "pass", layouts: "not-measured", corners: "not-measured", walkable: "not-measured", "collision-tiles": "not-measured" });
    expect(report.status).toBe("pass");
    expect(report.counts).toEqual({ pass: 2, warn: 0, fail: 0, notMeasured: 5 });
    for (const one of report.results) if (one.status === "not-measured") expect(one.reason).toBeTruthy();
    expect(result(report, "layouts").values.skipped.map((skip) => skip.name)).toEqual(["run", "corner", "tee", "cross", "rise", "room"]);
  });

  it("a piece with sockets and no passage is not walked through", () => {
    const report = checkKit(corridorKit((pieces) => pieces.slice(0, 6).map((piece) => ({ ...piece, sockets: piece.sockets!.map((socket) => ({ ...socket, passage: false })) }))));
    expect(statuses(report)).toEqual({ ...ALL_PASS, walkable: "not-measured" });
    expect(result(report, "walkable").reason).toContain("No socket on a side is marked as a passage");
  });
});

describe("layouts", () => {
  it("turns sides and cells by quarter turns, anticlockwise seen from above", () => {
    expect([0, 1, 2, 3].map((turn) => turnSide("+x", turn))).toEqual(["+x", "+y", "-x", "-y"]);
    expect(turnSide("+z", 3)).toBe("+z");
    expect([0, 1, 2, 3].map((turn) => turnCell([1, 0, 1], turn))).toEqual([[1, 0, 1], [0, 1, 1], [-1, 0, 1], [0, -1, 1]]);
  });

  it("builds the test layouts from the sockets alone, and says which it cannot build", () => {
    const kit = resolveKit(corridorKit());
    const { layouts, skipped } = kitLayouts(kit);
    expect(layouts.map((layout) => layout.name)).toEqual(["run", "corner", "tee", "cross", "rise", "room"]);
    expect(skipped).toEqual([]);
    const room = layouts.find((layout) => layout.name === "room")!;
    expect(room.placements.map((placement) => placement.piece).sort()).toEqual(["corner", "corner", "corner", "corner", "doorway", "doorway", "straight", "straight"]);
    const joints = layoutJoints(kit, room);
    expect(joints).toMatchObject({ open: [], blocked: [], mismatched: [], doubled: [], cells: 8 });
    expect(joints.joints).toHaveLength(8);

    // A kit with no bends has no corner and no room to build, and says so.
    const straightOnly = kitLayouts(resolveKit(corridorKit((pieces) => [pieces[0]!, pieces[4]!, pieces[5]!])));
    expect(straightOnly.layouts.map((layout) => layout.name)).toEqual(["run"]);
    expect(straightOnly.skipped.map((skip) => skip.name)).toEqual(["corner", "tee", "cross", "rise", "room"]);
    for (const skip of straightOnly.skipped) expect(skip.reason).toMatch(/\.$/);
  });

  it("checks a layout the caller gives, as piece, cell and quarter turn", () => {
    const good = corridorKit(undefined, { layouts: [{ name: "dead end", placements: [{ piece: "endcap", cell: [0, 0, 0] }, { piece: "straight", cell: [1, 0, 0] }, { piece: "corner", cell: [2, 0, 0], turn: 1 }, { piece: "endcap", cell: [2, 1, 0], turn: 3 }] }] });
    const report = checkKit(good);
    expect(statuses(report)).toEqual(ALL_PASS);
    expect(report.layouts.map((layout) => [layout.name, layout.origin])).toContainEqual(["dead end", "given"]);
    expect(result(report, "layouts").values.layouts.find((layout) => layout.name === "dead end")).toMatchObject({ origin: "given", pieces: 4, joints: 3, open: 0, blocked: 0 });

    // A gap of one cell, a piece facing a wall, and two pieces in one cell.
    const bad = corridorKit(undefined, {
      layouts: [
        { name: "gap", placements: [{ piece: "straight", cell: [0, 0, 0] }, { piece: "straight", cell: [2, 0, 0] }] },
        { name: "into a wall", placements: [{ piece: "straight", cell: [0, 0, 0] }, { piece: "endcap", cell: [1, 0, 0] }] },
        { name: "twice", placements: [{ piece: "straight", cell: [0, 0, 0] }, { piece: "doorway", cell: [0, 0, 0] }, { piece: "straight", cell: [1, 0, 0] }] },
      ],
    });
    const failed = checkKit(bad);
    expect(statuses(failed)).toEqual({ ...ALL_PASS, layouts: "fail" });
    const values = result(failed, "layouts").values.layouts;
    expect(values.find((layout) => layout.name === "gap")).toMatchObject({ joints: 0, open: 4 });
    expect(values.find((layout) => layout.name === "into a wall")).toMatchObject({ joints: 0, blocked: 1 });
    expect(values.find((layout) => layout.name === "twice")).toMatchObject({ doubledCells: 1 });
    const message = result(failed, "layouts").message;
    expect(message).toContain('"gap": no two sockets meet');
    expect(message).toContain('"into a wall": 1 socket faces a side with no socket');
    expect(message).toContain('"twice": 1 cell has two pieces in it');
  });

  it("refuses a layout it cannot read", () => {
    const withLayout = (layout: unknown) => refusal(() => resolveKit(corridorKit(undefined, { layouts: [layout] as never })));
    expect(withLayout({ name: "x", placements: [{ piece: "nothing", cell: [0, 0, 0] }] })).toEqual({ code: "BAD_LAYOUT", message: 'Layout "x", placement 0: the kit has no piece named "nothing".' });
    expect(withLayout({ name: "x", placements: [{ piece: "straight", cell: [0, 0.5, 0] }] }).code).toBe("BAD_LAYOUT");
    expect(withLayout({ name: "x", placements: [{ piece: "straight", cell: [0, 0, 0], turn: 0.5 }] }).code).toBe("BAD_LAYOUT");
    expect(withLayout({ name: "x", placements: [] }).code).toBe("BAD_LAYOUT");
  });
});

describe("the kit as data", () => {
  it("reads a socket given as a plane the same as one given as a side", () => {
    const bySide = resolveKit(corridorKit());
    const byPlane = resolveKit(
      corridorKit((pieces) =>
        pieces.map((piece) =>
          piece.name === "stairs"
            ? {
                ...piece,
                sockets: [
                  // A face a person clicked: a point on it and the way it faces. The cell is found from the point.
                  { type: "corridor", plane: { point: [0, 1500, 1200], normal: [-1, 0, 0] }, passage: true },
                  { type: "corridor", plane: { point: [6000, 300, 4000], normal: [2, 0, 0] }, passage: true },
                ],
              }
            : piece,
        ),
      ),
    );
    expect(byPlane.pieces[6]!.sockets).toEqual(bySide.pieces[6]!.sockets);
    expect(statuses(checkKit(byPlane))).toEqual(ALL_PASS);
  });

  it("measures a socket plane that is off the face of its cell", () => {
    const report = checkKit(corridorKit((pieces) => pieces.map((piece) => (piece.name === "endcap" ? { ...piece, sockets: [{ type: "corridor", plane: { point: [2990, 1500, 1500], normal: [1, 0, 0] }, passage: true }] } : piece))));
    const grid = result(report, "on-grid");
    expect(grid.status).toBe("fail");
    expect(grid.values.pieces.find((piece) => piece.piece === "endcap")!.socketOffMeters).toBe(0.01);
    expect(grid.message).toContain('a socket of "endcap" is 0.01 m from the face of its cell');
  });

  it("takes a region of the face as the part that meets", () => {
    // Only the floor meets: the walls are left out of the outline, on every piece.
    const floorOnly = corridorKit((pieces, grid) =>
      pieces.slice(0, 2).map((piece) => ({
        ...piece,
        sockets: piece.sockets!.map((socket) => {
          const { M } = sizes(grid);
          const region: [number, number, number][] = socket.side === "+x" ? [[M, 0, 0], [M, M, 0], [M, M, SLAB], [M, 0, SLAB]] : socket.side === "-x" ? [[0, 0, 0], [0, M, 0], [0, M, SLAB], [0, 0, SLAB]] : [[0, M, 0], [M, M, 0], [M, M, SLAB], [0, M, SLAB]];
          return { ...socket, region };
        }),
      })),
    );
    const report = checkKit(floorOnly);
    expect(result(report, "seams").status).toBe("pass");
    expect(result(report, "seams").values.types[0]!.outlineSquareMeters).toBeCloseTo(0.6, 2);
    expect(resolveKit(floorOnly).pieces[0]!.sockets[0]!.region).toEqual([[-1.5, -1.5], [1.5, -1.5], [1.5, -1.3], [-1.5, -1.3]]);
  });

  it("meets types in pairs when the kit says which type meets which", () => {
    const paired = corridorKit(
      (pieces) => [
        { ...pieces[0]!, sockets: [{ type: "plug", side: "+x", passage: true }, { type: "hole", side: "-x", passage: true }] },
        { ...pieces[5]!, sockets: [{ type: "hole", side: "+x", passage: true }] },
      ],
      { mates: { plug: "hole" }, layouts: [{ name: "pair", placements: [{ piece: "straight", cell: [1, 0, 0], turn: 2 }, { piece: "endcap", cell: [0, 0, 0] }] }, { name: "wrong way", placements: [{ piece: "straight", cell: [1, 0, 0] }, { piece: "endcap", cell: [0, 0, 0] }] }] },
    );
    const kit = resolveKit(paired);
    expect(kit.mates).toEqual({ plug: "hole", hole: "plug" });
    const report = checkKit(kit);
    expect(result(report, "seams").values.types).toEqual([expect.objectContaining({ type: "hole", mates: "plug", sockets: 3, pairs: 2 })]);
    const layouts = result(report, "layouts");
    expect(layouts.status).toBe("fail");
    expect(layouts.values.layouts.find((layout) => layout.name === "pair")).toMatchObject({ joints: 1, mismatched: 0 });
    expect(layouts.values.layouts.find((layout) => layout.name === "wrong way")).toMatchObject({ joints: 0, mismatched: 1 });
  });

  it("takes a piece as an asset this package already wrote", () => {
    const grid = { ...CORRIDOR_GRID, trimMeters: 0.1 };
    const pieces = corridorPieces(grid);
    const written = exportGameAsset({ source: MM_Z_UP, bodies: pieces[0]!.bodies!, collision: "pieces", pivot: [0, 0, 0], placement: "origin" });
    // In glTF space the low corner of the cells is at x 0, y 0, z 0 and the cell runs to z -3.
    const kit = resolveKit(corridorKit((all) => [{ name: "straight", glb: written.glb, origin: [0, 0, 0], sockets: [{ type: "corridor", side: "+x", passage: true }, { type: "corridor", plane: { point: [0, 1, -1.5], normal: [-1, 0, 0] }, passage: true }] }, ...all.slice(1)]));
    expect(kit.pieces[0]!.glb).toBe(written.glb);
    expect(kit.pieces[0]!.sockets.map((socket) => socket.side)).toEqual(["+x", "-x"]);
    expect(statuses(checkKit(kit))).toEqual(ALL_PASS);
  });

  it("refuses a kit it cannot read, and says what to give", () => {
    const kit = (change: Partial<KitInput>) => refusal(() => resolveKit({ ...corridorKit(), ...change } as KitInput));
    const pieces = (change: (pieces: KitPieceInput[]) => unknown) => refusal(() => resolveKit(corridorKit(change as never)));
    expect(kit({ name: "" })).toEqual({ code: "BAD_KIT", message: "A kit needs a name." });
    expect(kit({ grid: { moduleMeters: 0, storeyMeters: 3 } })).toEqual({ code: "BAD_KIT", message: "grid.moduleMeters must be a positive number of metres. Got 0." });
    expect(kit({ pivot: "center" } as never).code).toBe("BAD_KIT");
    expect(kit({ pieces: [] }).code).toBe("BAD_KIT");
    expect(kit({ mates: { a: "b", b: "c" } }).code).toBe("BAD_KIT");
    expect(pieces((all) => [all[0]!, { ...all[1]!, name: "straight" }])).toEqual({ code: "BAD_KIT", message: 'Two pieces are named "straight".' });
    expect(pieces((all) => [{ ...all[0]!, sockets: [{ type: "corridor" }] }]).code).toBe("BAD_KIT");
    expect(pieces((all) => [{ ...all[0]!, sockets: [{ type: "corridor", side: "+x" }, { type: "corridor", side: "+x" }] }]).message).toContain('two sockets are named "+x"');
    expect(pieces((all) => [{ ...all[0]!, sockets: [{ type: "corridor", plane: { point: [3000, 0, 0], normal: [1, 1, 0] } }] }]).message).toContain("turned more than 1 degree from every axis");
    expect(pieces((all) => [{ ...all[6]!, sockets: [{ type: "corridor", side: "+x", cell: [0, 0, 0] }] }]).message).toContain("faces another cell of the same piece");
    expect(pieces((all) => [{ ...all[0]!, bodies: [] }]).code).toBe("NO_BODIES");
    expect(refusal(() => checkKit(corridorKit(), { toleranceMeters: 0 })).code).toBe("BAD_OPTION");
    expect(refusal(() => checkKit(resolveKit(corridorKit()), { grid: { moduleMeters: 4, storeyMeters: 3 } })).message).toContain("cannot be checked for another grid");
  });
});
