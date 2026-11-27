// Proof with a real engine, with no window: a kit's closed room is walked on the collision its
// file brought, the add-on in `addons/` imports packs that `install` put in a project and keeps
// what the game did to them when a changed pack is installed, and the kit's MeshLibrary paints
// a GridMap.
//
// Needs a `godot` 4 program on PATH (or its path in the GODOT environment variable). Without
// one, every test here is skipped and a line on standard error says why.
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportGamePack, exportKitPack, LOCK_FILE_NAME, packToZip, parseLock, type BlockoutFacts, type GamePack, type KitManifest, type KitPlacement } from "../src/index.js";
import { installPack, projectStatus } from "../src/node.js";
import { cylinder, halfPaintedSide, MM_Z_UP } from "./fixtures.js";
import { godotUsable, reportOf, runGodot } from "./godot-tools.js";
import { corridorKit, withLamp } from "./kit-fixtures.js";

const usable = godotUsable("the Godot proof of kits, the add-on and install");
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_FILE = 'config_version=5\n\n[application]\n\nconfig/name="corbelo-game-export kit proof"\n';
const ADDON_ON = '\n[editor_plugins]\n\nenabled=PackedStringArray("res://addons/corbelo_game_export/plugin.cfg")\n';

interface Box {
  min: number[];
  max: number[];
}

interface SeenMaterial {
  name: string;
  path: string;
  albedo?: string;
}

interface SeenNode {
  name: string;
  class: string;
  path: string;
  visible?: boolean;
  position?: number[];
  /** Only on a mesh: where it starts and stops being drawn, in metres. 0 for no limit. */
  range?: [number, number];
  box?: Box;
  /** The same number for two nodes that show one mesh. */
  mesh?: number;
  surfaces?: { material: SeenMaterial | null; override: SeenMaterial | null }[];
  /** Only on a CollisionShape3D: the class of its shape and of the body it is in. */
  shape?: string;
  body?: string;
}

interface SeenScene {
  error?: string;
  root: { name: string; class: string; meta: { pack: string; detail_levels: number } | null };
  nodes: SeenNode[];
}

interface SeenLibrary {
  items: { id: number; name: string; box: Box; shapes: string[]; shapePlaces: number[][]; materials: (SeenMaterial | null)[] }[];
  meta: { pack: string; manifest_sha256: string } | null;
}

interface SeenGrid {
  class: string;
  name: string;
  cellSize: number[];
  cells: { cell: number[]; item: string }[];
  boxes: Box[];
}

interface SeenLeg {
  feet: number[];
  onFloor: boolean;
  onWall: boolean;
  lowest: number;
  highest: number;
}

interface SeenWalk {
  player: { radius: number; height: number };
  bodies: number;
  shapes: number;
  landed: { feet: number[]; onFloor: boolean };
  legs: SeenLeg[];
}

type Step = Record<string, unknown> & { do: "scene" | "edit" | "material" | "library" | "paint" | "walk" };

/** A throwaway Godot project in a folder whose name has spaces. */
function newProject(addon: boolean): string {
  const project = mkdtempSync(join(tmpdir(), "corbelo game export godot "));
  writeFileSync(join(project, "project.godot"), PROJECT_FILE + (addon ? ADDON_ON : ""));
  copyFileSync(join(HERE, "godot/proof.gd"), join(project, "proof.gd"));
  // The add-on as a person installs it: its folder copied into the project's `addons`.
  if (addon) cpSync(join(HERE, "../addons/corbelo_game_export"), join(project, "addons/corbelo_game_export"), { recursive: true });
  return project;
}

/** The editor's own import, with no window. Nothing may go wrong in it, and nothing may be warned of. */
function importProject(project: string): string {
  const output = runGodot(project, ["--import"]);
  expect(output.split("\n").filter((line) => /^\s*(SCRIPT ERROR|ERROR|WARNING):/.test(line)), output).toEqual([]);
  return output;
}

/** Runs the steps in the project and returns what each found. */
function prove(project: string, steps: Step[]): unknown[] {
  writeFileSync(join(project, "proof.json"), JSON.stringify({ steps }));
  const output = runGodot(project, ["--fixed-fps", "60", "--script", "res://proof.gd"]);
  expect(output.split("\n").filter((line) => /^\s*(SCRIPT ERROR|ERROR):/.test(line)), output).toEqual([]);
  return reportOf<{ steps: unknown[] }>(output).steps;
}

/** Every file of the project that is the project's own, with its checksum: not Godot's cache. */
function filesOf(project: string, folder = ""): Record<string, string> {
  const found: Record<string, string> = {};
  for (const name of readdirSync(join(project, folder)).sort()) {
    const path = folder === "" ? name : `${folder}/${name}`;
    if (path === ".godot" || path === "proof.json") continue;
    if (statSync(join(project, path)).isDirectory()) Object.assign(found, filesOf(project, path));
    else found[path] = createHash("sha256").update(readFileSync(join(project, path))).digest("hex");
  }
  return found;
}

const rounded = (values: readonly number[]): number[] => values.map((value) => Math.round(value * 1e3) / 1e3 + 0);
const boxText = (box: Box): string => JSON.stringify([rounded(box.min), rounded(box.max)]);

/** Where the GridMap has a placement: the kit's cell `[i, j, k]` is the GridMap's `(i, k, -j - 1)`, and a quarter turn is one about +Y. */
function gridCell(placement: KitPlacement, item: string): { item: string; cell: number[]; turn: number } {
  return { item, cell: [placement.cell[0], placement.cell[2], -placement.cell[1] - 1], turn: placement.turn };
}

/**
 * The room is a ring of eight cells of 3 m around an empty one. The player starts in the first
 * corner, walks along +X through the doorway into the next corner until the wall there stops
 * it, then along the corridor to the corner after that until that wall stops it.
 */
const ROOM_WALK = { start: [1.5, 0.2, -1.5], legs: [{ direction: [1, 0], seconds: 5 }, { direction: [0, -1], seconds: 5 }] };
/** The same start, 0.75 m to the side: on the line of the doorway's post. */
const POST_WALK = { start: [1.5, 0.2, -0.75], legs: [{ direction: [1, 0], seconds: 5 }] };

function expectRoomWalked(walk: SeenWalk, blocked: SeenWalk): void {
  // The capsule Godot makes by default: 1 m across and 2 m tall. The doorway is 1.4 m by 2.3 m.
  expect(walk.player).toEqual({ radius: 0.5, height: 2 });
  // It stands on the floor slab, 0.2 m thick, from the first step to the last.
  expect(walk.landed.onFloor).toBe(true);
  expect(walk.landed.feet[1]).toBeCloseTo(0.2, 2);
  const [through, along] = walk.legs as [SeenLeg, SeenLeg];
  // Through the doorway, whose frame is at 4.4 m to 4.6 m, and on until the wall at 8.8 m.
  expect(through.feet[0]).toBeCloseTo(8.8 - 0.5, 2);
  expect(through.feet[2]).toBeCloseTo(-1.5, 2);
  expect(through.onWall).toBe(true);
  // Then along the corridor, 6.8 m, until the wall at the far end.
  expect(along.feet[2]).toBeCloseTo(-(8.8 - 0.5), 2);
  expect(along.feet[0]).toBeCloseTo(8.8 - 0.5, 2);
  expect(along.onWall).toBe(true);
  for (const leg of walk.legs) {
    expect(leg.onFloor).toBe(true);
    expect(leg.lowest).toBeGreaterThan(0.19);
    expect(leg.highest).toBeLessThan(0.21);
  }
  // On the line of the post, the post stops it: its near face is at 4.4 m.
  expect(blocked.legs[0]!.feet[0]).toBeCloseTo(4.4 - 0.5, 2);
  expect(blocked.legs[0]!.onWall).toBe(true);
}

describe.skipIf(!usable)("a kit's closed room in Godot 4", () => {
  let project: string;
  afterAll(() => rmSync(project, { recursive: true, force: true }));

  it("imports as one scene, and a player walks through the doorway and along the corridor until a wall stops it", () => {
    const pack = exportKitPack(corridorKit());
    const listed = pack.manifest.scenes!.find((scene) => scene.layout === "room")!;
    const facts = listed.facts as unknown as BlockoutFacts;
    project = newProject(false);
    writeFileSync(join(project, "room.glb"), pack.files.find((file) => file.name === listed.name)!.bytes);
    importProject(project);
    const [scene, walk, blocked] = prove(project, [
      { do: "scene", path: "res://room.glb" },
      { do: "walk", path: "res://room.glb", ...ROOM_WALK },
      { do: "walk", path: "res://room.glb", ...POST_WALK },
    ]) as [SeenScene, SeenWalk, SeenWalk];

    // One scene: a node for each placement under its root, by the names the facts give.
    const placed = scene.nodes.filter((node) => !node.path.includes("/"));
    expect(placed.map((node) => node.name)).toEqual(facts.placements.map((placement) => placement.name));
    expect(placed.every((node) => node.class === "MeshInstance3D")).toBe(true);
    // A piece placed many times is one mesh in Godot too: eight nodes show three meshes.
    expect(placed).toHaveLength(facts.nodes.visible);
    expect(new Set(placed.map((node) => node.mesh)).size).toBe(facts.meshes.visible);
    expect([facts.nodes.visible, facts.meshes.visible]).toEqual([8, 3]);
    // Every piece is in its cell.
    const cells = facts.placements.map((placement) => boxText({ min: [placement.cell[0] * 3, 0, -(placement.cell[1] + 1) * 3], max: [(placement.cell[0] + 1) * 3, 3, -placement.cell[1] * 3] }));
    expect(placed.map((node) => boxText(node.box!))).toEqual(cells);
    // The collision is the file's: a static body with a convex shape for each collision node, and nothing else.
    const shapes = scene.nodes.filter((node) => node.class === "CollisionShape3D");
    expect(shapes).toHaveLength(facts.nodes.collision);
    expect(shapes.every((node) => node.shape === "ConvexPolygonShape3D" && node.body === "StaticBody3D")).toBe(true);
    expect([walk.bodies, walk.shapes]).toEqual([facts.nodes.collision, facts.nodes.collision]);

    expectRoomWalked(walk, blocked);
  });
});

describe.skipIf(!usable)("the Godot add-on", () => {
  let project: string;
  let packs: string;
  const post = (revision: string, radius: number): GamePack =>
    exportGamePack({
      name: "post",
      source: MM_Z_UP,
      bodies: [
        {
          name: "Post",
          positions: cylinder(radius, 400, 48).positions,
          color: "#8a5a2b",
          materialName: "Wood",
          faceColors: halfPaintedSide(48, "#c0392b"),
          faceMaterialNames: { "#c0392b": "Paint" },
          lods: [{ positions: cylinder(radius, 400, 24).positions }, { positions: cylinder(radius, 400, 12).positions }],
        },
      ],
      collision: "hull",
      revision,
      provenance: { part: "post", revision },
    });
  const kit = (revision: string, reversed = false): GamePack => exportKitPack({ ...corridorKit((pieces) => (reversed ? withLamp(pieces).reverse() : withLamp(pieces))), revision });
  const archive = (name: string, pack: GamePack): string => {
    const path = join(packs, `${name}.zip`);
    writeFileSync(path, packToZip(pack));
    return path;
  };
  const manifestOf = (pack: GamePack): KitManifest => pack.manifest.kit!;
  let firstKit: GamePack;
  let afterFirstImport: Record<string, string>;

  beforeAll(() => {
    project = newProject(true);
    packs = mkdtempSync(join(tmpdir(), "corbelo game export packs "));
    firstKit = kit("k1");
    // The packs go in with `install`, as they would into a game.
    expect(installPack(archive("post r1", post("r1", 150)), project).counts).toMatchObject({ added: 2 });
    expect(installPack(archive("corridor k1", firstKit), project).pack).toBe("corridor");
    const output = importProject(project);
    expect(output).toContain("Corbelo Game Export: post: 2 materials made, 1 file imported again, 1 scene made");
    expect(output).toContain("Corbelo Game Export: corridor: 2 materials made, 13 files imported again, 13 scenes made, mesh library written, grid map scene made");
    afterFirstImport = filesOf(project);
  }, 240_000);

  afterAll(() => {
    rmSync(project, { recursive: true, force: true });
    rmSync(packs, { recursive: true, force: true });
  });

  it("gives a scene for each asset, with its collision body, its detail levels on visibility ranges and the project's own materials", () => {
    expect(existsSync(join(project, "assets/post/post.tscn"))).toBe(true);
    // The scene inherits the imported file and states nothing of its own.
    const text = readFileSync(join(project, "assets/post/post.tscn"), "utf8");
    expect(text).toMatch(/^\[gd_scene format=3 uid="uid:\/\/[a-z0-9]+"\]\n\n\[ext_resource type="PackedScene" uid="uid:\/\/[a-z0-9]+" path="res:\/\/assets\/post\/post\.glb" id="1_pack"\]\n\n\[node name="[^"]+" instance=ExtResource\("1_pack"\)\]\n$/);
    const [scene] = prove(project, [{ do: "scene", path: "res://assets/post/post.tscn" }]) as [SeenScene];
    expect(scene.nodes.map((node) => `${node.class} ${node.path}`)).toEqual([
      "MeshInstance3D post",
      "MeshInstance3D post/post_LOD1",
      "MeshInstance3D post/post_LOD2",
      "StaticBody3D post/post_00",
      "CollisionShape3D post/post_00/CollisionShape3D",
    ]);
    expect(scene.nodes[4]).toMatchObject({ shape: "ConvexPolygonShape3D", body: "StaticBody3D" });
    // Each level is shown, and drawn from where the one before it stops: one level at a time.
    const levels = scene.nodes.slice(0, 3);
    expect(levels.every((node) => node.visible === true)).toBe(true);
    const [full, lower, lowest] = levels.map((node) => node.range!) as [[number, number], [number, number], [number, number]];
    expect(full[0]).toBe(0);
    expect(full[1]).toBe(lower[0]);
    expect(lower[1]).toBe(lowest[0]);
    expect(lowest[1]).toBe(0);
    // A level starts where it is about a pixel away from full detail: 700 m for each metre, and at least 1 m on.
    const stated = post("r1", 150).manifest.files[0]!.facts.bodies[0]!.lods!.map((level) => level.deviation.meters);
    expect(lower[0]).toBeCloseTo(Math.max(stated[1]! * 700, 1), 4);
    expect(lowest[0]).toBeCloseTo(Math.max(stated[2]! * 700, lower[0] + 1), 4);
    expect(lowest[0]).toBeGreaterThan(lower[0]);
    expect(scene.root.meta).toEqual({ pack: "post", detail_levels: 3 });
    // The materials are files of the project, by the names the pack gives them, in the pack's colours.
    expect(scene.nodes[0]!.surfaces!.map((surface) => surface.material)).toEqual([
      { name: "Paint", path: "res://assets/post/materials/Paint.tres", albedo: "#c0392b" },
      { name: "Wood", path: "res://assets/post/materials/Wood.tres", albedo: "#8a5a2b" },
    ]);
    expect(levels.slice(1).every((node) => node.surfaces!.every((surface) => surface.material!.path === "res://assets/post/materials/Wood.tres"))).toBe(true);
  });

  it("wires the detail levels of a piece in every place of a layout's scene", () => {
    const run = firstKit.manifest.scenes!.find((scene) => scene.layout === "run")!;
    const facts = run.facts as unknown as BlockoutFacts;
    const [scene] = prove(project, [{ do: "scene", path: `res://assets/corridor/${run.name.replace(/\.glb$/, ".tscn")}` }]) as [SeenScene];
    // The run ends in an end cap at each end, and each has a lamp with three levels.
    expect(facts.lods).toHaveLength(2);
    for (const group of facts.lods!) {
      const nodes = group.levels.map((level) => scene.nodes.find((node) => node.name === level.name)!);
      expect(nodes.every((node) => node.visible === true)).toBe(true);
      expect(nodes[0]!.range![0]).toBe(0);
      expect(nodes[1]!.range![0]).toBeGreaterThan(0);
      expect(nodes.map((node) => node.range![1])).toEqual([nodes[1]!.range![0], nodes[2]!.range![0], 0]);
    }
    expect(scene.root.meta).toEqual({ pack: "corridor", detail_levels: 6 });
  });

  it("builds the kit's MeshLibrary, and a GridMap paints the room and is walked", () => {
    const manifest = manifestOf(firstKit);
    const room = manifest.layouts.find((layout) => layout.name === "room")!;
    const itemOf = (piece: string): string => manifest.meshLibrary.items.find((item) => item.piece === piece)!.name;
    const cells = room.placements.map((placement) => gridCell(placement, itemOf(placement.piece)));
    const [library, one, painted, scene, walk, blocked] = prove(project, [
      { do: "library", path: "res://assets/corridor/corridor.meshlib" },
      { do: "paint", gridMap: "res://assets/corridor/corridor_gridmap.tscn", cells: [gridCell({ piece: "stairs", cell: [2, 1, 0], turn: 1 }, itemOf("stairs"))] },
      { do: "paint", gridMap: "res://assets/corridor/corridor_gridmap.tscn", cells },
      { do: "scene", path: "res://assets/corridor/corridor_layout_room.tscn" },
      { do: "walk", gridMap: "res://assets/corridor/corridor_gridmap.tscn", cells, ...ROOM_WALK },
      { do: "walk", gridMap: "res://assets/corridor/corridor_gridmap.tscn", cells, ...POST_WALK },
    ]) as [SeenLibrary, SeenGrid, SeenGrid, SeenScene, SeenWalk, SeenWalk];

    // An item for each piece: the number and the name the manifest gives it, its mesh around
    // the middle of its first cell, and a collision shape for each of its collision pieces.
    expect(library.items.map((item) => [item.id, item.name])).toEqual(manifest.meshLibrary.items.map((item) => [item.id, item.name]));
    for (const item of library.items) {
      const piece = firstKit.manifest.files.find((file) => file.asset === item.name)!;
      const cellsOf = manifest.pieces.find((one) => one.asset === item.name)!.cells;
      expect(boxText(item.box)).toBe(boxText({ min: [-1.5, -1.5, 1.5 - cellsOf[1] * 3], max: [cellsOf[0] * 3 - 1.5, cellsOf[2] * 3 - 1.5, 1.5] }));
      expect(item.shapes).toHaveLength(piece.facts.bodies.reduce((sum, body) => sum + (body.collision?.nodes.length ?? 0), 0));
      expect(item.shapes.every((shape) => shape === "ConvexPolygonShape3D")).toBe(true);
      expect(item.shapePlaces.every((place) => boxText({ min: place, max: place }) === boxText({ min: [-1.5, -1.5, 1.5], max: [-1.5, -1.5, 1.5] }))).toBe(true);
      expect(item.materials.every((material) => material!.path === `res://assets/corridor/materials/${material!.name}.tres`)).toBe(true);
    }
    // The end cap has a lamp: two bodies in one item, a surface each, and only their full detail.
    expect(library.items.find((item) => item.name === "corridor_endcap")!.materials.map((material) => material!.name)).toEqual(["Concrete", "Glass"]);
    expect(library.meta!.pack).toBe("corridor");

    // The GridMap scene: the kit's cells, and one painted piece where its cells are. The stairs
    // are two cells long and two storeys tall, here turned to run along the kit's +Y.
    expect(one).toMatchObject({ class: "GridMap", cellSize: [3, 3, 3], cells: [{ cell: [2, 0, -2], item: "corridor_stairs" }] });
    expect(one.boxes.map(boxText)).toEqual([boxText({ min: [6, 0, -9], max: [9, 6, -3] })]);
    // The room painted cell by cell is the room of the layout's scene, piece for piece.
    const placed = scene.nodes.filter((node) => !node.path.includes("/"));
    expect(painted.boxes.map(boxText).sort()).toEqual(placed.map((node) => boxText(node.box!)).sort());
    expect(painted.cells).toHaveLength(8);
    // And it is walked on the collision the library's items brought, as the scene is.
    expect(walk.shapes).toBe(0);
    expectRoomWalked(walk, blocked);
  });

  it("changes nothing when the project is imported again", () => {
    const output = importProject(project);
    expect(output).not.toContain("Corbelo Game Export:");
    expect(filesOf(project)).toEqual(afterFirstImport);
    // Godot and the add-on left the pack's own files as `install` put them.
    expect(projectStatus(project).ok).toBe(true);
  });

  it("updates in place when a changed pack is installed: the game's material override, its added node and the project's materials stay", () => {
    // What a game does: a material of its own on one surface, a node of its own under the
    // mesh, another colour for one of the project's materials, and a piece painted on a grid.
    const [edited, recoloured] = prove(project, [
      { do: "edit", path: "res://assets/post/post.tscn", mesh: "post", surface: 0, albedo: "#00ff00", child: "Marker" },
      { do: "material", path: "res://assets/post/materials/Wood.tres", albedo: "#112233" },
    ]) as [{ saved: boolean }, { saved: boolean }];
    expect([edited.saved, recoloured.saved]).toEqual([true, true]);
    const text = readFileSync(join(project, "assets/post/post.tscn"), "utf8");
    // Godot saved it as a scene that still inherits the file: it holds the override and the node, and no mesh.
    expect(text).toContain('instance=ExtResource("');
    expect(text).toContain('[node name="Marker" type="Node3D" parent="post"');
    expect(text).not.toContain("ArrayMesh");
    const [before, libraryBefore] = prove(project, [
      { do: "scene", path: "res://assets/post/post.tscn" },
      { do: "library", path: "res://assets/corridor/corridor.meshlib" },
    ]) as [SeenScene, SeenLibrary];
    expect(rounded(before.nodes[0]!.box!.max)).toEqual([0.15, 0.4, 0.15]);

    // A new revision of each pack: a thicker post, and the kit with its pieces in another order.
    const result = installPack(archive("post r2", post("r2", 200)), project);
    expect(result).toMatchObject({ pack: "post", from: { revision: "r1" }, to: { revision: "r2" }, inTheBuild: { revision: "r1" }, pinned: false });
    expect(result.changes.map((change) => [change.path, change.change])).toEqual([
      ["assets/post/post.glb", "changed"],
      ["assets/post/post.pack.json", "changed"],
    ]);
    const secondKit = kit("k2", true);
    expect(manifestOf(secondKit).meshLibrary.items.map((item) => item.name)).toEqual([...manifestOf(firstKit).meshLibrary.items.map((item) => item.name)].reverse());
    installPack(archive("corridor k2", secondKit), project);
    const lock = parseLock(readFileSync(join(project, LOCK_FILE_NAME), "utf8"));
    expect(lock.packs.map((pack) => [pack.name, pack.revision, pack.inTheBuild.revision])).toEqual([
      ["corridor", "k2", "k1"],
      ["post", "r2", "r1"],
    ]);
    const output = importProject(project);
    expect(output).toContain("Corbelo Game Export: corridor: mesh library written");
    expect(output).not.toContain("Corbelo Game Export: post:");

    // The game's scene was not written again, and neither were the project's materials or import settings.
    expect(readFileSync(join(project, "assets/post/post.tscn"), "utf8")).toBe(text);
    const [after, libraryAfter] = prove(project, [
      { do: "scene", path: "res://assets/post/post.tscn" },
      { do: "library", path: "res://assets/corridor/corridor.meshlib" },
    ]) as [SeenScene, SeenLibrary];
    // The same scene shows the new revision: the mesh and the collision are the thicker post's.
    expect(rounded(after.nodes[0]!.box!.max)).toEqual([0.2, 0.4, 0.2]);
    // Every node is where it was, by the same path, and the game's node is still there.
    expect(after.nodes.map((node) => `${node.class} ${node.path}`)).toEqual(before.nodes.map((node) => `${node.class} ${node.path}`));
    expect(after.nodes.find((node) => node.name === "Marker")).toMatchObject({ class: "Node3D", path: "post/Marker", position: [1, 2, 3] });
    // The override is still on its surface, and the project's materials are still the project's, with the colour the game gave one.
    expect(after.nodes[0]!.surfaces).toEqual([
      { material: { name: "Paint", path: "res://assets/post/materials/Paint.tres", albedo: "#c0392b" }, override: { name: "GameOverride", path: expect.stringContaining("res://assets/post/post.tscn::") as string, albedo: "#00ff00" } },
      { material: { name: "Wood", path: "res://assets/post/materials/Wood.tres", albedo: "#112233" }, override: null },
    ]);
    expect(after.nodes[0]!.surfaces).toEqual(before.nodes[0]!.surfaces);
    // The detail levels of the new revision are wired again.
    expect(after.nodes.slice(0, 3).map((node) => node.range![0] > 0)).toEqual([false, true, true]);
    expect(after.root.meta).toEqual({ pack: "post", detail_levels: 3 });

    // The library was built again from the new revision, and every item kept its number, so what is painted stays.
    expect(libraryAfter.meta!.manifest_sha256).not.toBe(libraryBefore.meta!.manifest_sha256);
    expect(libraryAfter.items.map((item) => [item.id, item.name])).toEqual(libraryBefore.items.map((item) => [item.id, item.name]));
    expect(projectStatus(project).packs.map((pack) => [pack.name, pack.matches, pack.pinned])).toEqual([
      ["corridor", true, false],
      ["post", true, false],
    ]);
  }, 240_000);
});

describe.skipIf(!usable)("the add-on in a project that already imported its packs", () => {
  let project: string;
  afterAll(() => rmSync(project, { recursive: true, force: true }));

  it("wires them when it is turned on, and points a file at a material that came back under another identifier", () => {
    project = newProject(false);
    mkdirSync(join(project, "props"));
    const pack = exportGamePack({
      name: "drum",
      source: MM_Z_UP,
      bodies: [{ name: "Drum", positions: cylinder(300, 900, 32).positions, color: "#3d6fd9", materialName: "Steel", lods: [{ positions: cylinder(300, 900, 8).positions }] }],
      collision: "hull",
    });
    // Into another folder than `assets`, and from a folder instead of an archive.
    const folder = mkdtempSync(join(tmpdir(), "corbelo game export pack "));
    try {
      for (const file of pack.files) writeFileSync(join(folder, file.name), file.bytes);
      installPack(folder, project, { into: "props" });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
    // Imported with the add-on off: Godot's own import, with the lower level hidden.
    importProject(project);
    expect(existsSync(join(project, "props/drum/drum.tscn"))).toBe(false);
    const [plain] = prove(project, [{ do: "scene", path: "res://props/drum/drum.glb" }]) as [SeenScene];
    expect(plain.nodes.filter((node) => node.class === "MeshInstance3D").map((node) => [node.visible, node.range])).toEqual([[true, [0, 0]], [false, [0, 0]]]);

    cpSync(join(HERE, "../addons/corbelo_game_export"), join(project, "addons/corbelo_game_export"), { recursive: true });
    // Turned on, with the project's own distance for detail levels: half the one it starts with.
    writeFileSync(join(project, "project.godot"), `${PROJECT_FILE}${ADDON_ON}\n[corbelo_game_export]\n\ndetail_levels/distance_per_deviation=350.0\n`);
    expect(importProject(project)).toContain("Corbelo Game Export: drum: 1 material made, 1 file imported again, 1 scene made");
    const [wired] = prove(project, [{ do: "scene", path: "res://props/drum/drum.tscn" }]) as [SeenScene];
    const levels = wired.nodes.filter((node) => node.class === "MeshInstance3D");
    expect(levels.map((node) => node.visible)).toEqual([true, true]);
    expect(levels[0]!.range![1]).toBe(levels[1]!.range![0]);
    const deviation = pack.manifest.files[0]!.facts.bodies[0]!.lods![1]!.deviation.meters;
    expect(deviation * 350).toBeGreaterThan(1);
    expect(levels[1]!.range![0]).toBeCloseTo(deviation * 350, 4);
    expect(levels[0]!.surfaces![0]!.material).toEqual({ name: "Steel", path: "res://props/drum/materials/Steel.tres", albedo: "#3d6fd9" });

    // A material file that comes back under another identifier, as one replaced by a copy
    // does: the file's import setting is pointed at it again, once.
    const steel = join(project, "props/drum/materials/Steel.tres");
    writeFileSync(steel, readFileSync(steel, "utf8").replace(/uid="uid:\/\/[a-z0-9]+"/, 'uid="uid://c4r6ys8u2k1ab"'));
    expect(importProject(project)).toContain("Corbelo Game Export: drum: 1 file imported again");
    expect(readFileSync(join(project, "props/drum/drum.glb.import"), "utf8")).toContain('"use_external/path": "uid://c4r6ys8u2k1ab"');
    expect(importProject(project)).not.toContain("Corbelo Game Export:");
    const [again] = prove(project, [{ do: "scene", path: "res://props/drum/drum.tscn" }]) as [SeenScene];
    expect(again.nodes[0]!.surfaces![0]!.material!.path).toBe("res://props/drum/materials/Steel.tres");
  }, 240_000);
});
