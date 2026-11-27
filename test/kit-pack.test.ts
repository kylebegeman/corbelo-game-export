// A kit as a pack, and a layout of its pieces as one scene.
import { validateBytes } from "gltf-validator";
import { describe, expect, it } from "vitest";
import {
  EXTRAS_KEY,
  exportBlockout,
  exportKitPack,
  GameExportError,
  packToZip,
  readAccessor,
  readGlb,
  readPack,
  resolveKit,
  sha256Hex,
  type BlockoutExtras,
  type GlbDocument,
  type KitPieceInput,
} from "../src/index.js";
import { bodyOf, corridorKit, flatBoxes, PIECE_NAMES, withLamp } from "./kit-fixtures.js";

/** The box around every mesh of a node and of the nodes under it, in the scene. Turns are quarter turns about +Y. */
function boxOf(document: GlbDocument, node: number, parent: { t: number[]; turn: number } = { t: [0, 0, 0], turn: 0 }, into = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }, only?: (name: string) => boolean) {
  const source = document.json.nodes![node]!;
  const rotation = source.rotation ?? [0, 0, 0, 1];
  const own = Math.round((2 * Math.atan2(rotation[1]!, rotation[3]!)) / (Math.PI / 2));
  const turnBy = (point: number[], turn: number): number[] => {
    let [x, , z] = point as [number, number, number];
    for (let n = ((turn % 4) + 4) % 4; n > 0; n -= 1) [x, z] = [z, -x];
    return [x, point[1]!, z];
  };
  const moved = turnBy(source.translation ?? [0, 0, 0], parent.turn);
  const here = { t: [parent.t[0]! + moved[0]!, parent.t[1]! + moved[1]!, parent.t[2]! + moved[2]!], turn: parent.turn + own };
  if (source.mesh !== undefined && (only === undefined || only(source.name ?? ""))) {
    const positions = readAccessor(document, document.json.meshes![source.mesh]!.primitives[0]!.attributes["POSITION"]!);
    for (let at = 0; at < positions.length; at += 3) {
      const point = turnBy([positions[at]!, positions[at + 1]!, positions[at + 2]!], here.turn);
      for (let axis = 0; axis < 3; axis += 1) {
        into.min[axis] = Math.min(into.min[axis]!, point[axis]! + here.t[axis]!);
        into.max[axis] = Math.max(into.max[axis]!, point[axis]! + here.t[axis]!);
      }
    }
  }
  for (const child of source.children ?? []) boxOf(document, child, here, into, only);
  return into;
}

const near = (values: number[]): number[] => values.map((value) => Math.round(value * 1e4) / 1e4 + 0);

describe("a kit pack", () => {
  const pack = exportKitPack(corridorKit(undefined, { revision: "r7", generatedAt: "2026-01-01T00:00:00Z", provenance: { part: "corridor kit" } }));
  const { manifest } = pack;

  it("has a GLB for each piece with a stable name, a scene for each layout and a manifest", () => {
    expect(pack.name).toBe("corridor");
    expect(pack.files.map((file) => file.name)).toEqual([
      ...PIECE_NAMES.map((name) => `corridor_${name}.glb`),
      ...["run", "corner", "tee", "cross", "rise", "room"].map((name) => `corridor_layout_${name}.glb`),
      "corridor.pack.json",
    ]);
    expect(manifest).toMatchObject({ schema: 1, kind: "kit", name: "corridor", revision: "r7", generatedAt: "2026-01-01T00:00:00Z", profile: "godot4", naming: { pattern: "{family}_{row}" }, assetClass: "kit-piece", provenance: { part: "corridor kit" } });
    expect(manifest.files.map((file) => [file.name, file.role, file.asset, file.row])).toEqual(PIECE_NAMES.map((name) => [`corridor_${name}.glb`, "model", `corridor_${name}`, name]));
    for (const listed of [...manifest.files, ...manifest.scenes!]) {
      const file = pack.files.find((one) => one.name === listed.name)!;
      expect(listed.bytes).toBe(file.bytes.length);
      expect(listed.sha256).toBe(sha256Hex(file.bytes));
      expect(listed.mediaType).toBe("model/gltf-binary");
    }
    expect(JSON.parse(new TextDecoder().decode(pack.files.at(-1)!.bytes))).toEqual(JSON.parse(JSON.stringify(manifest)));
  });

  it("shares its material slots: a name is one colour in every piece", () => {
    expect(manifest.materials).toEqual([{ name: "Concrete", color: "#8a8f98", baseColorFactor: expect.any(Array), files: PIECE_NAMES.map((name) => `corridor_${name}.glb`) }]);
    for (const file of manifest.files) expect(file.facts.materials.map((material) => material.name)).toEqual(["Concrete"]);
    const clash = corridorKit((pieces, grid) => [...pieces.slice(0, 6), { name: "odd", bodies: [bodyOf("odd", flatBoxes(grid, ["+x"]), { color: "#ff0000" })], sockets: [{ type: "corridor", side: "+x" }] } satisfies KitPieceInput]);
    expect(() => exportKitPack(clash)).toThrowError(expect.objectContaining({ code: "MATERIAL_CONFLICT" }) as GameExportError);
  });

  it("holds the kit's settings, its pieces with their sockets, its layouts and what a grid of tiles needs", () => {
    const kit = manifest.kit!;
    expect(kit.frame).toEqual({ up: "Z", toFile: "x, y, z in the kit is x, z, -y in the files" });
    expect(kit.grid).toEqual({ moduleMeters: 3, storeyMeters: 3, trimMeters: 0.1 });
    expect(kit.cellSize).toEqual([3, 3, 3]);
    expect(kit.mates).toEqual({});
    expect(kit.pieces.map((piece) => piece.name)).toEqual([...PIECE_NAMES]);
    expect(kit.pieces[6]).toEqual({
      name: "stairs",
      asset: "corridor_stairs",
      file: "corridor_stairs.glb",
      cells: [2, 1, 2],
      pivotMeters: [0, 0, 0],
      sockets: [
        { name: "-x@0,0,0", type: "corridor", side: "-x", cell: [0, 0, 0], passage: true, offsetMeters: 0, region: null },
        { name: "+x@1,0,1", type: "corridor", side: "+x", cell: [1, 0, 1], passage: true, offsetMeters: 0, region: null },
      ],
      trim: [],
    });
    expect(kit.layouts.map((layout) => [layout.name, layout.origin, layout.scene])).toEqual(["run", "corner", "tee", "cross", "rise", "room"].map((name) => [name, "generated", `corridor_layout_${name}.glb`]));
    expect(kit.skippedLayouts).toEqual([]);
    expect(kit.meshLibrary.cellSize).toEqual([3, 3, 3]);
    expect(kit.meshLibrary.items).toEqual(PIECE_NAMES.map((name, id) => ({ id, name: `corridor_${name}`, piece: name, file: `corridor_${name}.glb`, offset: [-1.5, -1.5, 1.5] })));
  });

  it("holds the results of the seven kit checks, and of the game checks on every piece", () => {
    const checks = manifest.kit!.checks!;
    expect(checks.status).toBe("pass");
    expect(checks.counts).toEqual({ pass: 7, warn: 0, fail: 0, notMeasured: 0 });
    expect(checks.layouts).toEqual(manifest.kit!.layouts.map(({ scene: _scene, ...layout }) => layout));
    for (const file of manifest.files) {
      expect(file.checks!.assetClass).toBe("kit-piece");
      expect(file.checks!.results.find((result) => result.id === "pivot")!.status).toBe("pass");
    }
    // The pieces are boxes laid against each other, which the clean mesh check warns about. A
    // step that is seen and a sill that is the floor are not held against a piece of a kit.
    expect(manifest.files.find((file) => file.asset === "corridor_stairs")!.checks!.results.find((result) => result.id === "player-steps")!.status).toBe("warn");
    expect(manifest.files.find((file) => file.asset === "corridor_cross")!.checks!.status).toBe("pass");
    expect(manifest.status).toBe("warn");
    const failing = exportKitPack(corridorKit((pieces, grid) => pieces.map((piece) => (piece.name === "straight" ? { ...piece, pivot: [100, 0, 0], bodies: [bodyOf("straight", flatBoxes(grid, ["+x", "-x"]))] } : piece))));
    expect(failing.manifest.kit!.checks!.status).toBe("fail");
    expect(failing.manifest.status).toBe("fail");
    expect(failing.manifest.kit!.pieces[0]!.pivotMeters).toEqual([0.1, 0, 0]);
    expect(failing.manifest.kit!.meshLibrary.items[0]!.offset).toEqual([-1.4, -1.5, 1.5]);
  });

  it("writes the same bytes for the same kit, and one archive", () => {
    const again = exportKitPack(corridorKit(undefined, { revision: "r7", generatedAt: "2026-01-01T00:00:00Z", provenance: { part: "corridor kit" } }));
    expect(again.files.map((file) => sha256Hex(file.bytes))).toEqual(pack.files.map((file) => sha256Hex(file.bytes)));
    expect(sha256Hex(packToZip(again))).toBe(sha256Hex(packToZip(pack)));
  });

  it("writes files the glTF validator has nothing to say against", async () => {
    for (const file of pack.files.filter((one) => one.name.endsWith(".glb"))) {
      const report = await validateBytes(file.bytes);
      expect([...new Set(report.issues.messages.map((message: { code: string }) => message.code))]).toEqual(["UNUSED_MESH_TANGENT"]);
      expect(report.issues).toMatchObject({ numErrors: 0, numWarnings: 0, numHints: 0 });
    }
  });

  it("leaves out what it is told to leave out", () => {
    const bare = exportKitPack(corridorKit(undefined, { checks: false, pieceChecks: false, scenes: false }));
    expect(bare.files.map((file) => file.name)).toEqual([...PIECE_NAMES.map((name) => `corridor_${name}.glb`), "corridor.pack.json"]);
    expect(bare.manifest.scenes).toBeUndefined();
    expect(bare.manifest.status).toBeUndefined();
    expect(bare.manifest.kit!.checks).toBeUndefined();
    expect(bare.manifest.kit!.layouts.every((layout) => layout.scene === undefined)).toBe(true);
    expect(bare.manifest.files.every((file) => file.checks === undefined)).toBe(true);
    // The pieces themselves are the same files.
    expect(bare.files.slice(0, 7).map((file) => sha256Hex(file.bytes))).toEqual(exportKitPack(corridorKit()).files.slice(0, 7).map((file) => sha256Hex(file.bytes)));
  });

  it("refuses options it cannot read, and a scene that would take a piece's file name", () => {
    expect(() => exportKitPack(corridorKit(undefined, { revision: "" }))).toThrowError(expect.objectContaining({ code: "BAD_PACK" }) as GameExportError);
    expect(() => exportKitPack(corridorKit(undefined, { checks: { grid: { moduleMeters: 4, storeyMeters: 3 } } as never }))).toThrowError(expect.objectContaining({ code: "BAD_PACK" }) as GameExportError);
    const clash = corridorKit((pieces) => [...pieces, { ...pieces[5]!, name: "layout run" }]);
    expect(() => exportKitPack(clash)).toThrowError(expect.objectContaining({ code: "BAD_KIT", message: expect.stringContaining('both come out named "corridor_layout_run"') as string }) as GameExportError);
  });
});

describe("a blockout", () => {
  const kit = resolveKit(corridorKit());
  const room = exportBlockout(kit, "room");

  it("is one scene with one node for each placement, and every mesh stored once", () => {
    const { facts } = room;
    expect(facts).toMatchObject({ schema: 1, kind: "blockout", kit: "corridor", layout: "room", origin: "generated", profile: "godot4", cellSize: [3, 3, 3], pieces: 3 });
    // Eight pieces in their places are three meshes: the corner four times, the straight and the doorway twice each.
    expect(facts.meshes).toEqual({ total: 17, visible: 3, collision: 14 });
    expect(facts.nodes).toEqual({ total: 46, placements: 8, visible: 8, collision: 38 });
    expect(facts.materials).toBe(1);
    expect(facts.triangles.drawn).toBeGreaterThan(facts.triangles.stored);
    expect(facts.bounds).toEqual({ min: [0, 0, -9], max: [9, 3, 0], size: [9, 3, 9] });

    const document = readGlb(room.glb);
    expect(document.json.scenes).toHaveLength(1);
    expect(document.json.scenes![0]!.nodes).toHaveLength(8);
    expect(document.json.meshes).toHaveLength(17);
    expect(document.json.nodes).toHaveLength(46);
    const corners = document.json.nodes!.filter((node) => /^corridor_corner(_\d+){3}$/.test(node.name ?? ""));
    expect(corners).toHaveLength(4);
    expect(new Set(corners.map((node) => node.mesh)).size).toBe(1);
    // Node names are unique in the file, and a collision shape keeps the ending Godot reads.
    const names = document.json.nodes!.map((node) => node.name!);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    expect(names.filter((name) => name.endsWith("-convcolonly"))).toHaveLength(38);
    expect(names).toContain("corridor_doorway_1_0_0_00-convcolonly");
    expect((document.json.scenes![0]!.extras![EXTRAS_KEY] as BlockoutExtras).blockout).toEqual(JSON.parse(JSON.stringify(facts)));
    // The reader of single assets takes it as a file without asset facts.
    expect(readPack(room.glb).facts).toBeNull();
  });

  it("puts every piece in its cell, turned, with its collision", () => {
    const document = readGlb(room.glb);
    for (const placement of room.facts.placements) {
      const [i, j, k] = placement.cell;
      const expected = { min: [i * 3, k * 3, -(j + 1) * 3], max: [(i + 1) * 3, (k + 1) * 3, -j * 3 + 0] };
      const seen = boxOf(document, placement.node, undefined, undefined, (name) => !name.endsWith("-convcolonly"));
      expect({ min: near(seen.min), max: near(seen.max) }).toEqual(expected);
      const collision = boxOf(document, placement.node, undefined, undefined, (name) => name.endsWith("-convcolonly"));
      expect({ min: near(collision.min), max: near(collision.max) }).toEqual(expected);
      expect(document.json.nodes![placement.node]!.name).toBe(`${placement.asset}_${placement.cell.join("_")}`);
    }
    // The doorway at the far side is turned half way round: its frame is still across the corridor.
    const far = room.facts.placements.find((placement) => placement.piece === "doorway" && placement.cell[1] === 2)!;
    expect(far).toMatchObject({ turn: 2, degrees: 180, translation: [6, 0, -9] });
    expect(document.json.nodes![far.node]!.rotation).toEqual([0, 1, 0, 0]);
  });

  it("takes a layout as piece, cell and quarter turn, with cells below zero", () => {
    const given = exportBlockout(kit, { name: "two ways", placements: [{ piece: "tee", cell: [0, 0, 0] }, { piece: "endcap", cell: [-1, 0, 0] }, { piece: "stairs", cell: [1, 0, 0] }, { piece: "endcap", cell: [0, 1, 0], turn: 3 }] });
    expect(given.facts).toMatchObject({ layout: "two ways", origin: "given", pieces: 3 });
    expect(given.facts.placements.map((placement) => placement.name)).toEqual(["corridor_tee_0_0_0", "corridor_endcap_n1_0_0", "corridor_stairs_1_0_0", "corridor_endcap_0_1_0"]);
    expect(given.facts.bounds).toEqual({ min: [-3, 0, -6], max: [9, 6, 0], size: [12, 6, 6] });
    const document = readGlb(given.glb);
    const stairs = boxOf(document, given.facts.placements[2]!.node);
    expect({ min: near(stairs.min), max: near(stairs.max) }).toEqual({ min: [3, 0, -3], max: [9, 6, 0] });
    // The same layout by name, when the kit has it.
    const named = resolveKit(corridorKit(undefined, { layouts: [{ name: "two ways", placements: [{ piece: "tee", cell: [0, 0, 0] }, { piece: "endcap", cell: [-1, 0, 0] }, { piece: "stairs", cell: [1, 0, 0] }, { piece: "endcap", cell: [0, 1, 0], turn: 3 }] }] }));
    expect(sha256Hex(exportBlockout(named, "two ways").glb)).toBe(sha256Hex(given.glb));
  });

  it("keeps a piece's pivot where the kit put it", () => {
    const off = resolveKit(corridorKit((pieces) => pieces.map((piece) => (piece.name === "endcap" ? { ...piece, pivot: [1500, 1500, 0] } : piece))));
    const scene = exportBlockout(off, { name: "one", placements: [{ piece: "endcap", cell: [2, 1, 0], turn: 1 }] });
    // The pivot is the middle of the cell's floor, which a quarter turn does not move.
    expect(scene.facts.placements[0]!.translation).toEqual([7.5, 0, -4.5]);
    const seen = boxOf(readGlb(scene.glb), scene.facts.placements[0]!.node);
    expect({ min: near(seen.min), max: near(seen.max) }).toEqual({ min: [6, 0, -6], max: [9, 3, -3] });
  });

  it("holds a piece of several bodies under one node of its own", () => {
    const two = resolveKit(corridorKit((pieces) => pieces.map((piece) => (piece.name === "endcap" ? { ...piece, bodies: [...piece.bodies!, bodyOf("lamp", [[[1400, 1400, 2000], [1600, 1600, 2100]]])] } : piece))));
    const scene = exportBlockout(two, { name: "one", placements: [{ piece: "endcap", cell: [0, 0, 0] }, { piece: "endcap", cell: [1, 0, 0], turn: 2 }] });
    const document = readGlb(scene.glb);
    const holder = document.json.nodes![scene.facts.placements[1]!.node]!;
    expect(holder.name).toBe("corridor_endcap_1_0_0");
    expect(holder.mesh).toBeUndefined();
    expect(holder.children!.map((child) => document.json.nodes![child]!.name)).toEqual(["endcap_1_0_0", "lamp_1_0_0"]);
    expect(scene.facts.nodes).toMatchObject({ placements: 2, visible: 4 });
    expect(scene.facts.meshes.visible).toBe(2);
  });

  it("says which nodes hold the detail levels of a piece, in each of its places", () => {
    const lit = resolveKit(corridorKit(withLamp));
    const scene = exportBlockout(lit, { name: "pair", placements: [{ piece: "endcap", cell: [0, 0, 0] }, { piece: "endcap", cell: [2, 0, 0], turn: 2 }, { piece: "straight", cell: [1, 0, 0] }] });
    const document = readGlb(scene.glb);
    expect(scene.facts.lods!.map((group) => [group.placement, group.body, group.levels.map((level) => level.name)])).toEqual([
      [0, "lamp_0_0_0", ["lamp_0_0_0", "lamp_0_0_0_LOD1", "lamp_0_0_0_LOD2"]],
      [1, "lamp_2_0_0", ["lamp_2_0_0", "lamp_2_0_0_LOD1", "lamp_2_0_0_LOD2"]],
    ]);
    for (const group of scene.facts.lods!) {
      expect(group.levels.map((level) => level.level)).toEqual([0, 1, 2]);
      for (const level of group.levels) expect(document.json.nodes![level.node]!.name).toBe(level.name);
      // The lower levels are further from full detail, each more than the one before, and as far as the piece's own facts say.
      const piece = lit.pieces.find((one) => one.name === "endcap")!.facts.bodies.find((body) => body.name === "lamp")!;
      expect(group.levels.map((level) => level.deviationMeters)).toEqual(piece.lods!.map((level) => level.deviation.meters));
      expect(group.levels[0]!.deviationMeters).toBe(0);
      expect(group.levels[2]!.deviationMeters).toBeGreaterThan(group.levels[1]!.deviationMeters);
      expect(group.levels[1]!.deviationMeters).toBeGreaterThan(0);
    }
    // Both places show the same three meshes.
    const meshes = scene.facts.lods!.map((group) => group.levels.map((level) => document.json.nodes![level.node]!.mesh));
    expect(meshes[0]).toEqual(meshes[1]);
    // A layout of pieces without detail levels says nothing about them.
    expect(room.facts.lods).toBeUndefined();
  });

  it("writes the same bytes for the same layout, whatever order the placements come in", () => {
    expect(sha256Hex(exportBlockout(kit, "room").glb)).toBe(sha256Hex(room.glb));
    expect(sha256Hex(exportBlockout(corridorKit(), "room").glb)).toBe(sha256Hex(room.glb));
    const forward = exportBlockout(kit, { name: "pair", placements: [{ piece: "endcap", cell: [0, 0, 0] }, { piece: "straight", cell: [1, 0, 0] }] });
    const backward = exportBlockout(kit, { name: "pair", placements: [{ piece: "straight", cell: [1, 0, 0] }, { piece: "endcap", cell: [0, 0, 0] }] });
    // The meshes are stored in the kit's order either way.
    expect(readGlb(forward.glb).json.meshes!.map((mesh) => mesh.name)).toEqual(readGlb(backward.glb).json.meshes!.map((mesh) => mesh.name));
  });

  it("refuses a layout the kit does not have", () => {
    expect(() => exportBlockout(kit, "attic")).toThrowError(expect.objectContaining({ code: "BAD_LAYOUT", message: 'The kit has no layout named "attic".' }) as GameExportError);
    const noBends = resolveKit(corridorKit((pieces) => [pieces[0]!, pieces[5]!]));
    expect(() => exportBlockout(noBends, "room")).toThrowError(expect.objectContaining({ code: "BAD_LAYOUT", message: expect.stringMatching(/^The kit has no "room" layout: /) as string }) as GameExportError);
    expect(() => exportBlockout(kit, { name: "x", placements: [{ piece: "nothing", cell: [0, 0, 0] }] })).toThrowError(expect.objectContaining({ code: "BAD_LAYOUT" }) as GameExportError);
  });
});
