import { validateBytes } from "gltf-validator";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TILE_METERS,
  exportGameAsset,
  exportGameGlb,
  GameExportError,
  readAccessor,
  readGlb,
  readPack,
  type AssetBodyInput,
  type AssetInput,
  type GameExportErrorCode,
  type GltfJson,
} from "../src/index.js";
import { box, chamferedBlock, cylinder, doorFrame, halfPaintedSide, MM_Z_UP } from "./fixtures.js";

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

/** The node names of a file as a tree: each name with its children indented under it. */
function tree(json: GltfJson): string[] {
  const lines: string[] = [];
  const walk = (index: number, depth: number): void => {
    const node = json.nodes![index]!;
    lines.push(`${"  ".repeat(depth)}${node.name}${node.mesh !== undefined ? ` [${json.meshes![node.mesh]!.name}]` : ""}`);
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  for (const root of json.scenes![0]!.nodes!) walk(root, 0);
  return lines;
}

const SEGMENTS = 48;
const post = cylinder(150, 400, SEGMENTS);
const postLevels = [{ positions: cylinder(150, 400, 16).positions }, { positions: cylinder(150, 400, 8).positions }];
const frame = doorFrame(3000, 300, 2800, 1200, 2200);

function fullAsset(profile: AssetInput["profile"]): AssetInput {
  return {
    bodies: [
      {
        name: "Post",
        positions: post.positions,
        faceIds: post.faceIds,
        lods: postLevels,
        attachPoints: [
          { name: "Top", position: [0, 0, 400], direction: [0, 0, 1] },
          { name: "Side Lamp", position: [150, 0, 300], direction: [1, 0, 0] },
        ],
      },
    ],
    source: MM_Z_UP,
    profile,
    texcoords: true,
  };
}

describe("a game asset", () => {
  it("is laid out for Godot: the body holds the full level, and the lower levels are hidden children", () => {
    const { glb, facts } = exportGameAsset(fullAsset("godot4"));
    const { json } = readGlb(glb);
    expect(tree(json)).toEqual(["Post [Post]", "  Post_LOD1 [Post_LOD1]", "  Post_LOD2 [Post_LOD2]", "  Post_00-convcolonly [Post_00-convcolonly]", "  Top", "  Side_Lamp"]);
    expect(json.scenes![0]!.nodes).toEqual([0]);
    expect(facts.settings.lodLayout).toBe("children");
    // Godot reads no level names and would draw all three at once.
    expect(json.extensionsUsed).toEqual(["KHR_node_visibility"]);
    expect(json.nodes![1]!.extensions).toEqual({ KHR_node_visibility: { visible: false } });
    expect(json.nodes![2]!.extensions).toEqual({ KHR_node_visibility: { visible: false } });
    expect(json.nodes![0]!.extensions).toBeUndefined();
    expect(facts.bodies[0]!.lods!.map((level) => [level.level, level.name, level.node, level.mesh, level.visible])).toEqual([
      [0, "Post", 0, 0, true],
      [1, "Post_LOD1", 1, 1, false],
      [2, "Post_LOD2", 2, 2, false],
    ]);
  });

  it("is laid out for Unity and Unreal: an empty node holds every level, named the way they read levels", () => {
    for (const [profile, collision] of [["unity6", "Post_collision_00"], ["unreal5", "UCX_Post_00"]] as const) {
      const { glb, facts } = exportGameAsset(fullAsset(profile));
      const { json } = readGlb(glb);
      expect(tree(json)).toEqual(["Post", "  Post_LOD0 [Post_LOD0]", "  Post_LOD1 [Post_LOD1]", "  Post_LOD2 [Post_LOD2]", `  ${collision} [${collision}]`, "  Top", "  Side_Lamp"]);
      expect(facts.settings.lodLayout).toBe("group");
      expect(json.extensionsUsed).toBeUndefined();
      expect(facts.bodies[0]).toMatchObject({ name: "Post", node: 0, mesh: 0 });
      expect(facts.bodies[0]!.lods!.map((level) => [level.name, level.node, level.visible])).toEqual([
        ["Post_LOD0", 1, true],
        ["Post_LOD1", 2, true],
        ["Post_LOD2", 3, true],
      ]);
    }
  });

  it("writes no level layout for a body without lower levels", () => {
    const { glb, facts } = exportGameAsset({ bodies: [{ name: "Post", positions: post.positions }], source: MM_Z_UP, profile: "unreal5" });
    expect(tree(readGlb(glb).json)).toEqual(["Post [Post]", "  UCX_Post_00 [UCX_Post_00]"]);
    expect(facts.settings).not.toHaveProperty("lodLayout");
    expect(facts.bodies[0]).not.toHaveProperty("lods");
    expect(facts.bodies[0]).not.toHaveProperty("attachPoints");
  });

  it("passes the Khronos glTF validator with no errors or warnings, for every engine", async () => {
    const inputs: AssetInput[] = [
      fullAsset("godot4"),
      fullAsset("unity6"),
      fullAsset("unreal5"),
      { bodies: [{ name: "Frame", positions: frame.positions, color: "#8a6f4d" }], source: MM_Z_UP, collision: "box" },
      {
        bodies: [
          { name: "Post", positions: post.positions, faceIds: post.faceIds, color: "#2980ba", faceColors: halfPaintedSide(SEGMENTS, "#c0392b"), lods: [{ positions: cylinder(150, 400, 12).positions }] },
          { name: "Crate", positions: box([400, 0, 0], [900, 500, 500]).positions },
        ],
        source: MM_Z_UP,
        placement: "designed",
        texcoords: { tileMeters: 0.5 },
        normals: "face-weighted",
      },
    ];
    for (const input of inputs) {
      const report = await validateBytes(exportGameAsset(input).glb);
      expect(report.issues.numErrors, JSON.stringify(report.issues.messages)).toBe(0);
      expect(report.issues.numWarnings, JSON.stringify(report.issues.messages)).toBe(0);
      expect(report.issues.numHints).toBe(0);
      // What is left is for information: nothing in the file uses the tangents or the texture
      // coordinates yet, attach points are empty nodes by design, and the validator does not
      // know the visibility extension.
      const known = ["UNUSED_MESH_TANGENT", "UNUSED_OBJECT", "NODE_EMPTY", "UNSUPPORTED_EXTENSION"];
      expect(report.issues.messages.filter((message) => !known.includes(message.code))).toEqual([]);
    }
  });

  it("gives the same bytes for the same input, every time", () => {
    for (const profile of ["godot4", "unity6", "unreal5"] as const) {
      const first = exportGameAsset(fullAsset(profile));
      const second = exportGameAsset(fullAsset(profile));
      expect(Buffer.from(second.glb).equals(Buffer.from(first.glb))).toBe(true);
      expect(second.facts).toEqual(first.facts);
    }
  });

  it("keeps the visible mesh exactly as exportGameGlb writes it", () => {
    const body = { name: "Block", positions: chamferedBlock([1000, 500, 250], 20).positions };
    const plain = readPack(exportGameGlb({ bodies: [body], source: MM_Z_UP }).glb).bodies[0]!;
    const asset = readPack(exportGameAsset({ bodies: [body], source: MM_Z_UP }).glb);
    // Collision is not a body: the reader gives the bodies and nothing else.
    expect(asset.bodies).toHaveLength(1);
    expect(asset.bodies[0]!.positions).toEqual(plain.positions);
    expect(asset.bodies[0]!.normals).toEqual(plain.normals);
    expect(asset.bodies[0]!.indices).toEqual(plain.indices);
    expect(asset.bodies[0]!.texcoords).toHaveLength(0);
  });

  it("reads the full level back as the body in every layout", () => {
    for (const profile of ["godot4", "unreal5"] as const) {
      const { glb, facts } = exportGameAsset(fullAsset(profile));
      const pack = readPack(glb);
      expect(pack.bodies).toHaveLength(1);
      expect(pack.bodies[0]!.name).toBe("Post");
      expect(pack.bodies[0]!.indices.length / 3).toBe(facts.bodies[0]!.triangles);
      expect(pack.bodies[0]!.positions.length / 3).toBe(facts.bodies[0]!.vertices);
      expect(pack.bodies[0]!.texcoords.length / 2).toBe(facts.bodies[0]!.vertices);
    }
  });
});

describe("names that stick", () => {
  it("keeps every name and the pivot from one revision of a part to the next", () => {
    const revision = (segments: number, chamfer: number): AssetInput => ({
      bodies: [
        {
          name: "Post",
          positions: cylinder(150, 400, segments).positions,
          color: "#2980ba",
          materialName: "Paint",
          lods: [{ positions: cylinder(150, 400, 8).positions }],
          attachPoints: [{ name: "Top", position: [0, 0, 400] }],
        },
        { name: "Base", positions: chamferedBlock([600, 600, 80], chamfer).positions, color: "#555555" },
      ],
      source: MM_Z_UP,
      profile: "unreal5",
    });
    const first = exportGameAsset(revision(24, 10));
    const second = exportGameAsset(revision(40, 14));
    const names = (glb: Uint8Array) => {
      const { json } = readGlb(glb);
      return { nodes: tree(json), meshes: json.meshes!.map((mesh) => mesh.name), materials: json.materials!.map((material) => material.name) };
    };
    expect(names(second.glb)).toEqual(names(first.glb));
    expect(names(first.glb).nodes).toEqual(["Post", "  Post_LOD0 [Post_LOD0]", "  Post_LOD1 [Post_LOD1]", "  UCX_Post_00 [UCX_Post_00]", "  Top", "Base [Base]", "  UBX_Base_00 [UBX_Base_00]"]);
    expect(second.facts.bodies.map((body) => body.pivot)).toEqual(first.facts.bodies.map((body) => body.pivot));
    expect(second.facts.bodies[0]!.attachPoints).toEqual(first.facts.bodies[0]!.attachPoints);
  });

  it("orders material slots by name, so a repaint that changes which colour comes first moves no slot", () => {
    const painted = (first: string, second: string): AssetBodyInput => ({
      name: "Post",
      positions: post.positions,
      color: first,
      faceColors: halfPaintedSide(SEGMENTS, second),
      faceMaterialNames: { "#c0392b": "Red", "#2980ba": "Blue" },
    });
    const one = exportGameAsset({ bodies: [painted("#c0392b", "#2980ba")], source: MM_Z_UP });
    const other = exportGameAsset({ bodies: [painted("#2980ba", "#c0392b")], source: MM_Z_UP });
    expect(one.facts.bodies[0]!.materials).toEqual(["Blue", "Red"]);
    expect(other.facts.bodies[0]!.materials).toEqual(["Blue", "Red"]);
    expect(one.facts.materials.map((material) => material.name)).toEqual(["Blue", "Red"]);
    // exportGameGlb keeps the order of first use, as it always has.
    expect(exportGameGlb({ bodies: [painted("#c0392b", "#2980ba")], source: MM_Z_UP }).facts.bodies[0]!.materials[0]).not.toBe(
      exportGameGlb({ bodies: [painted("#2980ba", "#c0392b")], source: MM_Z_UP }).facts.bodies[0]!.materials[0],
    );
  });

  it("keeps names of collision, levels and attach points apart from each other and from bodies", () => {
    const { glb } = exportGameAsset({
      bodies: [
        { name: "Post", positions: post.positions, lods: [{ positions: cylinder(150, 400, 8).positions }], attachPoints: [{ name: "Post", position: [0, 0, 0] }, { name: "Post", position: [0, 0, 400] }, { name: "!!", position: [0, 0, 1] }] },
        { name: "Post", positions: box([400, 0, 0], [500, 100, 100]).positions },
      ],
      source: MM_Z_UP,
      placement: "designed",
    });
    const names = readGlb(glb).json.nodes!.map((node) => node.name!);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    expect(names).toContain("attach");
  });
});

describe("detail levels", () => {
  it("measures each level: triangles, vertices and how far its outline moved", () => {
    const { facts } = exportGameAsset(fullAsset("godot4"));
    const [full, lower, lowest] = facts.bodies[0]!.lods!;
    expect(full).toMatchObject({ level: 0, triangles: 4 * SEGMENTS, deviation: { meters: 0, engine: 0, share: 0 } });
    expect(full!.triangles).toBe(facts.bodies[0]!.triangles);
    expect(full!.vertices).toBe(facts.bodies[0]!.vertices);
    expect(lower).toMatchObject({ level: 1, triangles: 64, openEdges: 0, nonManifoldEdges: 0, materialSlots: 1 });
    expect(lowest).toMatchObject({ level: 2, triangles: 32, openEdges: 0, nonManifoldEdges: 0 });
    // A round post of radius 0.15 m with n sides: its sides sit 0.15 * (1 - cos(pi / n)) inside the circle.
    const sagitta = (sides: number) => 0.15 * (1 - Math.cos(Math.PI / sides));
    expect(lower!.deviation.meters).toBeGreaterThan(sagitta(16) - sagitta(SEGMENTS) - 1e-6);
    expect(lower!.deviation.meters).toBeLessThanOrEqual(sagitta(16) + 1e-6);
    expect(lowest!.deviation.meters).toBeGreaterThan(sagitta(8) - sagitta(SEGMENTS) - 1e-6);
    expect(lowest!.deviation.meters).toBeLessThanOrEqual(sagitta(8) + 1e-6);
    // The share is of the diagonal of the box around the full level: 0.3 by 0.4 by 0.3.
    expect(lowest!.deviation.share).toBeCloseTo(lowest!.deviation.meters / Math.hypot(0.3, 0.4, 0.3), 7);
    expect(lowest!.deviation.engine).toBe(lowest!.deviation.meters);
  });

  it("reports the distance in the engine's unit too", () => {
    const { facts } = exportGameAsset(fullAsset("unreal5"));
    const lowest = facts.bodies[0]!.lods![2]!;
    expect(lowest.deviation.engine).toBeCloseTo(lowest.deviation.meters * 100, 9);
  });

  it("writes each level as given: same pivot as the body, same triangles, still closed", () => {
    const { glb, facts } = exportGameAsset(fullAsset("godot4"));
    const document = readGlb(glb);
    for (const level of facts.bodies[0]!.lods!.slice(1)) {
      const primitive = document.json.meshes![level.mesh]!.primitives[0]!;
      const positions = readAccessor(document, primitive.attributes["POSITION"]!);
      expect(readAccessor(document, primitive.indices!).length / 3).toBe(level.triangles);
      expect(positions.length / 3).toBe(level.vertices);
      // Around the same pivot: the middle of the base.
      const ys = positions.filter((_, at) => at % 3 === 1);
      expect(Math.min(...ys)).toBeCloseTo(0, 6);
      expect(Math.max(...ys)).toBeCloseTo(0.4, 6);
      expect(Object.keys(primitive.attributes).sort()).toEqual(["NORMAL", "POSITION", "TANGENT", "TEXCOORD_0"]);
      expect(document.json.nodes![level.node]!.translation).toBeUndefined();
    }
  });

  it("says when a level is not closed, and leaves it as given", () => {
    // A level that lost a triangle.
    const open = cylinder(150, 400, 8).positions.slice(9);
    const { facts } = exportGameAsset({ bodies: [{ name: "Post", positions: post.positions, lods: [{ positions: open }] }], source: MM_Z_UP });
    expect(facts.bodies[0]!.lods![1]).toMatchObject({ triangles: 31, openEdges: 3 });
    expect(facts.bodies[0]!.openEdges).toBe(0);
  });

  it("gives a level the body's colours, and its own where it says", () => {
    const { facts } = exportGameAsset({
      bodies: [
        {
          name: "Post",
          positions: post.positions,
          color: "#2980ba",
          faceColors: halfPaintedSide(SEGMENTS, "#c0392b"),
          lods: [{ positions: cylinder(150, 400, 16).positions, faceColors: halfPaintedSide(16, "#c0392b") }, { positions: cylinder(150, 400, 8).positions }],
        },
      ],
      source: MM_Z_UP,
    });
    const [full, lower, lowest] = facts.bodies[0]!.lods!;
    expect(full!.materials).toEqual(["color_2980ba", "color_c0392b"]);
    expect(lower!.materials).toEqual(["color_2980ba", "color_c0392b"]);
    expect(lowest!.materials).toEqual(["color_2980ba"]);
    expect(facts.materials.map((material) => material.name)).toEqual(["color_2980ba", "color_c0392b"]);
  });

  it("counts the triangles of levels toward the most allowed", () => {
    const refused = refusal(() => exportGameAsset({ ...fullAsset("godot4"), maxTriangles: 4 * SEGMENTS + 64 + 31 }));
    expect(refused.code).toBe("TOO_MANY_TRIANGLES");
    expect(() => exportGameAsset({ ...fullAsset("godot4"), maxTriangles: 4 * SEGMENTS + 64 + 32 })).not.toThrow();
  });

  it("refuses levels it cannot read, naming the body and the level", () => {
    const body = { name: "Post", positions: post.positions };
    expect(refusal(() => exportGameAsset({ bodies: [{ ...body, lods: {} as never }], source: MM_Z_UP }))).toMatchObject({ code: "BAD_LOD", body: 0 });
    const empty = refusal(() => exportGameAsset({ bodies: [body, { ...body, name: "Other", lods: [null as never] }], source: MM_Z_UP }));
    expect(empty).toMatchObject({ code: "BAD_LOD", body: 1 });
    const short = refusal(() => exportGameAsset({ bodies: [{ ...body, lods: [{ positions: [0, 0, 0, 1, 0, 0] }] }], source: MM_Z_UP }));
    expect(short.body).toBe(0);
    expect(short.message).toContain("detail level 1");
    const colours = refusal(() => exportGameAsset({ bodies: [{ ...body, lods: [{ positions: cylinder(150, 400, 8).positions, faceColors: ["#ff0000"] }] }], source: MM_Z_UP }));
    expect(colours.code).toBe("BAD_FACE_COLORS");
  });
});

describe("attach points", () => {
  it("writes each as an empty node under its body, where the point is from the pivot", () => {
    const { glb, facts } = exportGameAsset(fullAsset("godot4"));
    const { json } = readGlb(glb);
    const [top, side] = facts.bodies[0]!.attachPoints!;
    expect(top).toMatchObject({ name: "Top", sourceName: "Top", source: [0, 0, 400], direction: [0, 1, 0] });
    expect(side).toMatchObject({ name: "Side_Lamp", sourceName: "Side Lamp", source: [150, 0, 300], direction: [1, 0, 0] });
    const topNode = json.nodes![top!.node]!;
    expect(topNode.mesh).toBeUndefined();
    // The pivot is the middle of the base, so the top is 0.4 m straight up from it.
    expect(topNode.translation!.map((value) => Math.round(value * 1e6) / 1e6)).toEqual([0, 0.4, 0]);
    expect(json.nodes![side!.node]!.translation!.map((value) => Math.round(value * 1e6) / 1e6)).toEqual([0.15, 0.3, 0]);
    expect(top!.meters.map((value) => Math.round(value * 1e6) / 1e6)).toEqual([0, 0.4, 0]);
  });

  it("turns the node's own +Z axis to the direction given", () => {
    const directions: [number, number, number][] = [[0, 0, 1], [1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, -1], [1, 2, -3], [-5, 0.1, 0.2]];
    const { glb, facts } = exportGameAsset({
      bodies: [{ name: "Post", positions: post.positions, attachPoints: directions.map((direction, at) => ({ name: `p${at}`, position: [0, 0, 0] as const, direction })) }],
      source: MM_Z_UP,
    });
    const { json } = readGlb(glb);
    for (const [at, point] of facts.bodies[0]!.attachPoints!.entries()) {
      const [x, y, z, w] = json.nodes![point.node]!.rotation ?? [0, 0, 0, 1];
      expect(Math.hypot(x!, y!, z!, w!)).toBeCloseTo(1, 12);
      // +Z turned by the quaternion.
      const turned = [2 * (x! * z! + w! * y!), 2 * (y! * z! - w! * x!), 1 - 2 * (x! * x! + y! * y!)];
      // The source is Z up and glTF is Y up: source (x, y, z) is glTF (x, z, -y).
      const [sx, sy, sz] = directions[at]!;
      const length = Math.hypot(sx, sy, sz);
      const expected = [sx / length, sz / length, -sy / length];
      turned.forEach((value, axis) => expect(value).toBeCloseTo(expected[axis]!, 9));
      point.direction!.forEach((value, axis) => expect(value).toBeCloseTo(expected[axis]!, 9));
    }
    // A point with no direction has no rotation.
    const plain = exportGameAsset({ bodies: [{ name: "Post", positions: post.positions, attachPoints: [{ name: "p", position: [1, 2, 3] }] }], source: MM_Z_UP });
    const node = readGlb(plain.glb).json.nodes![plain.facts.bodies[0]!.attachPoints![0]!.node]!;
    expect(node.rotation).toBeUndefined();
    expect(plain.facts.bodies[0]!.attachPoints![0]).not.toHaveProperty("direction");
  });

  it("moves with the body: the place in the scene and in the engine's unit follow the placement", () => {
    const { facts } = exportGameAsset({
      bodies: [{ name: "Crate", positions: box([1000, 2000, 0], [2000, 3000, 500]).positions, attachPoints: [{ name: "Lid", position: [1500, 2500, 500] }] }],
      source: MM_Z_UP,
      placement: "designed",
      profile: "unreal5",
    });
    const point = facts.bodies[0]!.attachPoints![0]!;
    expect(point.meters.map((value) => Math.round(value * 1e6) / 1e6)).toEqual([1.5, 0.5, -2.5]);
    // Unreal: centimetres, with the height moved to the Z place, as every box in the facts is.
    expect(point.engine.map((value) => Math.round(value * 1e4) / 1e4)).toEqual([150, -250, 50]);
  });

  it("refuses points it cannot read", () => {
    const body = { name: "Post", positions: post.positions };
    const run = (attachPoints: unknown) => refusal(() => exportGameAsset({ bodies: [{ ...body, attachPoints: attachPoints as never }], source: MM_Z_UP }));
    expect(run({})).toMatchObject({ code: "BAD_ATTACH_POINT", body: 0 });
    expect(run([null]).code).toBe("BAD_ATTACH_POINT");
    expect(run([{ name: " ", position: [0, 0, 0] }]).message).toContain("needs a name");
    expect(run([{ name: "a", position: [0, 0] }]).code).toBe("BAD_ATTACH_POINT");
    expect(run([{ name: "a", position: [0, 0, Number.NaN] }]).code).toBe("BAD_ATTACH_POINT");
    expect(run([{ name: "a", position: [0, 0, 0], direction: [0, 0, 0] }]).message).toContain("not all zero");
  });
});

describe("texture coordinates", () => {
  /** For each triangle of a body: its corners, texture coordinates, normals and tangents. */
  function triangles(glb: Uint8Array): { p: number[][]; uv: number[][]; n: number[][]; t: number[][] }[] {
    const document = readGlb(glb);
    const primitive = document.json.meshes![0]!.primitives[0]!;
    const positions = readAccessor(document, primitive.attributes["POSITION"]!);
    const uvs = readAccessor(document, primitive.attributes["TEXCOORD_0"]!);
    const normals = readAccessor(document, primitive.attributes["NORMAL"]!);
    const tangents = readAccessor(document, primitive.attributes["TANGENT"]!);
    const indices = readAccessor(document, primitive.indices!);
    const out = [];
    for (let at = 0; at < indices.length; at += 3) {
      const corners = [indices[at]!, indices[at + 1]!, indices[at + 2]!];
      out.push({
        p: corners.map((v) => [...positions.subarray(v * 3, v * 3 + 3)]),
        uv: corners.map((v) => [...uvs.subarray(v * 2, v * 2 + 2)]),
        n: corners.map((v) => [...normals.subarray(v * 3, v * 3 + 3)]),
        t: corners.map((v) => [...tangents.subarray(v * 4, v * 4 + 4)]),
      });
    }
    return out;
  }

  it("is written only on request, and the facts say how", () => {
    const body = { name: "Crate", positions: box([0, 0, 0], [2000, 1000, 500]).positions };
    const without = exportGameAsset({ bodies: [body], source: MM_Z_UP });
    expect(Object.keys(readGlb(without.glb).json.meshes![0]!.primitives[0]!.attributes).sort()).toEqual(["NORMAL", "POSITION", "TANGENT"]);
    expect(without.facts.settings).not.toHaveProperty("texcoords");
    expect(exportGameAsset({ bodies: [body], source: MM_Z_UP, texcoords: false }).glb).toEqual(without.glb);
    const withUvs = exportGameAsset({ bodies: [body], source: MM_Z_UP, texcoords: true });
    expect(withUvs.facts.settings.texcoords).toEqual({ projection: "box", tileMeters: DEFAULT_TILE_METERS });
    expect(exportGameAsset({ bodies: [body], source: MM_Z_UP, texcoords: { tileMeters: 0.25 } }).facts.settings.texcoords).toEqual({ projection: "box", tileMeters: 0.25 });
    const accessor = readGlb(withUvs.glb).json.accessors![readGlb(withUvs.glb).json.meshes![0]!.primitives[0]!.attributes["TEXCOORD_0"]!]!;
    expect(accessor).toMatchObject({ componentType: 5126, type: "VEC2", count: 24 });
  });

  it("is at the scale of the world: a metre of surface is one texture, or as many as the tile says", () => {
    const body = { name: "Crate", positions: box([0, 0, 0], [2000, 1000, 500]).positions };
    for (const tileMeters of [1, 0.25]) {
      for (const triangle of triangles(exportGameAsset({ bodies: [body], source: MM_Z_UP, texcoords: { tileMeters } }).glb)) {
        // On a flat side of a box, lengths in the texture are lengths in the world over the tile.
        for (let k = 0; k < 3; k += 1) {
          const [a, b] = [k, (k + 1) % 3];
          const world = Math.hypot(triangle.p[a]![0]! - triangle.p[b]![0]!, triangle.p[a]![1]! - triangle.p[b]![1]!, triangle.p[a]![2]! - triangle.p[b]![2]!);
          const texture = Math.hypot(triangle.uv[a]![0]! - triangle.uv[b]![0]!, triangle.uv[a]![1]! - triangle.uv[b]![1]!);
          expect(texture).toBeCloseTo(world / tileMeters, 5);
        }
      }
    }
  });

  it("stands a texture upright on the sides and mirrors it nowhere, with tangents that follow", () => {
    for (const shape of [box([0, 0, 0], [2000, 1000, 500]).positions, chamferedBlock([1000, 500, 250], 60).positions, post.positions]) {
      for (const triangle of triangles(exportGameAsset({ bodies: [{ name: "Shape", positions: shape }], source: MM_Z_UP, texcoords: true }).glb)) {
        const [p0, p1, p2] = triangle.p as [number[], number[], number[]];
        const [uv0, uv1, uv2] = triangle.uv as [number[], number[], number[]];
        const e1 = [p1[0]! - p0[0]!, p1[1]! - p0[1]!, p1[2]! - p0[2]!];
        const e2 = [p2[0]! - p0[0]!, p2[1]! - p0[1]!, p2[2]! - p0[2]!];
        const [du1, dv1, du2, dv2] = [uv1[0]! - uv0[0]!, uv1[1]! - uv0[1]!, uv2[0]! - uv0[0]!, uv2[1]! - uv0[1]!];
        const area = du1 * dv2 - du2 * dv1;
        // Seen from outside, with v running down the picture as glTF has it, the triangle turns
        // the same way in the texture as in the world.
        expect(area).toBeLessThan(0);
        // The way u grows across the triangle, and the way v grows.
        const alongU = e1.map((value, axis) => (value * dv2 - e2[axis]! * dv1) / area);
        const alongV = e2.map((value, axis) => (value * du1 - e1[axis]! * du2) / area);
        const face = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
        for (let corner = 0; corner < 3; corner += 1) {
          const n = triangle.n[corner]!;
          const [tx, ty, tz, tw] = triangle.t[corner] as [number, number, number, number];
          expect(tw).toBe(1);
          expect(Math.hypot(tx, ty, tz)).toBeCloseTo(1, 5);
          // At a right angle to the normal.
          expect(tx * n[0]! + ty * n[1]! + tz * n[2]!).toBeCloseTo(0, 5);
          // The tangent points the way u grows.
          expect(tx * alongU[0]! + ty * alongU[1]! + tz * alongU[2]!).toBeGreaterThan(0);
          // The bitangent, cross(normal, tangent) * w, points the way v falls: up the picture.
          const bitangent = [n[1]! * tz - n[2]! * ty, n[2]! * tx - n[0]! * tz, n[0]! * ty - n[1]! * tx];
          expect(bitangent[0]! * alongV[0]! + bitangent[1]! * alongV[1]! + bitangent[2]! * alongV[2]!).toBeLessThan(0);
        }
        // On a side that stands upright, up in the world is up the picture: v falls as y rises.
        if (Math.abs(face[1]!) < 1e-9) expect(alongV[1]!).toBeLessThan(0);
      }
    }
  });

  it("splits a vertex shared by sides projected along different axes, and nothing else", () => {
    const body = { name: "Post", positions: post.positions };
    const plain = exportGameAsset({ bodies: [body], source: MM_Z_UP });
    const mapped = exportGameAsset({ bodies: [body], source: MM_Z_UP, texcoords: true });
    expect(mapped.facts.bodies[0]!.triangles).toBe(plain.facts.bodies[0]!.triangles);
    // The round side of a post is projected along X on two of its quarters and along Z on the
    // other two: its vertices double along the four lines where the projection changes.
    expect(mapped.facts.bodies[0]!.vertices).toBe(plain.facts.bodies[0]!.vertices + 4 * 2);
    // A box is hard along every edge already, so nothing more is split.
    const crate = { name: "Crate", positions: box([0, 0, 0], [2000, 1000, 500]).positions };
    expect(exportGameAsset({ bodies: [crate], source: MM_Z_UP, texcoords: true }).facts.bodies[0]!.vertices).toBe(24);
  });

  it("lines textures up across bodies that are placed as designed", () => {
    // Two crates side by side share the plane of their tops: the texture runs on across the gap.
    const { glb } = exportGameAsset({
      bodies: [
        { name: "A", positions: box([0, 0, 0], [700, 700, 500]).positions },
        { name: "B", positions: box([700, 0, 0], [1900, 700, 500]).positions },
      ],
      source: MM_Z_UP,
      placement: "designed",
      texcoords: true,
      collision: "none",
    });
    const pack = readPack(glb);
    const topCorner = (body: number, x: number): number[] => {
      const { positions, texcoords, translation } = pack.bodies[body]!;
      for (let v = 0; v < positions.length / 3; v += 1) {
        const world = [positions[v * 3]! + translation[0], positions[v * 3 + 1]! + translation[1], positions[v * 3 + 2]! + translation[2]];
        // A corner of the top, at the given x and the far edge.
        const normalY = pack.bodies[body]!.normals[v * 3 + 1]!;
        if (normalY > 0.99 && Math.abs(world[0]! - x) < 1e-6 && Math.abs(world[2]! - 0) < 1e-6) return [texcoords[v * 2]!, texcoords[v * 2 + 1]!];
      }
      throw new Error("No such corner.");
    };
    const fromA = topCorner(0, 0.7);
    const fromB = topCorner(1, 0.7);
    expect(fromA[0]).toBeCloseTo(fromB[0]!, 6);
    expect(fromA[1]).toBeCloseTo(fromB[1]!, 6);
    expect(fromA[0]).toBeCloseTo(0.7, 6);
  });

  it("refuses settings it cannot read", () => {
    const body = { name: "Crate", positions: box([0, 0, 0], [1, 1, 1]).positions };
    expect(refusal(() => exportGameAsset({ bodies: [body], source: MM_Z_UP, texcoords: "yes" as never })).code).toBe("BAD_OPTION");
    expect(refusal(() => exportGameAsset({ bodies: [body], source: MM_Z_UP, texcoords: { tileMeters: 0 } })).code).toBe("BAD_OPTION");
  });
});
