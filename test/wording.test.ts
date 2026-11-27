// What the checks say is for a person who models parts. No message and no reason names a
// function of this package, an option key or an id: each says what is missing and what to do in
// plain words. test/plain-words.setup.ts holds every report of the whole suite to that as it is
// made. Here the rule itself is shown to bite, and every check of an asset and of a kit is
// walked through each state the fixtures bring it to.
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";
import { checkGameAsset, checkKit, CHECK_IDS, exportGameAsset, exportGameGlb, EXTRAS_KEY, KIT_CHECK_IDS, PLAYER_PROFILES, readGlb, type AssetInput, type CheckOptions, type GlbDocument, type KitGrid, type KitPieceInput } from "../src/index.js";
import { box, chamferedBlock, cylinder, doorFrame, doorway, ell, halfPaintedSide, holedBlock, joined, MM_Z_UP, moved, ramp, stairs, tube, turned, type Shape } from "./fixtures.js";
import { loadKernel } from "./kernel.js";
import { bodyOf, corridorKit, corridorPieces, doorBoxes, flatBoxes, piece, prismX, SLAB, stairsPiece, swap, WALL } from "./kit-fixtures.js";
import { ENGLISH_MESSAGES, MESSAGE_KEYS } from "../src/messages.js";
import { seen as keysSeen } from "./message-keys.js";
import { identifiersIn, textsOf, vocabularyOf, walked } from "./plain-words.js";

const vocabulary = vocabularyOf(api);
const named = (text: string) => identifiersIn(text, vocabulary);

describe("the rule", () => {
  it("knows the functions and the ids of the package", () => {
    for (const name of ["exportGameAsset", "exportGameGlb", "checkGameAsset", "checkKit", "exportGamePack", "manifoldKernel", "readPack"]) expect(vocabulary.functions).toContain(name);
    for (const id of ["small-prop", "kit-piece", "clean-mesh", "player-openings", "collision-tiles", "godot4", "unreal5", "godot4-character-body", "base-center", "face-weighted"]) expect(vocabulary.ids).toContain(id);
    // A check called by a word a sentence needs is not an id to look for.
    for (const word of ["size", "collision", "seams", "walkable"]) expect(vocabulary.ids).not.toContain(word);
  });

  it("catches what the checks said before: a function, an option key, the id of a class, a pivot, a normal rule and a player", () => {
    expect(named('No collision was written. exportGameAsset writes one unless collision is "none".')).toEqual(["exportGameAsset"]);
    expect(named("No body was given lods. Engines that make their own levels on import need none.")).toEqual(["lods"]);
    expect(named("The asset is 1 m on its longest side, a size a small-prop has.")).toEqual(["small-prop"]);
    expect(named('The pivot is at "base-center", on the 1 m grid.')).toEqual(["base-center"]);
    expect(named('12 hard edges and 6 soft edges, normals by "angle-area". Face-weighted normals are there to ask for: normals "face-weighted".')).toEqual(["angle-area", "face-weighted"]);
    expect(named("Not walkable for godot4-character-body.")).toEqual(["godot4-character-body"]);
    expect(named("Give collisionPieces, or raise maxPieces.")).toEqual(["collisionPieces", "maxPieces"]);
    expect(named("Set texcoords to have them written.")).toEqual(["texcoords"]);
  });

  it("lets plain words through, with the names people gave their own things", () => {
    for (const text of [
      'Not walkable for Godot 4 CharacterBody3D: "stairs" has a rise of 0.2 m, and this player climbs no steps.',
      'The collision of "Block" (box, 1 piece) is 14.3% more volume than the visible part, over the 5% allowed.',
      "12 triangles, against a budget of 2000 for a small prop.",
      "96 hard edges and 192 soft edges. Normals are weighted by the whole flat face each triangle belongs to.",
      "No kernel was given, and measuring what two bodies both fill needs one.",
      'Sockets of type "corridor" do not have one outline: straight/+x and corner/+x differ by 0.56 m2.',
    ]) {
      expect(named(text), text).toEqual([]);
    }
  });

  it("is held over every report the suite makes, not only the ones walked here", () => {
    const before = { ...walked };
    const report = checkGameAsset(exportGameAsset({ bodies: [{ name: "Crate", positions: box([0, 0, 0], [500, 500, 500]).positions }], source: MM_Z_UP }).glb);
    expect(walked.reports).toBe(before.reports + 1);
    expect(walked.texts).toBe(before.texts + textsOf(report).length);
    checkKit(corridorKit());
    expect(walked.reports).toBe(before.reports + 2);
  });
});

/** Walks reports, and keeps which check was seen in which state. */
function walker() {
  const seen = new Set<string>();
  const texts = new Set<string>();
  return {
    seen,
    texts,
    walk(report: Parameters<typeof textsOf>[0]): void {
      for (const { id, status, text } of textsOf(report)) {
        seen.add(`${id}: ${status}`);
        texts.add(text);
        expect(named(text), `${id} (${status}): ${text}`).toEqual([]);
        // A sentence for a person: it starts with a capital, a number or a name, and it ends.
        expect(text, `${id} (${status})`).toMatch(/^["A-Z0-9].*[.]$/s);
      }
    },
  };
}

describe("every message and reason of the asset checks", () => {
  it("is in plain words, in each state a check can be in", async () => {
    const kernel = await loadKernel();
    const { seen, texts, walk } = walker();
    const asset = (positions: ArrayLike<number>, more: Partial<AssetInput> = {}, body: Partial<AssetInput["bodies"][number]> = {}) =>
      exportGameAsset({ bodies: [{ name: "Part", positions, ...body }], source: MM_Z_UP, ...more }).glb;
    const check = (glb: Uint8Array | GlbDocument, options: CheckOptions = {}): void => walk(checkGameAsset(glb, options));

    const crate = box([0, 0, 0], [500, 500, 500]);
    const post = cylinder(150, 400, 48);
    const frame = doorFrame(3000, 300, 2800, 1200, 2200);
    const levels = (...sides: number[]) => ({ lods: sides.map((count) => ({ positions: cylinder(150, 400, count).positions })) });
    const window = (sill: number): Shape => joined(box([0, 0, 0], [3000, 300, sill]), moved(doorway(3000, 300, 2400, 1200, 2100), [0, 0, sill]));
    const flipped = Float32Array.from(crate.positions);
    flipped.set(crate.positions.subarray(6, 9), 3);
    flipped.set(crate.positions.subarray(3, 6), 6);
    const holed = holedBlock(600, 450, 120, 32).positions;
    const turnedFace = Float32Array.from(holed);
    turnedFace.set(holed.subarray(3, 6), 6);
    turnedFace.set(holed.subarray(6, 9), 3);

    // Size, pivot, budgets and material slots, for each class and each engine's unit.
    for (const profile of ["godot4", "unity6", "unreal5"] as const) check(asset(crate.positions, { profile }));
    for (const assetClass of ["small-prop", "large-prop", "kit-piece"] as const) check(asset(crate.positions), { assetClass });
    check(asset(crate.positions, { source: { unit: 1, up: "Z" } }), { budget: { maxTriangles: 4, maxVertices: 4 } });
    check(asset(box([0, 0, 0], [0.5, 0.5, 0.5]).positions));
    check(asset(box([0, 0, 0], [50_000_000, 1000, 1000]).positions));
    check(asset(box([0, 0, 0], [3000, 200, 3000]).positions), { assetClass: "kit-piece" });
    for (const pivot of ["center", "min-corner", "origin", [20000, 0, 0], [-100, 250, 0]] as const) check(asset(crate.positions, { pivot }));
    check(asset(post.positions, {}, { color: "#2980ba", faceColors: halfPaintedSide(48, "#c0392b") }), { budget: { maxMaterialSlots: 1 } });
    check(exportGameGlb({ bodies: [{ name: "Crate", positions: crate.positions }], source: MM_Z_UP }).glb);

    // Shading and the mesh itself.
    check(asset(post.positions, { normals: "face-weighted" }));
    check(asset(post.positions, { creaseAngle: 180 }));
    check(asset(ramp(4000, 2000, 500).positions, { creaseAngle: 180 }));
    check(asset(flipped));
    check(asset(turned(crate).positions));
    check(asset(crate.positions.slice(9)));
    check(asset(doorway(3000, 300, 2800, 1200, 2200).positions));
    check(asset(box([0, 0, 0], [1000, 1000, 1]).positions));

    // Collision: none, a shape that was named, and each way "auto" can come out past the tolerance.
    check(asset(crate.positions, { collision: "none" }));
    check(asset(ell(1000, 500).positions, { collision: "box" }));
    check(asset(ell(1000, 500).positions));
    check(asset(holed));
    check(asset(holed, { kernel }));
    check(asset(tube(300, 250, 1000, 24).positions, { kernel }));
    check(asset(turnedFace, { kernel }));
    check(asset(holed.slice(9), { kernel }));
    check(asset(ell(1000, 500).positions, {}, { collisionPieces: [{ positions: box([0, 0, 0], [1000, 1000, 500]).positions }] }));

    // A kernel that was given and not turned to, since the file was written to a wider share
    // than it is checked by, and one that cut as far as cuts would go.
    check(asset(ell(1000, 500).positions, { kernel, collision: { tolerance: 0.9 } }), { collisionTolerance: 0.05 });
    check(asset(tube(300, 250, 1000, 24).positions, { kernel, collision: { maxPieces: 64 } }), { collisionTolerance: 0.0001 });

    // Bodies with a pivot, a share and a shape of their own, a triangle with no area, and two
    // files as no export of this package writes them: one with no normals and one with no bodies.
    const two = (more: Partial<AssetInput>): Uint8Array =>
      exportGameAsset({ bodies: [{ name: "Crate", positions: crate.positions }, { name: "Post", positions: moved(post, [1000, 0, 0]).positions }], source: MM_Z_UP, ...more }).glb;
    check(two({ pivots: { Post: "center" } }));
    check(two({ pivots: { Post: [333, 0, 0] } }));
    check(two({ collisions: { Post: { tolerance: 0.2 } } }));
    check(two({ collision: "none", collisions: { Post: "hull" } }));
    check(asset(Float32Array.from([...crate.positions, 0, 0, 0, 0, 0, 0, 500, 0, 0])));
    const bare = readGlb(asset(crate.positions));
    delete bare.json.meshes![0]!.primitives[0]!.attributes["NORMAL"];
    check(bare);
    const empty = readGlb(asset(crate.positions, { collision: "none" }));
    const extras = empty.json.scenes![0]!.extras as Record<string, { facts: { bodies: unknown[] } }>;
    extras[EXTRAS_KEY]!.facts.bodies = [];
    empty.json.scenes![0]!.nodes = [];
    check(empty);

    // Detail levels.
    check(asset(post.positions, {}, levels(24, 12)));
    check(asset(post.positions, {}, levels(12, 24)));
    check(asset(post.positions, {}, { lods: [{ positions: cylinder(150, 400, 12).positions.slice(9) }] }));
    check(asset(post.positions, {}, levels(4)));
    check(asset(post.positions, {}, levels(48)));

    // The player: openings, steps and ramps, found and not, fitting and not, expected and not.
    for (const expect of [{}, { opening: true, stairs: true, ramp: true }]) {
      check(asset(crate.positions), { expect });
      check(asset(frame.positions), { expect });
      check(asset(doorFrame(3000, 300, 2800, 800, 2200).positions), { expect });
      check(asset(window(900).positions), { player: "unity6", expect });
      check(asset(doorFrame(3000, 300, 2800, 200, 300).positions), { expect });
      for (const profile of ["godot4", "unity6", "unreal5"] as const) {
        check(asset(stairs(5, 180, 280, 1200).positions, { profile }), { expect });
        check(asset(stairs(3, 400, 300, 1200).positions, { profile }), { expect });
        check(asset(ramp(2000, 2000, 2000).positions, { profile }), { expect });
      }
      check(asset(stairs(3, 800, 800, 1200).positions), { expect });
      check(asset(ramp(4000, 2000, 1500).positions), { expect });
      check(asset(ramp(2000, 2000, 2500).positions), { expect });
      check(asset(chamferedBlock([1000, 500, 250], 20).positions), { expect });
    }

    expect([...seen].sort()).toEqual(
      [
        "size: pass",
        "size: warn",
        "pivot: pass",
        "pivot: warn",
        "pivot: fail",
        "triangles: pass",
        "triangles: fail",
        "vertices: pass",
        "vertices: fail",
        "shading: pass",
        "shading: warn",
        "shading: fail",
        "clean-mesh: pass",
        "clean-mesh: warn",
        "clean-mesh: fail",
        "material-slots: pass",
        "material-slots: fail",
        "collision: pass",
        "collision: warn",
        "collision: fail",
        "collision: not-measured",
        "detail-levels: pass",
        "detail-levels: warn",
        "detail-levels: fail",
        "detail-levels: not-measured",
        "player-openings: pass",
        "player-openings: warn",
        "player-openings: fail",
        "player-openings: not-measured",
        "player-steps: pass",
        "player-steps: warn",
        "player-steps: fail",
        "player-steps: not-measured",
        "player-ramps: pass",
        "player-ramps: warn",
        "player-ramps: fail",
        "player-ramps: not-measured",
      ].sort(),
    );
    expect(new Set([...seen].map((one) => one.split(":")[0]))).toEqual(new Set(CHECK_IDS));
    // Each way the collision check ends: asking for pieces or a kernel, for more pieces, saying
    // why a kernel made nothing, and naming a body that is not closed.
    const said = [...texts].join("\n");
    for (const part of [
      "or a solid kernel to cut it into convex pieces, would bring it nearer.",
      "A solid kernel to cut it into convex pieces would bring it nearer.",
      "the most allowed. More pieces, or the pieces the part was built from, would bring it nearer.",
      "A kernel was given, but no convex decomposition was made.",
      "Close the mesh to have its collision measured.",
      "Write it again with a collision shape to have it measured.",
    ]) {
      expect(said, part).toContain(part);
    }
    expect(texts.size).toBeGreaterThan(120);
  });
});

describe("every message and reason of the kit checks", () => {
  it("is in plain words, in each state a check can be in", async () => {
    const kernel = await loadKernel();
    const { seen, texts, walk } = walker();
    const sizes = (grid: KitGrid): { M: number; S: number } => ({ M: grid.moduleMeters * 1000, S: grid.storeyMeters * 1000 });
    const straight = (grid: KitGrid): KitPieceInput => corridorPieces(grid)[0]!;
    const thick = (grid: KitGrid) => flatBoxes(grid, ["+x", "-x"], 300).map(([min, max]) => box(min, max));
    const threshold = (grid: KitGrid): KitPieceInput => {
      const { M } = sizes(grid);
      return { ...straight(grid), bodies: [...straight(grid).bodies!, bodyOf("threshold", [[[M - 100, 500, 150], [M + 50, M - 500, 250]]])], trim: ["threshold"] };
    };

    walk(checkKit(corridorKit()));
    walk(checkKit(corridorKit(), { player: "unity6", kernel }));
    // Off the grid: the wrong module, a pivot off a corner, and a body out of its cells.
    walk(checkKit({ ...corridorKit(), pieces: corridorPieces({ moduleMeters: 3, storeyMeters: 3, trimMeters: 0.1 }) }, { grid: { moduleMeters: 2.5, storeyMeters: 3 } }));
    walk(checkKit(corridorKit(swap((grid) => ({ ...straight(grid), pivot: [100, 0, 0] })))));
    for (const trim of [["skirting"], []]) {
      walk(checkKit(corridorKit(swap((grid) => ({ ...corridorPieces(grid)[5]!, bodies: [...corridorPieces(grid)[5]!.bodies!, bodyOf("skirting", [[[-300, 500, 0], [100, sizes(grid).M - 500, 100]]])], trim })))));
    }
    // Seams and collision that do not meet, and corners that do not line up.
    walk(checkKit(corridorKit(swap((grid) => ({ ...straight(grid), bodies: [bodyOf("straight", flatBoxes(grid, ["+x", "-x"]), { visible: joined(...thick(grid)) })] })))));
    walk(checkKit(corridorKit(swap((grid) => ({ ...straight(grid), bodies: [bodyOf("straight", flatBoxes(grid, ["+x", "-x"]), { collision: thick(grid) })] })))));
    walk(
      checkKit(
        corridorKit(
          swap((grid) => {
            const { M, S } = sizes(grid);
            const boxes = flatBoxes(grid, ["+x", "-x"]);
            const wall = prismX([[0, SLAB], [WALL, SLAB], [WALL, S - 2], [WALL - 2, S], [0, S]], 0, M);
            return { ...straight(grid), bodies: [bodyOf("straight", boxes, { visible: joined(box(...boxes[0]!), wall, box(...boxes[2]!)) })] };
          }),
        ),
      ),
    );
    walk(
      checkKit(
        corridorKit(
          swap((grid) => {
            const { M, S } = sizes(grid);
            const boxes = flatBoxes(grid, ["+x", "-x"]);
            const split: typeof boxes = [boxes[0]!, [[0, 0, SLAB], [M, WALL, 1500]], [[0, 0, 1500], [M, WALL, S]], boxes[2]!];
            return { ...straight(grid), bodies: [bodyOf("straight", boxes, { visible: joined(...split.map(([min, max]) => box(min, max))) })] };
          }),
        ),
      ),
    );
    // Layouts: trim into the next piece with and without a kernel, and layouts that do not close.
    walk(checkKit(corridorKit(swap(threshold)), { kernel }));
    walk(checkKit(corridorKit(swap(threshold))));
    walk(
      checkKit(
        corridorKit(undefined, {
          layouts: [
            { name: "gap", placements: [{ piece: "straight", cell: [0, 0, 0] }, { piece: "straight", cell: [2, 0, 0] }] },
            { name: "into a wall", placements: [{ piece: "straight", cell: [0, 0, 0] }, { piece: "endcap", cell: [1, 0, 0] }] },
            { name: "twice", placements: [{ piece: "straight", cell: [0, 0, 0] }, { piece: "doorway", cell: [0, 0, 0] }, { piece: "straight", cell: [1, 0, 0] }] },
          ],
        }),
      ),
    );
    // Walkable: a narrow doorway, steps for a player that climbs none, and nothing to walk through.
    walk(checkKit(corridorKit(swap((grid) => ({ ...corridorPieces(grid)[4]!, bodies: [bodyOf("doorway", [...flatBoxes(grid, ["+x", "-x"]), ...doorBoxes(grid, 800)])] })))));
    walk(checkKit(corridorKit(swap((grid) => stairsPiece(grid, { steps: "steps" })))));
    walk(checkKit(corridorKit((pieces) => pieces.slice(0, 6).map((piece) => ({ ...piece, sockets: piece.sockets!.map((socket) => ({ ...socket, passage: false })) })))));
    // What is not measured: no collision, no sockets, and layouts the sockets cannot build.
    walk(checkKit(corridorKit(undefined, { collision: "none" })));
    walk(checkKit(corridorKit((pieces) => pieces.slice(0, 2).map((piece) => ({ ...piece, sockets: [] })))));
    walk(checkKit(corridorKit((pieces) => [pieces[0]!, pieces[4]!, pieces[5]!])));

    // A socket whose plane is off the face of its cell, and a kit whose one socket meets nothing.
    walk(checkKit(corridorKit((pieces) => pieces.map((one) => (one.name === "endcap" ? { ...one, sockets: [{ type: "corridor", plane: { point: [2990, 1500, 1500], normal: [1, 0, 0] }, passage: true }] } : one)))));
    walk(checkKit(corridorKit((pieces) => [pieces[5]!])));
    // One end with a post to one side of its opening: turned to face itself, the outlines differ, so no seam has points to compare.
    walk(checkKit(corridorKit((_, grid) => [piece("endcap", grid, ["+x"], [[[sizes(grid).M - 200, 200, SLAB], [sizes(grid).M, 700, sizes(grid).S]]])])));
    // Sockets whose types meet nothing: no row of through pieces, nothing to put against a bend, and no ring.
    const typed = (one: KitPieceInput): KitPieceInput => ({ ...one, sockets: one.sockets!.map((socket, at) => ({ ...socket, type: at === 0 ? "plug" : "peg" })) });
    walk(checkKit(corridorKit((pieces) => [typed(pieces[0]!), typed(pieces[1]!)], { mates: { plug: "hole", peg: "slot" } })));
    // A layout of the caller's own that joins two types that do not meet, and one whose pieces stop short of each other.
    walk(
      checkKit(
        corridorKit((pieces, grid) => [...pieces, { ...piece("duct", grid, ["+x", "-x"]), sockets: [{ type: "duct", side: "+x" }, { type: "duct", side: "-x" }] }], {
          layouts: [{ name: "wrong ends", placements: [{ piece: "straight", cell: [0, 0, 0] }, { piece: "duct", cell: [1, 0, 0] }] }],
        }),
      ),
    );
    walk(
      checkKit(
        corridorKit(
          swap((grid) => {
            const { M } = sizes(grid);
            const short = flatBoxes(grid, ["+x", "-x"]).map(([min, max]): [typeof min, typeof max] => [min, [Math.min(max[0], M - 100), max[1], max[2]]]);
            return { ...straight(grid), bodies: [bodyOf("straight", short)] };
          }),
        ),
      ),
    );
    // Trim that a kernel cannot make a solid of, since it is not closed.
    walk(
      checkKit(
        corridorKit(
          swap((grid) => {
            const made = threshold(grid);
            const open = made.bodies![1]!;
            return { ...made, bodies: [made.bodies![0]!, { ...open, positions: Float32Array.from(open.positions).slice(9), faceIds: undefined }] };
          }),
        ),
        { kernel },
      ),
    );
    // A passage on a side that is a wall, a slope too steep for a careful player, and a piece
    // that brings no collision shape next to pieces that do.
    walk(checkKit(corridorKit(swap((grid) => ({ ...corridorPieces(grid)[5]!, sockets: [{ type: "corridor", side: "+x", passage: true }, { type: "wall", side: "-x", passage: true }] })))));
    walk(checkKit(corridorKit(), { player: { ...PLAYER_PROFILES.godot4, id: "careful", name: "A careful walker", walkableSlopeDeg: 20 } }));
    walk(
      checkKit(
        corridorKit(
          swap((grid) => {
            const made = corridorPieces(grid)[5]!;
            return { name: "endcap", glb: exportGameAsset({ bodies: made.bodies!, source: MM_Z_UP, collision: "none" }).glb, sockets: made.sockets! };
          }),
        ),
      ),
    );

    expect([...seen].sort()).toEqual(
      [
        "on-grid: pass",
        "on-grid: fail",
        "seams: pass",
        "seams: fail",
        "seams: not-measured",
        "in-cells: pass",
        "in-cells: fail",
        "layouts: pass",
        "layouts: fail",
        "layouts: not-measured",
        "corners: pass",
        "corners: warn",
        "corners: fail",
        "corners: not-measured",
        "walkable: pass",
        "walkable: fail",
        "walkable: not-measured",
        "collision-tiles: pass",
        "collision-tiles: fail",
        "collision-tiles: not-measured",
      ].sort(),
    );
    expect(new Set([...seen].map((one) => one.split(":")[0]))).toEqual(new Set(KIT_CHECK_IDS));
    expect(texts.size).toBeGreaterThan(40);
  });
});

describe("every key of the message catalog", () => {
  it("is brought out by the two walks above, so each template is held to what a check really says", () => {
    // The setup file rebuilds every text of every report from its key and values as the report
    // is made, and keeps the keys. A key no walk brings out would be a template nothing tests.
    const walkedBoth = ["size.expected", "on-grid.whole"].every((key) => keysSeen.has(key));
    if (!walkedBoth) return;
    expect(MESSAGE_KEYS.filter((key) => !keysSeen.has(key))).toEqual([]);
    expect([...keysSeen].filter((key) => !Object.hasOwn(ENGLISH_MESSAGES, key))).toEqual([]);
  });
});
