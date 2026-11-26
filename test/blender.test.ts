// A second opinion from a tool that is not a game engine: the same fixtures go through
// Blender's glTF importer with no window, and a Python script reports what Blender ended up
// with. Godot checks what an engine makes of the file; this checks that a different reader,
// written by different people, agrees about sizes, facing, normals, names and colours.
//
// Needs a `blender` program on PATH (or its path in the BLENDER environment variable). Without
// one, every test here is skipped and a line on standard error says why.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportGameGlb, type ExportResult } from "../src/index.js";
import { box, chamferedBlock, cylinder, MM_Z_UP } from "./fixtures.js";

const BLENDER = process.env["BLENDER"] ?? "blender";
const BEGIN = "CORBELO_GAME_EXPORT_JSON_BEGIN";
const END = "CORBELO_GAME_EXPORT_JSON_END";
const SEGMENTS = 48;

interface BlenderTriangle {
  facing: number[];
  middle: number[];
  normals: number[][];
}

interface BlenderNode {
  name: string;
  meshName: string;
  location: number[];
  vertexCount: number;
  triangleCount: number;
  min: number[];
  max: number[];
  centre: number[];
  triangles: BlenderTriangle[];
  materials: { name: string; baseColor?: number[]; metallic?: number; roughness?: number }[];
}

interface BlenderFile {
  error?: string;
  nodes: BlenderNode[];
}

function blenderVersion(): string | null {
  const result = spawnSync(BLENDER, ["--version"], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return /Blender (\d+\.\d+(\.\d+)?)/.exec(result.stdout)?.[1] ?? null;
}

const version = blenderVersion();
if (version === null) {
  console.warn(`Skipping the Blender cross-check: no "${BLENDER}" program was found. Install Blender or set BLENDER to its path.`);
}

function near(actual: readonly number[], expected: readonly number[], digits = 5): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, at) => expect(actual[at]).toBeCloseTo(value, digits));
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

/** glTF (x, y, z), metres and +Y up, as Blender holds it: (x, -z, y), +Z up. */
function inBlender(point: readonly number[]): [number, number, number] {
  return [point[0]!, -point[2]! + 0, point[1]!];
}

describe.skipIf(version === null)("Blender glTF import", () => {
  let folder: string;
  let files: Record<string, BlenderFile>;
  const exports: Record<string, ExportResult> = {};

  beforeAll(() => {
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

    folder = mkdtempSync(join(tmpdir(), "corbelo-game-export-blender-"));
    const paths = Object.entries(exports).map(([name, result]) => {
      const path = join(folder, name);
      writeFileSync(path, result.glb);
      return path;
    });
    const script = join(dirname(fileURLToPath(import.meta.url)), "blender/inspect.py");
    const run = spawnSync(BLENDER, ["--background", "--factory-startup", "--python-exit-code", "1", "--python", script, "--", ...paths], {
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const start = run.stdout.indexOf(BEGIN);
    const end = run.stdout.indexOf(END);
    expect(start >= 0 && end > start, `the Blender script printed no report:\n${run.stdout}\n${run.stderr}`).toBe(true);
    files = (JSON.parse(run.stdout.slice(start + BEGIN.length, end)) as { files: Record<string, BlenderFile> }).files;
  }, 300_000);

  afterAll(() => {
    if (folder) rmSync(folder, { recursive: true, force: true });
  });

  function only(file: string): BlenderNode {
    expect(files[file]!.error).toBeUndefined();
    expect(files[file]!.nodes).toHaveLength(1);
    return files[file]!.nodes[0]!;
  }

  it("reads every file without an error", () => {
    for (const [name, file] of Object.entries(files)) expect(file.error, name).toBeUndefined();
  });

  it("finds the same bodies, names, triangles and vertices the facts report", () => {
    for (const [name, result] of Object.entries(exports)) {
      const nodes = files[name]!.nodes;
      expect(nodes.map((node) => node.name).sort()).toEqual(result.facts.bodies.map((body) => body.name).sort());
      for (const body of result.facts.bodies) {
        const node = nodes.find((candidate) => candidate.name === body.name)!;
        expect(node.triangleCount).toBe(body.triangles);
        // Blender merges vertices that share a position, so it holds at most what the file does
        // and never fewer than a closed mesh's distinct corners.
        expect(node.vertexCount).toBeLessThanOrEqual(body.vertices);
        expect(node.vertexCount).toBeGreaterThan(3);
      }
    }
  });

  it("measures each body where the facts say it is, in metres with Z up", () => {
    for (const [name, result] of Object.entries(exports)) {
      for (const body of result.facts.bodies) {
        const node = files[name]!.nodes.find((candidate) => candidate.name === body.name)!;
        const low = inBlender(body.bounds.meters.min);
        const high = inBlender(body.bounds.meters.max);
        // Turning Y up into Z up negates one axis, which swaps that axis's low and high.
        near(node.min, [low[0], Math.min(low[1], high[1]), low[2]]);
        near(node.max, [high[0], Math.max(low[1], high[1]), high[2]]);
        near(node.location, inBlender(body.translation));
      }
    }
  });

  it("sees every triangle facing outwards", () => {
    for (const name of ["block.glb", "cylinder.glb"]) {
      const node = only(name);
      for (const triangle of node.triangles) {
        const outwards = [0, 1, 2].map((axis) => triangle.middle[axis]! - node.centre[axis]!);
        expect(dot(triangle.facing, outwards)).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the written normals: unit length and on the outer side of their triangle", () => {
    for (const name of ["block.glb", "cylinder.glb"]) {
      for (const triangle of only(name).triangles) {
        const length = Math.hypot(...triangle.facing);
        for (const normal of triangle.normals) {
          expect(Math.hypot(...normal)).toBeCloseTo(1, 4);
          expect(dot(normal, triangle.facing) / length).toBeGreaterThan(0.5);
        }
      }
    }
  });

  it("keeps a flat face flat and a round side smooth", () => {
    // The block's large top face: every corner normal points straight up in Blender.
    const top = only("block.glb").triangles.filter((triangle) => triangle.facing[2]! / Math.hypot(...triangle.facing) > 0.999);
    expect(top.length).toBeGreaterThan(0);
    for (const triangle of top) for (const normal of triangle.normals) near(normal, [0, 0, 1], 4);
    // The cylinder's side: each corner normal points straight away from the axis, not along
    // its flat triangle, so neighbouring triangles share a normal where they meet.
    const side = only("cylinder.glb").triangles.filter((triangle) => Math.abs(triangle.facing[2]! / Math.hypot(...triangle.facing)) < 0.001);
    expect(side).toHaveLength(SEGMENTS * 2);
    const node = only("cylinder.glb");
    let radial = 0;
    for (const triangle of side) {
      for (const normal of triangle.normals) {
        expect(normal[2]).toBeCloseTo(0, 4);
        radial += 1;
      }
      // A flat-shaded side would give all three corners the triangle's own direction.
      const same = triangle.normals.every((normal) => dot(normal, triangle.normals[0]!) > 0.99999);
      expect(same).toBe(false);
    }
    expect(radial).toBe(SEGMENTS * 2 * 3);
    expect(node.centre[0]).toBeCloseTo(0, 5);
  });

  it("reads the materials and their colours as written", () => {
    for (const [name, result] of Object.entries(exports)) {
      for (const body of result.facts.bodies) {
        const node = files[name]!.nodes.find((candidate) => candidate.name === body.name)!;
        expect(node.materials.map((material) => material.name)).toEqual(body.materials);
        const written = result.facts.materials.find((material) => material.name === body.materials[0])!;
        near(node.materials[0]!.baseColor!, written.baseColorFactor, 4);
        expect(node.materials[0]!.metallic).toBeCloseTo(0, 4);
      }
    }
  });
});
