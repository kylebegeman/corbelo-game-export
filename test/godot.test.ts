// Proof with a real engine: fixtures built by this package go through Godot 4's editor
// importer with no window, and a GDScript reports what Godot ended up with.
//
// Needs a `godot` 4 program on PATH (or its path in the GODOT environment variable). Without
// one, every test here is skipped and a line on standard error says why.
//
// Set GODOT_PROOF_LOG=1 to print a summary of what Godot reported.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeGlb } from "../src/glb-write.js";
import { checkGameAsset, exportGameAsset, exportGameGlb, readGlb, type ExportResult, type PackFacts } from "../src/index.js";
import { box, chamferedBlock, cutCylinder, cylinder, doorFrame, halfPaintedSide, MM_Z_UP, paintedPatch, paintedTop, tube } from "./fixtures.js";
import { loadKernel } from "./kernel.js";

const GODOT = process.env["GODOT"] ?? "godot";
const BEGIN = "CORBELO_GAME_EXPORT_JSON_BEGIN";
const END = "CORBELO_GAME_EXPORT_JSON_END";
const SEGMENTS = 48;
/** The post that is cut finer has few sides, so a normal along a flat side is far from one straight out. */
const CUT_SEGMENTS = 12;

interface GodotSurface {
  vertexCount: number;
  triangleCount: number;
  hasNormals: boolean;
  vertices: number[];
  normals: number[];
  indices: number[];
  /** u, v for each vertex, when the mesh has texture coordinates. */
  uvs?: number[];
  /** x, y, z, w for each vertex, when the mesh has tangents. */
  tangents?: number[];
  material?: { name: string; albedo: string; metallic: number; roughness: number };
}

interface GodotNode {
  name: string;
  class: string;
  path: string;
  /** The path of the node it is a child of, when that is not the scene's root. */
  parent?: string;
  position?: number[];
  /** The node's own +Z axis, in its parent's axes. */
  zAxis?: number[];
  visible?: boolean;
  mesh?: { name: string; aabbPosition: number[]; aabbSize: number[]; surfaces: GodotSurface[] };
  /** Only on a CollisionShape3D: the shape Godot built. `points` are x, y, z for each corner of a convex shape. */
  shape?: { class: string; points?: number[]; size?: number[]; faces?: number[] };
}

interface GodotFile {
  error?: string;
  root: { name: string; class: string };
  nodes: GodotNode[];
}

function godotVersion(): string | null {
  const result = spawnSync(GODOT, ["--version"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

const version = godotVersion();
const usable = version !== null && version.startsWith("4.");
if (!usable) {
  console.warn(
    version === null
      ? `Skipping the Godot import proof: no "${GODOT}" program was found. Install Godot 4 or set GODOT to its path.`
      : `Skipping the Godot import proof: it needs Godot 4, but "${GODOT}" is version ${version}.`,
  );
}

function near(actual: readonly number[] | undefined, expected: readonly number[], digits = 5): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, at) => expect(actual![at]).toBeCloseTo(value, digits));
}

function vectorAt(values: readonly number[], index: number): [number, number, number] {
  return [values[index * 3]!, values[index * 3 + 1]!, values[index * 3 + 2]!];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

/**
 * The direction each triangle faces in Godot. Godot's front faces are wound clockwise, the
 * opposite of glTF, so its importer reverses the index order; the facing direction is the
 * left-hand normal of the indices as Godot holds them.
 */
function facing(surface: GodotSurface, triangle: number): [number, number, number] {
  const a = vectorAt(surface.vertices, surface.indices[triangle * 3]!);
  const b = vectorAt(surface.vertices, surface.indices[triangle * 3 + 1]!);
  const c = vectorAt(surface.vertices, surface.indices[triangle * 3 + 2]!);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [v[1]! * u[2]! - v[2]! * u[1]!, v[2]! * u[0]! - v[0]! * u[2]!, v[0]! * u[1]! - v[1]! * u[0]!];
  const length = Math.hypot(n[0]!, n[1]!, n[2]!);
  return [n[0]! / length, n[1]! / length, n[2]! / length];
}

/**
 * Godot's default mesh compression stores a normal together with a tangent. For a mesh without
 * tangents it makes one up as cross((n.z, -n.x, n.y), n), which has no length when the normal
 * lies exactly along (1, 1, -1) or its opposite, and the stored normal comes out wrong. The
 * files carry a tangent for every vertex so that Godot never has to make one up.
 */
function onGodotBlindAxis(normal: readonly number[]): boolean {
  return Math.abs(dot(normal, [1, 1, -1])) / Math.sqrt(3) > 0.999999;
}

const RING_PIECES = 12;
/** The side of one whole texture on the ring, in metres. */
const RING_TILE = 0.5;

/** One of the `count` wedges a ring is made of, Z up: the eight corners of a slice of it. */
function wedge(outer: number, inner: number, height: number, piece: number, count: number): number[] {
  const points: number[] = [];
  for (const turn of [piece, piece + 1]) {
    const angle = (turn / count) * 2 * Math.PI;
    for (const radius of [inner, outer]) for (const z of [0, height]) points.push(radius * Math.cos(angle), radius * Math.sin(angle), z);
  }
  return points;
}

/** The box around points given as x, y, z after x, y, z, moved by `offset`. */
function boxAround(points: readonly number[], offset: readonly number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < points.length; at += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, points[at + axis]! + offset[axis]!);
      max[axis] = Math.max(max[axis]!, points[at + axis]! + offset[axis]!);
    }
  }
  return { min, max };
}

const PROJECT_FILE = 'config_version=5\n\n[application]\n\nconfig/name="corbelo-game-export import proof"\n';
const COMPRESSION_OFF = '\n[importer_defaults]\n\nscene={"meshes/force_disable_compression": true}\n';

/**
 * Makes a throwaway Godot project under the OS temp directory, runs the editor's import on the
 * given GLB files with no window, then loads the imported scenes and returns Godot's report.
 */
function importWithGodot(glbs: Record<string, Uint8Array>, projectSettings = ""): { project: string; godot: string; files: Record<string, GodotFile> } {
  const project = mkdtempSync(join(tmpdir(), "corbelo-game-export-godot-"));
  try {
    writeFileSync(join(project, "project.godot"), PROJECT_FILE + projectSettings);
    copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "godot/inspect.gd"), join(project, "inspect.gd"));
    for (const [name, glb] of Object.entries(glbs)) writeFileSync(join(project, name), glb);

    // Step 1: the editor's own import. This writes a .import file next to each GLB and the
    // imported scene under .godot/imported.
    const imported = spawnSync(GODOT, ["--headless", "--path", project, "--import"], { encoding: "utf8", timeout: 120_000 });
    expect(imported.status, `godot --import failed:\n${imported.stdout}\n${imported.stderr}`).toBe(0);

    // Step 2: load the imported scenes and report on them.
    const inspected = spawnSync(GODOT, ["--headless", "--path", project, "--script", "res://inspect.gd", "--", ...Object.keys(glbs)], { encoding: "utf8", timeout: 120_000 });
    const start = inspected.stdout.indexOf(BEGIN);
    const end = inspected.stdout.indexOf(END);
    expect(start >= 0 && end > start, `the Godot script printed no report:\n${inspected.stdout}\n${inspected.stderr}`).toBe(true);
    const report = JSON.parse(inspected.stdout.slice(start + BEGIN.length, end)) as { godot: string; files: Record<string, GodotFile> };
    return { project, godot: report.godot, files: report.files };
  } catch (error) {
    rmSync(project, { recursive: true, force: true });
    throw error;
  }
}

describe.skipIf(!usable)("Godot 4 editor import", () => {
  const projects: string[] = [];
  let project: string;
  let files: Record<string, GodotFile>;
  let exactFiles: Record<string, GodotFile>;
  const exports: Record<string, ExportResult> = {};

  function meshNodes(file: string): GodotNode[] {
    return files[file]!.nodes.filter((node) => node.class === "MeshInstance3D");
  }

  function onlySurface(file: string, node = 0): GodotSurface {
    const mesh = meshNodes(file)[node]!.mesh!;
    expect(mesh.surfaces).toHaveLength(1);
    return mesh.surfaces[0]!;
  }

  function facts(file: string): PackFacts {
    return exports[file]!.facts;
  }

  beforeAll(async () => {
    const block = chamferedBlock([1000, 500, 250], 20);
    const round = cylinder(150, 400, SEGMENTS);
    exports["block.glb"] = exportGameGlb({
      bodies: [{ name: "Chamfered Block", positions: block.positions, faceIds: block.faceIds, color: "#d98a3d" }],
      source: MM_Z_UP,
    });
    exports["cylinder.glb"] = exportGameGlb({ bodies: [{ name: "Cylinder", positions: round.positions, faceIds: round.faceIds }], source: MM_Z_UP });
    exports["pair.glb"] = exportGameGlb({
      bodies: [
        { name: "Base Plate", positions: box([100, 200, 0], [700, 600, 40]).positions, color: "#c0392b" },
        { name: "Top Cap", positions: box([300, 300, 40], [500, 500, 160]).positions, color: [0.16, 0.5, 0.73] },
      ],
      source: MM_Z_UP,
      placement: "designed",
    });
    // Two bodies with colours on their faces: a cylinder whose side is half red, the two colours
    // meeting along two lines down the smooth side, and a box with a red top.
    exports["painted.glb"] = exportGameGlb({
      bodies: [
        { name: "Striped Post", positions: round.positions, faceIds: round.faceIds, color: "#2980ba", faceColors: halfPaintedSide(SEGMENTS, "#c0392b") },
        { name: "Painted Box", positions: box([0, 0, 0], [200, 300, 100]).positions, color: "#2980ba", faceColors: paintedTop("#c0392b") },
      ],
      source: MM_Z_UP,
    });
    // A post painted across its flat sides, which cuts them finer: once saying what it was cut
    // from, with a name for the paint, and once as the cut mesh alone with its own exact faces.
    const uncut = cylinder(150, 400, CUT_SEGMENTS);
    const pieces = cutCylinder(150, 400, CUT_SEGMENTS);
    const paintedPost = { name: "Cut Post", positions: pieces.positions, color: "#2980ba", faceColors: paintedPatch(CUT_SEGMENTS, "#c0392b") };
    exports["cut.glb"] = exportGameGlb({
      bodies: [{ ...paintedPost, faceMaterialNames: { "#c0392b": "Signal Red" }, refines: { surfaces: [{ positions: uncut.positions, faceIds: uncut.faceIds }], triangleOf: pieces.triangleOf } }],
      source: MM_Z_UP,
    });
    exports["cut-alone.glb"] = exportGameGlb({ bodies: [{ ...paintedPost, faceIds: pieces.faceIds }], source: MM_Z_UP });
    const small = box([0, 0, 0], [100, 100, 100]).positions;
    exports["names.glb"] = exportGameGlb({
      bodies: ["wall-col", "UCX_Crate", "part_LOD0", "Left Wall (v2)", "Left Wall (v2)"].map((name) => ({ name, positions: small })),
      source: MM_Z_UP,
    });
    // A game asset with a hole through it: a ring 1.2 m across and 0.4 m tall, with the twelve
    // wedges it could be built from as its collision, two lower detail levels, texture
    // coordinates and two attach points.
    exports["ring.glb"] = exportGameAsset({
      bodies: [
        {
          name: "Ring",
          positions: tube(600, 400, 400, SEGMENTS).positions,
          color: "#8a5a2b",
          lods: [{ positions: tube(600, 400, 400, 24).positions }, { positions: tube(600, 400, 400, 12).positions }],
          collisionPieces: Array.from({ length: RING_PIECES }, (_, piece) => ({ positions: wedge(600, 400, 400, piece, RING_PIECES) })),
          attachPoints: [{ name: "Top", position: [0, 0, 400], direction: [0, 0, 1] }, { name: "Hook", position: [600, 0, 200], direction: [1, 0, 0] }],
        },
      ],
      source: MM_Z_UP,
      texcoords: { tileMeters: RING_TILE },
    });
    // A wall with a doorway, with no pieces given: the kernel cuts it into convex pieces.
    exports["frame.glb"] = exportGameAsset({ bodies: [{ name: "Door Frame", positions: doorFrame(3000, 300, 2800, 1200, 2200).positions }], source: MM_Z_UP, kernel: await loadKernel() });
    // A control this package would never write: the same kind of file with a node named the
    // way Godot reads as "make a collision shape". If the editor importer really ran, Godot
    // adds a physics body here, which shows its import-time name handling is in play.
    const control = readGlb(exportGameGlb({ bodies: [{ name: "crate", positions: small }], source: MM_Z_UP }).glb);
    control.json.nodes![0]!.name = "crate-col";

    const glbs: Record<string, Uint8Array> = Object.fromEntries(Object.entries(exports).map(([name, result]) => [name, result.glb]));
    glbs["control.glb"] = encodeGlb(control.json, control.bin);

    // Godot's default import settings, untouched.
    const defaults = importWithGodot(glbs);
    projects.push(defaults.project);
    ({ project, files } = defaults);
    const report = defaults;

    // The same block again with Godot's mesh compression switched off.
    const exact = importWithGodot({ "block.glb": glbs["block.glb"]! }, COMPRESSION_OFF);
    projects.push(exact.project);
    exactFiles = exact.files;

    if (process.env["GODOT_PROOF_LOG"]) {
      const round = (values: readonly number[]) => `[${values.map((value) => Number(value.toFixed(4))).join(", ")}]`;
      const lines = [`Godot ${report.godot} reports, after its editor import with default settings:`];
      for (const [name, file] of Object.entries(files)) {
        lines.push(`${name}: root "${file.root.name}" (${file.root.class})`);
        for (const node of file.nodes) {
          let line = `  "${node.name}" ${node.class}${node.position ? ` at ${round(node.position)}` : ""}`;
          for (const surface of node.mesh?.surfaces ?? []) {
            const material = surface.material;
            line += ` | mesh "${node.mesh!.name}" size ${round(node.mesh!.aabbSize)} from ${round(node.mesh!.aabbPosition)}`;
            line += ` | ${surface.vertexCount} vertices, ${surface.triangleCount} triangles, normals ${surface.hasNormals ? "yes" : "no"}`;
            line += material ? ` | material "${material.name}" ${material.albedo} metallic ${Number(material.metallic.toFixed(4))} roughness ${Number(material.roughness.toFixed(4))}` : " | no material";
          }
          lines.push(line);
        }
      }
      console.log(lines.join("\n"));
    }
  }, 300_000);

  afterAll(() => {
    for (const directory of projects) rmSync(directory, { recursive: true, force: true });
  });

  it("goes through the editor's scene importer, not a runtime loader", () => {
    for (const name of [...Object.keys(exports), "control.glb"]) {
      const settings = readFileSync(join(project, `${name}.import`), "utf8");
      expect(settings).toContain('importer="scene"');
      expect(settings).toContain('type="PackedScene"');
      expect(settings).toMatch(/path="res:\/\/\.godot\/imported\/.+\.scn"/);
      expect(files[name]!.error).toBeUndefined();
    }
  });

  it("acts on node names at import time, as the control file shows", () => {
    const classes = files["control.glb"]!.nodes.map((node) => node.class);
    expect(classes).toContain("StaticBody3D");
    expect(classes).toContain("CollisionShape3D");
    expect(meshNodes("control.glb").map((node) => node.name)).toEqual(["crate"]);
  });

  describe("chamfered block, 1000 x 500 x 250 mm, modelled Z-up", () => {
    it("is one mesh node with the body's name", () => {
      expect(files["block.glb"]!.root.class).toBe("Node3D");
      expect(files["block.glb"]!.nodes.map((node) => [node.name, node.class])).toEqual([[facts("block.glb").bodies[0]!.name, "MeshInstance3D"]]);
      expect(facts("block.glb").bodies[0]!.name).toBe("Chamfered_Block");
    });

    it("measures 1.0 x 0.25 x 0.5 m with Y up", () => {
      const mesh = meshNodes("block.glb")[0]!.mesh!;
      near(mesh.aabbSize, [1, 0.25, 0.5]);
      near(mesh.aabbSize, facts("block.glb").bodies[0]!.bounds.meters.size);
    });

    it("has its pivot at the centre of its base, at the scene origin", () => {
      const node = meshNodes("block.glb")[0]!;
      near(node.position, [0, 0, 0]);
      near(node.mesh!.aabbPosition, [-0.5, 0, -0.25]);
      near(node.mesh!.aabbPosition, facts("block.glb").bodies[0]!.bounds.meters.min);
    });

    it("has the vertex and triangle counts the facts state", () => {
      const surface = onlySurface("block.glb");
      expect(surface.vertexCount).toBe(facts("block.glb").bodies[0]!.vertices);
      expect(surface.triangleCount).toBe(facts("block.glb").bodies[0]!.triangles);
      expect([surface.vertexCount, surface.triangleCount]).toEqual([96, 44]);
    });

    it("has normals, and every flat face's normals point the same way: outwards", () => {
      const surface = onlySurface("block.glb");
      expect(surface.hasNormals).toBe(true);
      let checked = 0;
      let onBlindAxis = 0;
      for (let triangle = 0; triangle < surface.triangleCount; triangle += 1) {
        const outward = facing(surface, triangle);
        if (onGodotBlindAxis(outward)) onBlindAxis += 1;
        checked += 1;
        for (let k = 0; k < 3; k += 1) near(vectorAt(surface.normals, surface.indices[triangle * 3 + k]!), outward, 3);
      }
      // All 44 triangles, the two corner chamfers facing (1, 1, -1) and (-1, -1, 1) included.
      // Those are the ones Godot's default compression gets wrong for a file without tangents.
      expect([checked, onBlindAxis]).toEqual([44, 2]);
      // The top face in particular: four vertices at full height whose normals are all straight up.
      const top: number[][] = [];
      for (let vertex = 0; vertex < surface.vertexCount; vertex += 1) {
        const normal = vectorAt(surface.normals, vertex);
        if (Math.abs(surface.vertices[vertex * 3 + 1]! - 0.25) < 1e-5 && normal[1] > 0.9) top.push(normal);
      }
      expect(top).toHaveLength(4);
      for (const normal of top) near(normal, [0, 1, 0], 3);
    });

    it("has exact normals on every face, all 44 triangles, with mesh compression off", () => {
      const mesh = exactFiles["block.glb"]!.nodes[0]!.mesh!;
      const surface = mesh.surfaces[0]!;
      expect([surface.vertexCount, surface.triangleCount]).toEqual([96, 44]);
      for (let triangle = 0; triangle < surface.triangleCount; triangle += 1) {
        const outward = facing(surface, triangle);
        for (let k = 0; k < 3; k += 1) near(vectorAt(surface.normals, surface.indices[triangle * 3 + k]!), outward, 3);
      }
      // Without compression Godot also keeps the positions exactly as written.
      expect(mesh.aabbSize).toEqual([1, 0.25, 0.5]);
      expect(mesh.aabbPosition).toEqual([-0.5, 0, -0.25]);
    });

    it("has one material in the body's colour", () => {
      const { material } = onlySurface("block.glb");
      expect(material).toMatchObject({ name: "color_d98a3d", albedo: "#d98a3d", metallic: 0 });
      expect(material!.roughness).toBeCloseTo(0.8, 6);
      expect(facts("block.glb").total.materialSlots).toBe(1);
    });
  });

  describe("cylinder, 300 mm across and 400 mm tall", () => {
    it("measures 0.3 x 0.4 x 0.3 m and stands on the origin", () => {
      const node = meshNodes("cylinder.glb")[0]!;
      expect(node.name).toBe("Cylinder");
      near(node.mesh!.aabbSize, [0.3, 0.4, 0.3]);
      near(node.mesh!.aabbPosition, [-0.15, 0, -0.15]);
      near(node.position, [0, 0, 0]);
    });

    it("has the vertex and triangle counts the facts state", () => {
      const surface = onlySurface("cylinder.glb");
      expect(surface.vertexCount).toBe(facts("cylinder.glb").bodies[0]!.vertices);
      expect(surface.triangleCount).toBe(facts("cylinder.glb").bodies[0]!.triangles);
      expect([surface.vertexCount, surface.triangleCount]).toEqual([4 * SEGMENTS + 2, 4 * SEGMENTS]);
    });

    it("has side normals that turn smoothly around the axis", () => {
      const surface = onlySurface("cylinder.glb");
      const directions = new Set<string>();
      let sideVertices = 0;
      for (let vertex = 0; vertex < surface.vertexCount; vertex += 1) {
        const [x, , z] = vectorAt(surface.vertices, vertex);
        const normal = vectorAt(surface.normals, vertex);
        if (Math.abs(normal[1]) > 0.5) continue;
        sideVertices += 1;
        // Straight out from the axis at this vertex.
        near(normal, [x / Math.hypot(x, z), 0, z / Math.hypot(x, z)], 3);
        directions.add(`${Math.round((Math.atan2(normal[2], normal[0]) * 180) / Math.PI / (360 / SEGMENTS))}`);
      }
      expect(sideVertices).toBe(2 * SEGMENTS);
      expect(directions.size).toBe(SEGMENTS);
      // Within each side triangle the normals differ by one step of the circle: shaded round, not in facets.
      let sideTriangles = 0;
      for (let triangle = 0; triangle < surface.triangleCount; triangle += 1) {
        const normals = [0, 1, 2].map((k) => vectorAt(surface.normals, surface.indices[triangle * 3 + k]!));
        if (normals.some((normal) => Math.abs(normal[1]) > 0.5)) continue;
        sideTriangles += 1;
        const spread = Math.min(dot(normals[0]!, normals[1]!), dot(normals[1]!, normals[2]!), dot(normals[0]!, normals[2]!));
        expect((Math.acos(spread) * 180) / Math.PI).toBeCloseTo(360 / SEGMENTS, 1);
        expect(dot(facing(surface, triangle), normals[0]!)).toBeGreaterThan(0.99);
      }
      expect(sideTriangles).toBe(2 * SEGMENTS);
    });

    it("has flat caps", () => {
      const surface = onlySurface("cylinder.glb");
      let capVertices = 0;
      for (let vertex = 0; vertex < surface.vertexCount; vertex += 1) {
        const normal = vectorAt(surface.normals, vertex);
        if (Math.abs(normal[1]) <= 0.5) continue;
        capVertices += 1;
        near(normal, [0, surface.vertices[vertex * 3 + 1]! > 0.2 ? 1 : -1, 0], 3);
      }
      expect(capVertices).toBe(2 * (SEGMENTS + 1));
    });
  });

  describe("two coloured bodies in one file, kept where they were designed", () => {
    it("has one named mesh node per body", () => {
      expect(files["pair.glb"]!.nodes.map((node) => [node.name, node.class])).toEqual([
        ["Base_Plate", "MeshInstance3D"],
        ["Top_Cap", "MeshInstance3D"],
      ]);
      expect(facts("pair.glb").bodies.map((body) => body.name)).toEqual(["Base_Plate", "Top_Cap"]);
    });

    it("puts each node at its pivot and each body where the facts say", () => {
      meshNodes("pair.glb").forEach((node, index) => {
        const body = facts("pair.glb").bodies[index]!;
        near(node.position, body.pivot.meters);
        near(node.position, body.translation);
        near(node.mesh!.aabbSize, body.bounds.meters.size);
        near(node.mesh!.aabbPosition.map((value, axis) => value + node.position![axis]!), body.bounds.meters.min);
      });
      // Base plate: source x 100..700, y 200..600, z 0..40 mm. Its base centre is (400, 400, 0).
      near(meshNodes("pair.glb")[0]!.position, [0.4, 0, -0.4]);
      near(meshNodes("pair.glb")[1]!.position, [0.4, 0.04, -0.4]);
    });

    it("has the counts the facts state", () => {
      meshNodes("pair.glb").forEach((_, index) => {
        const surface = onlySurface("pair.glb", index);
        expect(surface.vertexCount).toBe(facts("pair.glb").bodies[index]!.vertices);
        expect(surface.triangleCount).toBe(facts("pair.glb").bodies[index]!.triangles);
      });
      expect(facts("pair.glb").total).toMatchObject({ triangles: 24, vertices: 48 });
    });

    it("has two materials in the bodies' colours", () => {
      const materials = meshNodes("pair.glb").map((_, index) => onlySurface("pair.glb", index).material!);
      expect(materials.map((material) => [material.name, material.albedo])).toEqual([
        ["color_c0392b", "#c0392b"],
        ["color_2980ba", "#2980ba"],
      ]);
      expect(facts("pair.glb").materials.map((material) => material.color)).toEqual(["#c0392b", "#2980ba"]);
      expect(facts("pair.glb").total.materialSlots).toBe(2);
    });
  });

  describe("two bodies with colours on their faces", () => {
    const body = (index: number) => facts("painted.glb").bodies[index]!;
    const surfaces = (index: number) => meshNodes("painted.glb")[index]!.mesh!.surfaces;

    it("has one mesh node per body, each mesh with a surface for each colour", () => {
      expect(files["painted.glb"]!.nodes.map((node) => [node.name, node.class])).toEqual([
        ["Striped_Post", "MeshInstance3D"],
        ["Painted_Box", "MeshInstance3D"],
      ]);
      expect(surfaces(0)).toHaveLength(2);
      expect(surfaces(1)).toHaveLength(2);
      expect([body(0).materialSlots, body(1).materialSlots]).toEqual([2, 2]);
    });

    it("has each surface in its colour, in the order the facts list the slots", () => {
      for (const index of [0, 1]) {
        expect(surfaces(index).map((surface) => surface.material!.name)).toEqual(body(index).materials);
        for (const surface of surfaces(index)) {
          expect(surface.material!.albedo).toBe(facts("painted.glb").materials.find((material) => material.name === surface.material!.name)!.color);
          expect(surface.material!.metallic).toBe(0);
          expect(surface.material!.roughness).toBeCloseTo(0.8, 6);
        }
      }
      expect(surfaces(0).map((surface) => [surface.material!.name, surface.material!.albedo])).toEqual([
        ["color_c0392b", "#c0392b"],
        ["color_2980ba", "#2980ba"],
      ]);
      expect(surfaces(1).map((surface) => [surface.material!.name, surface.material!.albedo])).toEqual([
        ["color_2980ba", "#2980ba"],
        ["color_c0392b", "#c0392b"],
      ]);
      expect(facts("painted.glb").total.materialSlots).toBe(2);
    });

    it("has the triangle and vertex counts the facts state for each surface", () => {
      for (const index of [0, 1]) {
        expect(surfaces(index).map((surface) => ({ material: surface.material!.name, triangles: surface.triangleCount, vertices: surface.vertexCount }))).toEqual(body(index).slots);
        expect(surfaces(index).reduce((total, surface) => total + surface.triangleCount, 0)).toBe(body(index).triangles);
        expect(surfaces(index).reduce((total, surface) => total + surface.vertexCount, 0)).toBe(body(index).vertices);
      }
      // Half of the cylinder's side is red: one triangle pair per segment for half the segments.
      expect(surfaces(0).map((surface) => surface.triangleCount)).toEqual([SEGMENTS, 3 * SEGMENTS]);
      // The box's top is red: two triangles on four corners.
      expect(surfaces(1).map((surface) => [surface.triangleCount, surface.vertexCount])).toEqual([[10, 20], [2, 4]]);
    });

    it("keeps the mesh the size of the whole body", () => {
      for (const index of [0, 1]) {
        const node = meshNodes("painted.glb")[index]!;
        // To four digits: Godot gives a surface that is perfectly flat, as the box's red top is,
        // a box 0.01 mm thick, and the mesh's box is the box round its surfaces.
        near(node.mesh!.aabbSize, body(index).bounds.meters.size, 4);
        near(node.mesh!.aabbPosition, body(index).bounds.meters.min, 4);
        near(node.position, [0, 0, 0]);
      }
    });

    it("has the red on the right triangles: half the post's side and the box's top", () => {
      const [red] = surfaces(0);
      // The painted half is the one towards source +Y, which is glTF -Z.
      for (let vertex = 0; vertex < red!.vertexCount; vertex += 1) {
        expect(red!.vertices[vertex * 3 + 2]).toBeLessThan(1e-5);
        expect(Math.abs(red!.normals[vertex * 3 + 1]!)).toBeLessThan(1e-3);
      }
      const top = surfaces(1)[1]!;
      for (let vertex = 0; vertex < top.vertexCount; vertex += 1) {
        expect(top.vertices[vertex * 3 + 1]).toBeCloseTo(0.1, 5);
        near(vectorAt(top.normals, vertex), [0, 1, 0], 3);
      }
    });

    it("shades the post's side smoothly across the two lines where the colours meet", () => {
      let sideVertices = 0;
      const seam = new Map<string, number[][]>();
      surfaces(0).forEach((surface, part) => {
        for (let vertex = 0; vertex < surface.vertexCount; vertex += 1) {
          const [x, y, z] = vectorAt(surface.vertices, vertex);
          const normal = vectorAt(surface.normals, vertex);
          if (Math.abs(normal[1]) > 0.5) continue;
          sideVertices += 1;
          // Straight out from the axis, in the red part and in the blue part alike.
          near(normal, [x / Math.hypot(x, z), 0, z / Math.hypot(x, z)], 3);
          // Godot's default compression rounds positions within each surface's own box, so the
          // same point is a few thousandths of a millimetre apart in the two surfaces.
          if (Math.abs(z) < 1e-4) {
            const key = `${Math.sign(x)},${y > 0.2 ? "top" : "bottom"}`;
            seam.set(key, [...(seam.get(key) ?? []), [part, ...normal]]);
          }
        }
        for (let triangle = 0; triangle < surface.triangleCount; triangle += 1) {
          const outward = facing(surface, triangle);
          for (let k = 0; k < 3; k += 1) expect(dot(vectorAt(surface.normals, surface.indices[triangle * 3 + k]!), outward)).toBeGreaterThan(0.99);
        }
      });
      // One vertex per ring point, and the four on the two lines once more for the second colour.
      expect(sideVertices).toBe(2 * SEGMENTS + 4);
      // Each of those four is in both surfaces, with the same normal in each.
      expect([...seam.keys()].sort()).toEqual(["-1,bottom", "-1,top", "1,bottom", "1,top"]);
      for (const copies of seam.values()) {
        expect(copies.map((copy) => copy[0]).sort()).toEqual([0, 1]);
        near(copies[0]!.slice(1), copies[1]!.slice(1), 3);
      }
    });
  });

  describe("a post painted across its flat sides", () => {
    /** How far each normal of the round side is from straight out from the axis, in degrees, over every surface. */
    function offRound(file: string): number[] {
      const off: number[] = [];
      for (const surface of meshNodes(file)[0]!.mesh!.surfaces) {
        for (let vertex = 0; vertex < surface.vertexCount; vertex += 1) {
          const [x, , z] = vectorAt(surface.vertices, vertex);
          const normal = vectorAt(surface.normals, vertex);
          if (Math.abs(normal[1]) > 0.5) continue;
          off.push((Math.acos(Math.min(1, (normal[0] * x + normal[2] * z) / Math.hypot(x, z))) * 180) / Math.PI);
        }
      }
      return off;
    }

    it("is shaded along its flat sides where the paint cut it, when the file was written from the cut mesh alone", () => {
      // A quarter of the way along a side that turns 30 degrees, the side's own direction is over 7 degrees off.
      expect(Math.max(...offRound("cut-alone.glb"))).toBeGreaterThan(7);
    });

    it("is shaded round, as before the paint, when the body said what it was cut from", () => {
      const off = offRound("cut.glb");
      expect(off.length).toBeGreaterThanOrEqual(8 * CUT_SEGMENTS);
      // Godot's default compression keeps a normal to within a few hundredths of a degree.
      expect(Math.max(...off)).toBeLessThan(0.1);
      for (const surface of meshNodes("cut.glb")[0]!.mesh!.surfaces) {
        for (let triangle = 0; triangle < surface.triangleCount; triangle += 1) {
          const outward = facing(surface, triangle);
          for (let k = 0; k < 3; k += 1) expect(dot(vectorAt(surface.normals, surface.indices[triangle * 3 + k]!), outward)).toBeGreaterThan(0.96);
        }
      }
    });

    it("has the counts the facts state, and the paint under the name it was given", () => {
      const body = facts("cut.glb").bodies[0]!;
      const surfaces = meshNodes("cut.glb")[0]!.mesh!.surfaces;
      expect(body.shadedFrom).toEqual({ surfaces: 1, triangles: 4 * CUT_SEGMENTS });
      expect(surfaces.map((surface) => ({ material: surface.material!.name, triangles: surface.triangleCount, vertices: surface.vertexCount }))).toEqual(body.slots);
      expect(surfaces.map((surface) => [surface.material!.name, surface.material!.albedo])).toEqual([
        ["Signal_Red", "#c0392b"],
        ["color_2980ba", "#2980ba"],
      ]);
      expect(surfaces.reduce((total, surface) => total + surface.triangleCount, 0)).toBe(16 * CUT_SEGMENTS);
    });
  });

  /** Where a node is in the scene: its own position added to those of the nodes it is in. None of them is turned. */
  function placeOf(file: string, node: GodotNode): number[] {
    const place = [...(node.position ?? [0, 0, 0])];
    let parent = node.parent;
    while (parent !== undefined) {
      const above = files[file]!.nodes.find((candidate) => candidate.path === parent)!;
      (above.position ?? [0, 0, 0]).forEach((value, axis) => (place[axis]! += value));
      parent = above.parent;
    }
    return place;
  }

  /** The collision Godot built for a body: each physics body with the one shape in it, in the order of the file. */
  function builtCollision(file: string, bodyName: string): { body: GodotNode; shape: GodotNode; box: { min: number[]; max: number[] } }[] {
    return files[file]!.nodes
      .filter((node) => node.class === "StaticBody3D" && node.parent === bodyName)
      .map((body) => {
        const shapes = files[file]!.nodes.filter((node) => node.parent === body.path);
        expect(shapes.map((node) => node.class)).toEqual(["CollisionShape3D"]);
        const [shape] = shapes;
        expect(shape!.shape!.class).toBe("ConvexPolygonShape3D");
        return { body, shape: shape!, box: boxAround(shape!.shape!.points!, placeOf(file, shape!)) };
      });
  }

  describe("a game asset: a ring with a hole through it", () => {
    const body = () => facts("ring.glb").bodies[0]!;
    const ring = () => files["ring.glb"]!.nodes.find((node) => node.name === "Ring")!;

    it("is the right size: 1.2 m across and 0.4 m tall, standing on the origin", () => {
      expect(files["ring.glb"]!.error).toBeUndefined();
      expect(ring().class).toBe("MeshInstance3D");
      expect(ring().visible).toBe(true);
      near(ring().position, [0, 0, 0]);
      near(ring().mesh!.aabbSize, [1.2, 0.4, 1.2], 4);
      near(ring().mesh!.aabbPosition, [-0.6, 0, -0.6], 4);
      near(ring().mesh!.aabbSize, body().bounds.meters.size, 4);
      expect(ring().mesh!.surfaces.map((surface) => [surface.triangleCount, surface.vertexCount])).toEqual([[body().triangles, body().vertices]]);
      expect(body().triangles).toBe(8 * SEGMENTS);
    });

    it("gets the collision the file asks for: one convex shape for each wedge, built by Godot on import", () => {
      const collision = body().collision!;
      expect(collision).toMatchObject({ requested: "auto", shape: "pieces", pieces: RING_PIECES, withinTolerance: true });
      // The twelve wedges hold a little less than the ring of 48 sides they stand in for.
      expect(collision.volume.error).toBeGreaterThan(-0.05);
      expect(collision.volume.error).toBeLessThan(0);
      const built = builtCollision("ring.glb", "Ring");
      expect(built).toHaveLength(RING_PIECES);
      // Godot takes the ending off the name it built a shape from.
      expect(collision.nodes.map((node) => node.name)).toEqual(Array.from({ length: RING_PIECES }, (_, piece) => `Ring_${String(piece).padStart(2, "0")}-convcolonly`));
      expect(built.map((piece) => piece.body.name)).toEqual(collision.nodes.map((node) => node.name.replace("-convcolonly", "")));
      built.forEach((piece, at) => {
        const written = collision.nodes[at]!;
        // Every corner of the wedge, where the facts say the piece is. Godot tidies the points
        // it keeps, which moves them by a fraction of a millimetre.
        expect(piece.shape.shape!.points!.length / 3).toBe(written.vertices);
        expect(written.vertices).toBe(8);
        near(piece.box.min, written.bounds.meters.min, 3);
        near(piece.box.max, written.bounds.meters.max, 3);
      });
      // No collision piece is left behind as something to draw.
      expect(files["ring.glb"]!.nodes.filter((node) => node.class === "MeshInstance3D").map((node) => node.name)).toEqual(["Ring", ...body().lods!.slice(1).map((level) => level.name)]);
      expect(files["ring.glb"]!.nodes.some((node) => node.name.includes("convcolonly"))).toBe(false);
    });

    it("keeps the hole open: no collision shape reaches the middle of the ring", () => {
      for (const piece of builtCollision("ring.glb", "Ring")) {
        // The hole is 0.8 m across. Every corner of every shape is at least the hole's radius from the axis.
        const points = piece.shape.shape!.points!;
        const place = placeOf("ring.glb", piece.shape);
        for (let at = 0; at < points.length; at += 3) expect(Math.hypot(points[at]! + place[0]!, points[at + 2]! + place[2]!)).toBeGreaterThan(0.4 - 1e-3);
        // And each shape stays on its own side of the axis: its box does not hold the axis.
        const holdsAxis = piece.box.min[0]! < -1e-3 && piece.box.max[0]! > 1e-3 && piece.box.min[2]! < -1e-3 && piece.box.max[2]! > 1e-3;
        expect(holdsAxis).toBe(false);
      }
    });

    it("has two lower detail levels, each a mesh of its own, hidden until the game shows it", () => {
      const levels = body().lods!;
      expect(facts("ring.glb").settings.lodLayout).toBe("children");
      expect(levels.map((level) => [level.level, level.triangles, level.visible])).toEqual([[0, 8 * SEGMENTS, true], [1, 8 * 24, false], [2, 8 * 12, false]]);
      for (const level of levels.slice(1)) {
        const node = files["ring.glb"]!.nodes.find((candidate) => candidate.name === level.name)!;
        expect(node, level.name).toBeDefined();
        expect(node.class).toBe("MeshInstance3D");
        expect(node.parent).toBe("Ring");
        expect(node.visible).toBe(false);
        near(node.position, [0, 0, 0]);
        expect(node.mesh!.surfaces.map((surface) => [surface.triangleCount, surface.vertexCount])).toEqual([[level.triangles, level.vertices]]);
        // The same ring, at the same size. A ring of 12 sides is a little narrower across its flats.
        near([node.mesh!.aabbSize[0]!, node.mesh!.aabbSize[1]!], [1.2, 0.4], 4);
        expect(node.mesh!.surfaces[0]!.material!.name).toBe(ring().mesh!.surfaces[0]!.material!.name);
      }
      // The outline moves by what a coarser circle moves it: the sagitta of one side.
      expect(levels[1]!.deviation.meters).toBeCloseTo(0.6 * (1 - Math.cos(Math.PI / 24)), 3);
      expect(levels[2]!.deviation.meters).toBeCloseTo(0.6 * (1 - Math.cos(Math.PI / 12)), 3);
    });

    it("has texture coordinates at the scale of the world, on every level", () => {
      const meshes = [ring(), ...body().lods!.slice(1).map((level) => files["ring.glb"]!.nodes.find((node) => node.name === level.name)!)];
      for (const node of meshes) {
        const [surface] = node.mesh!.surfaces;
        expect(surface!.uvs, node.name).toHaveLength(surface!.vertexCount * 2);
        let flat = 0;
        for (let triangle = 0; triangle < surface!.triangleCount; triangle += 1) {
          const corner = [0, 1, 2].map((k) => surface!.indices[triangle * 3 + k]!);
          const up = Math.abs(facing(surface!, triangle)[1]);
          for (let k = 0; k < 3; k += 1) {
            const [a, b] = [corner[k]!, corner[(k + 1) % 3]!];
            const p = vectorAt(surface!.vertices, a);
            const q = vectorAt(surface!.vertices, b);
            const along = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
            const inTexture = Math.hypot(surface!.uvs![b * 2]! - surface!.uvs![a * 2]!, surface!.uvs![b * 2 + 1]! - surface!.uvs![a * 2 + 1]!) * RING_TILE;
            // A projection never stretches: an edge is no longer in the texture than in the world.
            expect(inTexture).toBeLessThan(along + 1e-3);
            // The flat ends face straight up or down, so there an edge is exactly as long.
            if (up > 0.999) {
              expect(inTexture).toBeCloseTo(along, 3);
              flat += 1;
            }
          }
        }
        expect(flat).toBeGreaterThan(0);
        // One whole texture is half a metre, so the ring of 1.2 m spans more than two of them.
        const us = surface!.uvs!.filter((_, at) => at % 2 === 0);
        expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(1.2 / RING_TILE, 2);
      }
    });

    it("has tangents that follow the texture coordinates", () => {
      const [surface] = ring().mesh!.surfaces;
      expect(surface!.tangents).toHaveLength(surface!.vertexCount * 4);
      for (let vertex = 0; vertex < surface!.vertexCount; vertex += 1) {
        const tangent = [0, 1, 2].map((axis) => surface!.tangents![vertex * 4 + axis]!);
        expect(Math.hypot(tangent[0]!, tangent[1]!, tangent[2]!)).toBeCloseTo(1, 2);
        expect(Math.abs(dot(tangent, vectorAt(surface!.normals, vertex)))).toBeLessThan(0.02);
        expect(Math.abs(surface!.tangents![vertex * 4 + 3]!)).toBe(1);
      }
      // On every triangle the tangent points the way u grows across it.
      let checked = 0;
      for (let triangle = 0; triangle < surface!.triangleCount; triangle += 1) {
        const [a, b, c] = [0, 1, 2].map((k) => surface!.indices[triangle * 3 + k]!) as [number, number, number];
        const pa = vectorAt(surface!.vertices, a);
        const pb = vectorAt(surface!.vertices, b);
        const pc = vectorAt(surface!.vertices, c);
        const uv = (vertex: number) => [surface!.uvs![vertex * 2]!, surface!.uvs![vertex * 2 + 1]!];
        const [du1, dv1] = [uv(b)[0]! - uv(a)[0]!, uv(b)[1]! - uv(a)[1]!];
        const [du2, dv2] = [uv(c)[0]! - uv(a)[0]!, uv(c)[1]! - uv(a)[1]!];
        const det = du1 * dv2 - du2 * dv1;
        if (Math.abs(det) < 1e-6) continue;
        // How the surface moves in space for a step along u.
        const alongU = [0, 1, 2].map((axis) => ((pb[axis]! - pa[axis]!) * dv2 - (pc[axis]! - pa[axis]!) * dv1) / det);
        const length = Math.hypot(alongU[0]!, alongU[1]!, alongU[2]!);
        for (const vertex of [a, b, c]) {
          const tangent = [0, 1, 2].map((axis) => surface!.tangents![vertex * 4 + axis]!);
          expect(dot(tangent, alongU) / length).toBeGreaterThan(0.9);
        }
        checked += 1;
      }
      expect(checked).toBeGreaterThan(7 * SEGMENTS);
    });

    it("has its attach points as empty nodes, where the facts say and facing the way given", () => {
      const points = body().attachPoints!;
      expect(points.map((point) => [point.name, point.sourceName])).toEqual([["Top", "Top"], ["Hook", "Hook"]]);
      for (const point of points) {
        const node = files["ring.glb"]!.nodes.find((candidate) => candidate.name === point.name)!;
        expect(node.class).toBe("Node3D");
        expect(node.parent).toBe("Ring");
        near(placeOf("ring.glb", node), point.meters);
        near(node.zAxis, point.direction!, 4);
      }
      // On top of the ring, facing up, and on its side at +X, facing out.
      near(points[0]!.meters, [0, 0.4, 0]);
      near(points[0]!.direction!, [0, 1, 0]);
      near(points[1]!.meters, [0.6, 0.2, 0]);
      near(points[1]!.direction!, [1, 0, 0]);
    });

    it("passes the game checks it should, with the numbers Godot agrees with", () => {
      const report = checkGameAsset(exports["ring.glb"]!.glb);
      const status = Object.fromEntries(report.results.map((result) => [result.id, result.status]));
      expect(status).toMatchObject({ size: "pass", pivot: "pass", triangles: "pass", vertices: "pass", shading: "pass", "clean-mesh": "pass", "material-slots": "pass", collision: "pass", "detail-levels": "pass" });
      expect(report.status).toBe("pass");
    });
  });

  describe("a game asset: a wall with a doorway, cut into convex pieces by the kernel", () => {
    it("gets three convex shapes from Godot, and the doorway stays open", () => {
      const body = facts("frame.glb").bodies[0]!;
      expect(body.name).toBe("Door_Frame");
      expect(body.collision).toMatchObject({ requested: "auto", shape: "decomposition", pieces: 3, withinTolerance: true });
      expect(Math.abs(body.collision!.volume.error!)).toBeLessThan(1e-6);
      const built = builtCollision("frame.glb", "Door_Frame");
      expect(built.map((piece) => piece.body.name)).toEqual(["Door_Frame_00", "Door_Frame_01", "Door_Frame_02"]);
      built.forEach((piece, at) => {
        near(piece.box.min, body.collision!.nodes[at]!.bounds.meters.min, 3);
        near(piece.box.max, body.collision!.nodes[at]!.bounds.meters.max, 3);
      });
      // The doorway is 1.2 m wide and 2.2 m tall in the middle of the wall. Each piece is a box,
      // so it blocks the doorway only if its own box reaches into it.
      for (const piece of built) {
        const inDoorway = piece.box.min[0]! < 0.6 - 1e-3 && piece.box.max[0]! > -0.6 + 1e-3 && piece.box.min[1]! < 2.2 - 1e-3;
        expect(inDoorway).toBe(false);
      }
      // Together the pieces are the whole wall around it.
      const volume = built.reduce((total, piece) => total + (piece.box.max[0]! - piece.box.min[0]!) * (piece.box.max[1]! - piece.box.min[1]!) * (piece.box.max[2]! - piece.box.min[2]!), 0);
      expect(volume).toBeCloseTo(3 * 0.3 * 2.8 - 1.2 * 0.3 * 2.2, 2);
      const mesh = meshNodes("frame.glb");
      expect(mesh.map((node) => node.name)).toEqual(["Door_Frame"]);
      near(mesh[0]!.mesh!.aabbSize, [3, 2.8, 0.3], 4);
    });

    it("lets Godot's own character through the doorway, by the game checks", () => {
      const report = checkGameAsset(exports["frame.glb"]!.glb, { assetClass: "kit-piece", expect: { opening: true } });
      const opening = report.results.find((result) => result.id === "player-openings")!;
      expect(opening.status).toBe("pass");
      expect(report.results.find((result) => result.id === "collision")!.status).toBe("pass");
    });
  });

  it("keeps body names that look like engine conventions as plain meshes", () => {
    expect(facts("names.glb").bodies.map((body) => body.name)).toEqual(["wall-col_body", "body_UCX_Crate", "part_LOD0_body", "Left_Wall_v2", "Left_Wall_v2_2"]);
    expect(files["names.glb"]!.nodes.map((node) => [node.name, node.class])).toEqual(facts("names.glb").bodies.map((body) => [body.name, "MeshInstance3D"]));
  });
});
