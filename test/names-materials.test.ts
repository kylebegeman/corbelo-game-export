import { describe, expect, it } from "vitest";
import { exportGameGlb, GameExportError, nodeNames, readGlb, readPack, type BodyInput } from "../src/index.js";
import { box, MM_Z_UP, paintedTop } from "./fixtures.js";

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

describe("names for the materials of face colours", () => {
  const RED = "#c0392b";
  const BLUE = "#2980ba";
  const painted = (extra: Partial<BodyInput> = {}, name = "Crate") => body(name, { color: BLUE, faceColors: paintedTop(RED), ...extra });
  const names = (...bodies: BodyInput[]) => exportGameGlb({ bodies, source: MM_Z_UP }).facts.materials.map((material) => [material.name, material.color]);
  const refusal = (...bodies: unknown[]) => {
    try {
      exportGameGlb({ bodies: bodies as BodyInput[], source: MM_Z_UP });
    } catch (error) {
      expect(error).toBeInstanceOf(GameExportError);
      return { code: (error as GameExportError).code, message: (error as GameExportError).message };
    }
    throw new Error("Expected the export to be refused, but it went through.");
  };

  it("names the material of a listed colour and leaves the others named after themselves", () => {
    expect(names(painted())).toEqual([["color_2980ba", BLUE], ["color_c0392b", RED]]);
    expect(names(painted({ faceMaterialNames: { [RED]: "Signal Red" } }))).toEqual([["color_2980ba", BLUE], ["Signal_Red", RED]]);
    const { glb, facts } = exportGameGlb({ bodies: [painted({ materialName: "Body Paint", faceMaterialNames: { [RED]: "Signal Red" } })], source: MM_Z_UP });
    expect(readGlb(glb).json.materials!.map((material) => material.name)).toEqual(["Body_Paint", "Signal_Red"]);
    expect(facts.bodies[0]!.materials).toEqual(["Body_Paint", "Signal_Red"]);
    expect(facts.bodies[0]!.slots!.map((slot) => slot.material)).toEqual(["Body_Paint", "Signal_Red"]);
  });

  it("reads the colour however it is spelled, and whatever way the triangles spell it", () => {
    const faceColors = Array.from({ length: 12 }, (_, triangle) => (triangle >= 10 ? ([1, 0, 0] as const) : triangle >= 8 ? "F00" : null));
    for (const key of ["#ff0000", "#F00", "ff0000", " #FF0000 "]) {
      expect(names(body("Crate", { color: BLUE, faceColors, faceMaterialNames: { [key]: "Red" } }))).toEqual([["color_2980ba", BLUE], ["Red", "#ff0000"]]);
    }
  });

  it("makes the name safe, as it does a body's own material name", () => {
    expect(names(painted({ faceMaterialNames: { [RED]: "PLA+ Rot / matt" } }))[1]).toEqual(["PLA_Rot_matt", RED]);
  });

  it("shares one material between bodies that give a colour the same name", () => {
    const { facts } = exportGameGlb({
      bodies: [painted({ faceMaterialNames: { [RED]: "Red" } }), painted({ faceMaterialNames: { [RED]: "Red" } }, "Second"), body("Third", { color: RED, materialName: "Red" }), painted({}, "Fourth")],
      source: MM_Z_UP,
    });
    expect(facts.materials.map((material) => [material.name, material.bodies])).toEqual([["color_2980ba", 3], ["Red", 3], ["color_c0392b", 1]]);
  });

  it("names the body's own material when the colour listed is the body's own", () => {
    expect(names(painted({ faceMaterialNames: { [BLUE]: "Blue", [RED]: "Red" } }))).toEqual([["Blue", BLUE], ["Red", RED]]);
    // Also for a body in one colour, and when materialName says the same.
    expect(names(body("Plain", { color: BLUE, faceMaterialNames: { [BLUE]: "Blue" } }))).toEqual([["Blue", BLUE]]);
    expect(names(painted({ materialName: "Blue", faceMaterialNames: { [BLUE]: "Blue" } }))[0]).toEqual(["Blue", BLUE]);
    expect(refusal(painted({ materialName: "Body Paint", faceMaterialNames: { [BLUE]: "Blue" } }))).toEqual({
      code: "MATERIAL_CONFLICT",
      message: 'Body "Crate": materialName names the material of the body\'s own colour #2980ba "Body_Paint", and faceMaterialNames names it "Blue". Give the colour one name.',
    });
  });

  it("checks a name for a colour no triangle has, and writes no material for it", () => {
    expect(names(painted({ faceMaterialNames: { "#00ff00": "Green" } }))).toEqual([["color_2980ba", BLUE], ["color_c0392b", RED]]);
    expect(refusal(painted({ faceMaterialNames: { crimson: "Red" } }))).toEqual({
      code: "BAD_COLOR",
      message: 'Body "Crate", faceMaterialNames: colour "crimson" is not "#rrggbb" or "#rgb". Transparency is not supported.',
    });
    expect(refusal(painted({ faceMaterialNames: { "#00ff00": "  " } }))).toEqual({
      code: "BAD_NAME",
      message: 'Body "Crate": the material name of colour "#00ff00" in faceMaterialNames must be a string with at least one character.',
    });
    expect(refusal(painted({ faceMaterialNames: { "#00ff00": 7 } as never })).code).toBe("BAD_NAME");
    for (const bad of [["#00ff00", "Green"], "Green", 7, null]) expect(refusal(painted({ faceMaterialNames: bad as never })).code).toBe("BAD_NAME");
  });

  it("refuses one colour with two names", () => {
    expect(names(painted({ faceMaterialNames: { "#c0392b": "Red", "C0392B": "Red" } }))[1]).toEqual(["Red", RED]);
    expect(refusal(painted({ faceMaterialNames: { "#c0392b": "Red", "C0392B": "Rot" } }))).toEqual({
      code: "MATERIAL_CONFLICT",
      message: 'Body "Crate": faceMaterialNames gives colour #c0392b two material names, "Red" and "Rot". Give each colour one name.',
    });
  });

  it("refuses one name with two colours, in one body or across bodies", () => {
    const one = refusal(body("Crate", { color: BLUE, faceColors: Array.from({ length: 12 }, (_, triangle) => (triangle < 2 ? RED : triangle < 4 ? "#00ff00" : null)), faceMaterialNames: { [RED]: "Paint", "#00ff00": "Paint" } }));
    expect(one).toEqual({ code: "MATERIAL_CONFLICT", message: 'Material "Paint" is used with two colours, #c0392b and #00ff00 (body "Crate"). Give each colour its own material name.' });
    expect(refusal(painted({ materialName: "Paint", faceMaterialNames: { [RED]: "Paint" } })).code).toBe("MATERIAL_CONFLICT");
    expect(refusal(body("First", { color: "#00ff00", materialName: "Paint" }), painted({ faceMaterialNames: { [RED]: "Paint" } })).code).toBe("MATERIAL_CONFLICT");
    // Two names that are the same once made safe are one name.
    expect(refusal(body("First", { color: "#00ff00", materialName: "Signal Red" }), painted({ faceMaterialNames: { [RED]: "Signal/Red" } })).code).toBe("MATERIAL_CONFLICT");
  });
});
