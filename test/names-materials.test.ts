import { describe, expect, it } from "vitest";
import { exportGameGlb, GameExportError, nodeNames, readGlb, readPack, type BodyInput } from "../src/index.js";
import { box, MM_Z_UP } from "./fixtures.js";

const positions = box([0, 0, 0], [10, 10, 10]).positions;

function body(name: string, extra: Partial<BodyInput> = {}): BodyInput {
  return { name, positions, ...extra };
}

describe("node names", () => {
  it("keeps letters, digits, underscores and hyphens and replaces the rest", () => {
    expect(nodeNames(["Left Wall (v2)", "Gehäuse/Deckel", "side-panel_01", "部品"])).toEqual(["Left_Wall_v2", "Gehause_Deckel", "side-panel_01", "body"]);
  });

  it("makes names unique without regard to letter case, in input order", () => {
    expect(nodeNames(["Block", "Block", "block", "Block_2"])).toEqual(["Block", "Block_2", "block_3", "Block_2_2"]);
  });

  it("keeps bodies clear of the names engines read as collision shapes or detail levels", () => {
    expect(nodeNames(["wall-col", "wall_col_2", "Ramp-convcolonly", "UCX_Wall", "ubx_crate_01", "part_LOD0", "door-navmesh"])).toEqual([
      "wall-col_body",
      "wall_col_2_body",
      "Ramp-convcolonly_body",
      "body_UCX_Wall",
      "body_ubx_crate_01",
      "part_LOD0_body",
      "door-navmesh_body",
    ]);
  });

  it("leaves ordinary names that merely contain those letters alone", () => {
    expect(nodeNames(["column", "protocol", "Lodge", "collar_2"])).toEqual(["column", "protocol", "Lodge", "collar_2"]);
  });

  it("limits names to 60 characters", () => {
    expect(nodeNames(["x".repeat(200)])[0]).toHaveLength(60);
  });

  it("writes the safe name to the node and the mesh and keeps the given name in the facts", () => {
    const { glb, facts } = exportGameGlb({ bodies: [body("Left Wall"), body("Left Wall")], source: MM_Z_UP });
    const { json } = readGlb(glb);
    expect(json.nodes!.map((node) => node.name)).toEqual(["Left_Wall", "Left_Wall_2"]);
    expect(json.meshes!.map((mesh) => mesh.name)).toEqual(["Left_Wall", "Left_Wall_2"]);
    expect(json.nodes!.map((node) => node.mesh)).toEqual([0, 1]);
    expect(facts.bodies.map((entry) => [entry.name, entry.sourceName])).toEqual([["Left_Wall", "Left Wall"], ["Left_Wall_2", "Left Wall"]]);
  });

  it("gives the same bytes for the same input", () => {
    const input = { bodies: [body("A", { color: "#336699" }), body("A"), body("B", { color: [0.2, 0.4, 0.6] as const })], source: MM_Z_UP, provenance: { run: 1 } };
    expect(exportGameGlb(input).glb).toEqual(exportGameGlb(input).glb);
  });
});

describe("materials", () => {
  it("makes one material per distinct colour, named after the colour", () => {
    const { glb, facts } = exportGameGlb({
      bodies: [body("a", { color: "#ff0000" }), body("b", { color: [1, 0, 0] }), body("c", { color: "#F00" }), body("d", { color: "00ff00" }), body("e")],
      source: MM_Z_UP,
    });
    expect(facts.materials.map((material) => [material.name, material.color, material.bodies])).toEqual([
      ["color_ff0000", "#ff0000", 3],
      ["color_00ff00", "#00ff00", 1],
      ["color_cccccc", "#cccccc", 1],
    ]);
    expect(facts.total.materialSlots).toBe(3);
    expect(facts.bodies.map((entry) => entry.materials)).toEqual([["color_ff0000"], ["color_ff0000"], ["color_ff0000"], ["color_00ff00"], ["color_cccccc"]]);
    const { json } = readGlb(glb);
    expect(json.materials).toHaveLength(3);
    expect(json.meshes!.map((mesh) => mesh.primitives[0]!.material)).toEqual([0, 0, 0, 1, 2]);
  });

  it("writes linear base colour, no metal and a roughness of 0.8", () => {
    const { glb } = exportGameGlb({ bodies: [body("grey", { color: "#808080" })], source: MM_Z_UP });
    const material = readPack(glb).bodies[0]!.material!;
    expect(material.baseColorFactor[0]).toBeCloseTo(0.215861, 6);
    expect(material.baseColorFactor[3]).toBe(1);
    expect(material.metallicFactor).toBe(0);
    expect(material.roughnessFactor).toBe(0.8);
  });

  it("reads [r, g, b] as linear light when asked", () => {
    const { facts } = exportGameGlb({ bodies: [body("grey", { color: [0.215861, 0.215861, 0.215861] })], source: MM_Z_UP, colorSpace: "linear" });
    expect(facts.materials[0]!.color).toBe("#808080");
  });

  it("uses a supplied material name", () => {
    const { facts } = exportGameGlb({
      bodies: [body("a", { color: "#ff0000", materialName: "Painted Steel" }), body("b", { color: "#ff0000", materialName: "Painted Steel" }), body("c", { color: "#ff0000" })],
      source: MM_Z_UP,
    });
    expect(facts.materials.map((material) => material.name)).toEqual(["Painted_Steel", "color_ff0000"]);
    expect(facts.materials[0]!.bodies).toBe(2);
  });

  it("refuses one material name with two colours", () => {
    const run = () => exportGameGlb({ bodies: [body("a", { color: "#ff0000", materialName: "paint" }), body("b", { color: "#0000ff", materialName: "paint" })], source: MM_Z_UP });
    expect(run).toThrowError(GameExportError);
    expect(run).toThrowError(/Material "paint" is used with two colours/);
  });
});
