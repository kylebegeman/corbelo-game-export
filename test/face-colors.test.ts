// A body whose triangles have colours of their own: one node and one mesh, with a primitive and
// a material slot for each colour, and everything else about the body as it is in one colour.
import { describe, expect, it } from "vitest";
import {
  exportGameGlb,
  GameExportError,
  readAccessor,
  readGlb,
  readPack,
  type BodyInput,
  type ExportInput,
  type ExportOptions,
  type GameExportErrorCode,
  type PackBody,
} from "../src/index.js";
import { box, chamferedBlock, cylinder, fold, halfPaintedSide, MM_Z_UP, paintedTop } from "./fixtures.js";

const RED = "#c0392b";
const BLUE = "#2980ba";
const METRES = { unit: 1, up: "Y" } as const;
const cube = box([0, 0, 0], [100, 200, 300]);

function painted(extra: Partial<BodyInput> = {}, options: ExportOptions = {}) {
  return exportGameGlb({ bodies: [{ name: "Box", positions: cube.positions, color: BLUE, faceColors: paintedTop(RED), ...extra }], source: MM_Z_UP, ...options });
}

function refusal(input: unknown): { code: GameExportErrorCode; message: string } {
  try {
    exportGameGlb(input as ExportInput);
  } catch (error) {
    expect(error).toBeInstanceOf(GameExportError);
    const { code, message } = error as GameExportError;
    return { code, message };
  }
  throw new Error("Expected the export to be refused, but it went through.");
}

/** Every triangle as its three corners, position and normal, in a form that sorts and compares. */
function triangleList(body: PackBody, from = 0, count = body.indices.length / 3): string[] {
  const corner = (vertex: number) => [...body.positions.slice(vertex * 3, vertex * 3 + 3), ...body.normals.slice(vertex * 3, vertex * 3 + 3)].map((value) => value + 0).join(",");
  const list: string[] = [];
  for (let triangle = from; triangle < from + count; triangle += 1) {
    list.push([0, 1, 2].map((k) => corner(body.indices[triangle * 3 + k]!)).join(" | "));
  }
  return list.sort();
}

describe("a body with a colour per triangle", () => {
  it("is one node and one mesh, with a primitive and a material for each colour", () => {
    const { glb, facts } = painted();
    const { json } = readGlb(glb);
    expect(json.nodes).toEqual([{ name: "Box", mesh: 0 }]);
    expect(json.scenes![0]!.nodes).toEqual([0]);
    expect(json.meshes).toHaveLength(1);
    expect(json.meshes![0]!.name).toBe("Box");
    expect(json.materials!.map((material) => material.name)).toEqual(["color_2980ba", "color_c0392b"]);
    // Each primitive has index and vertex data of its own: four accessors, none shared.
    expect(json.meshes![0]!.primitives).toEqual([
      { attributes: { POSITION: 1, NORMAL: 2, TANGENT: 3 }, indices: 0, material: 0, mode: 4 },
      { attributes: { POSITION: 5, NORMAL: 6, TANGENT: 7 }, indices: 4, material: 1, mode: 4 },
    ]);
    expect(json.accessors!.map((accessor) => accessor.count)).toEqual([30, 20, 20, 20, 6, 4, 4, 4]);
    expect(facts.bodies[0]).toMatchObject({
      triangles: 12,
      vertices: 24,
      materialSlots: 2,
      materials: ["color_2980ba", "color_c0392b"],
      slots: [
        { material: "color_2980ba", triangles: 10, vertices: 20 },
        { material: "color_c0392b", triangles: 2, vertices: 4 },
      ],
      openEdges: 0,
      nonManifoldEdges: 0,
    });
    expect(facts.materials.map((material) => [material.name, material.color, material.bodies])).toEqual([
      ["color_2980ba", "#2980ba", 1],
      ["color_c0392b", "#c0392b", 1],
    ]);
    expect(facts.total).toMatchObject({ bodies: 1, triangles: 12, vertices: 24, materialSlots: 2 });
  });

  it("puts the right triangles in each colour", () => {
    const body = readPack(painted().glb).bodies[0]!;
    expect(body.surfaces.map((surface) => [surface.material!.name, surface.firstVertex, surface.vertices, surface.firstTriangle, surface.triangles])).toEqual([
      ["color_2980ba", 0, 20, 0, 10],
      ["color_c0392b", 20, 4, 10, 2],
    ]);
    expect(body.material).toEqual(body.surfaces[0]!.material);
    // The red part is the top: source z = 300 mm is 0.3 m up, and its normals point up.
    for (let vertex = 20; vertex < 24; vertex += 1) {
      expect(body.positions[vertex * 3 + 1]).toBeCloseTo(0.3, 6);
      expect([...body.normals.slice(vertex * 3, vertex * 3 + 3)]).toEqual([0, 1, 0]);
    }
    // No blue triangle lies wholly in the top.
    for (let triangle = 0; triangle < 10; triangle += 1) {
      const heights = [0, 1, 2].map((k) => body.positions[body.indices[triangle * 3 + k]! * 3 + 1]!);
      expect(Math.min(...heights)).toBeLessThan(0.1);
    }
  });

  it("gives each primitive the box of its own vertices, and the body the box of all of them", () => {
    const { glb, facts } = painted();
    const { json } = readGlb(glb);
    // 100 x 200 x 300 mm with Z up, as the 32-bit numbers stored: the blue part reaches from the
    // base to the top's rim, and the red part is the top alone.
    const [x, y, z] = [Math.fround(0.05), Math.fround(0.3), Math.fround(0.1)];
    expect(json.accessors![1]).toMatchObject({ min: [-x, 0, -z], max: [x, y, z] });
    expect(json.accessors![5]).toMatchObject({ min: [-x, y, -z], max: [x, y, z] });
    const plain = exportGameGlb({ bodies: [{ name: "Box", positions: cube.positions, color: BLUE }], source: MM_Z_UP }).facts;
    expect(facts.bodies[0]!.bounds).toEqual(plain.bodies[0]!.bounds);
    expect(facts.bodies[0]!.localBounds).toEqual(plain.bodies[0]!.localBounds);
    expect(facts.bodies[0]!.pivot).toEqual(plain.bodies[0]!.pivot);
    expect(facts.total.bounds).toEqual(plain.total.bounds);
  });

  it("orders the primitives by the first triangle of each colour", () => {
    // Red on one triangle of each of the first two faces, green on one triangle of the second.
    const faceColors = [RED, null, "#00ff00", RED, null, ...new Array<null>(7).fill(null)];
    const { facts } = painted({ faceColors });
    expect(facts.bodies[0]!.slots).toEqual([
      { material: "color_c0392b", triangles: 2, vertices: 6 },
      { material: "color_2980ba", triangles: 9, vertices: 3 + 4 * 4 },
      { material: "color_00ff00", triangles: 1, vertices: 3 },
    ]);
    expect(facts.materials.map((material) => material.name)).toEqual(["color_c0392b", "color_2980ba", "color_00ff00"]);
  });

  it("reads undefined, null and a gap in the list as the body's own colour", () => {
    const sparse = new Array<string | undefined>(12);
    sparse[10] = RED;
    sparse[11] = RED;
    const withUndefined = [...new Array<undefined>(10).fill(undefined), RED, RED];
    expect(painted({ faceColors: sparse }).glb).toEqual(painted().glb);
    expect(painted({ faceColors: withUndefined }).glb).toEqual(painted().glb);
  });

  it("gives the same bytes for the same input", () => {
    expect(painted().glb).toEqual(painted().glb);
  });
});

describe("a body whose face colours come to one colour", () => {
  const plain = exportGameGlb({ bodies: [{ name: "Box", positions: cube.positions, color: BLUE }], source: MM_Z_UP });

  it("is written exactly as a body without face colours", () => {
    expect(painted({ faceColors: new Array<null>(12).fill(null) }).glb).toEqual(plain.glb);
    // The body's own colour spelled three other ways is still the body's own colour.
    const spelled = ["#2980BA", "2980ba", [0x29 / 255, 0x80 / 255, 0xba / 255] as const, ...new Array<null>(9).fill(null)];
    expect(painted({ faceColors: spelled }).glb).toEqual(plain.glb);
    expect(plain.facts.bodies[0]).not.toHaveProperty("slots");
  });

  it("has only that colour's material when every triangle is painted over", () => {
    const { facts, glb } = painted({ faceColors: new Array<string>(12).fill(RED) });
    expect(facts.bodies[0]).toMatchObject({ materialSlots: 1, materials: ["color_c0392b"] });
    expect(facts.bodies[0]).not.toHaveProperty("slots");
    // The body's own blue is on no triangle, so it is not in the file.
    expect(facts.materials.map((material) => material.color)).toEqual(["#c0392b"]);
    expect(readGlb(glb).json.materials).toHaveLength(1);
    expect(glb).toEqual(exportGameGlb({ bodies: [{ name: "Box", positions: cube.positions, color: RED }], source: MM_Z_UP }).glb);
  });
});

describe("materials of bodies with face colours", () => {
  it("names the body's own colour by materialName and every other colour after itself", () => {
    const faceColors = [RED, BLUE, ...new Array<null>(10).fill(null)];
    const { facts } = painted({ materialName: "Body Paint", faceColors });
    // The second triangle is the body's own blue, so it is in the body's own material.
    expect(facts.bodies[0]!.slots).toEqual([
      { material: "color_c0392b", triangles: 1, vertices: 3 },
      { material: "Body_Paint", triangles: 11, vertices: 23 },
    ]);
    expect(facts.materials.map((material) => [material.name, material.color])).toEqual([
      ["color_c0392b", "#c0392b"],
      ["Body_Paint", "#2980ba"],
    ]);
  });

  it("shares one material between every body and face of the same colour", () => {
    const { glb, facts } = exportGameGlb({
      bodies: [
        { name: "a", positions: cube.positions, color: BLUE, faceColors: paintedTop(RED) },
        { name: "b", positions: cube.positions, color: RED },
        { name: "c", positions: cube.positions, color: "#00ff00", faceColors: paintedTop(BLUE) },
      ],
      source: MM_Z_UP,
    });
    expect(facts.materials.map((material) => [material.name, material.bodies])).toEqual([
      ["color_2980ba", 2],
      ["color_c0392b", 2],
      ["color_00ff00", 1],
    ]);
    expect(facts.total.materialSlots).toBe(3);
    expect(facts.bodies.map((body) => body.materials)).toEqual([["color_2980ba", "color_c0392b"], ["color_c0392b"], ["color_00ff00", "color_2980ba"]]);
    const { json } = readGlb(glb);
    expect(json.materials).toHaveLength(3);
    expect(json.meshes!.map((mesh) => mesh.primitives.map((primitive) => primitive.material))).toEqual([[0, 1], [1], [2, 0]]);
    expect(facts.bodies.map((body) => [body.node, body.mesh])).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  it("rounds face colours to eight bits and reads [r, g, b] in the colour space asked for", () => {
    const grey = [0.215861, 0.215861, 0.215861] as const;
    const faceColors = [grey, "#808080", "#888", ...new Array<null>(9).fill(null)];
    const { facts } = painted({ faceColors }, { colorSpace: "linear" });
    expect(facts.materials.map((material) => material.color)).toEqual(["#808080", "#888888", "#2980ba"]);
    expect(facts.bodies[0]!.slots!.map((slot) => slot.triangles)).toEqual([2, 1, 9]);
  });
});

describe("normals, welding and dropped triangles with face colours", () => {
  it("shades a soft edge between two colours smoothly: both sides get the same normal", () => {
    // Two triangles 20 degrees apart, which is soft at the default 30 degree crease.
    const shape = fold(20);
    const run = (faceColors?: (string | null)[]) => exportGameGlb({ bodies: [{ name: "fold", positions: shape.positions, color: BLUE, ...(faceColors ? { faceColors } : {}) }], source: METRES, pivot: "origin" });
    const one = readPack(run().glb).bodies[0]!;
    const two = readPack(run([RED, null]).glb).bodies[0]!;
    expect(one.positions.length / 3).toBe(4);
    // The two corners on the shared edge are written once for each colour.
    expect(two.positions.length / 3).toBe(6);
    expect(two.surfaces.map((surface) => surface.vertices)).toEqual([3, 3]);
    expect(triangleList(two)).toEqual(triangleList(one));
    // On the shared edge (y = 0 and z = 0 at both ends) the normal is the blend of the two
    // triangles, and it is the very same numbers in the red part and in the blue part.
    const onEdge = (body: PackBody, surface: number) => {
      const { firstVertex, vertices } = body.surfaces[surface]!;
      const found: string[] = [];
      for (let vertex = firstVertex; vertex < firstVertex + vertices; vertex += 1) {
        if (body.positions[vertex * 3 + 1] === 0 && body.positions[vertex * 3 + 2] === 0) found.push([...body.positions.slice(vertex * 3, vertex * 3 + 3), ...body.normals.slice(vertex * 3, vertex * 3 + 3)].join(","));
      }
      return found.sort();
    };
    expect(onEdge(two, 0)).toHaveLength(2);
    expect(onEdge(two, 0)).toEqual(onEdge(two, 1));
    const blended = two.normals.slice(0, 3);
    expect(blended[1]).not.toBe(0);
    expect(blended[2]).not.toBe(0);
  });

  it("keeps a hard edge between two colours hard", () => {
    const shape = fold(40);
    const { glb } = exportGameGlb({ bodies: [{ name: "fold", positions: shape.positions, faceColors: [RED, null] }], source: METRES, pivot: "origin" });
    const body = readPack(glb).bodies[0]!;
    expect(body.positions.length / 3).toBe(6);
    // Each part is flat: all three of its normals are its own triangle's.
    for (const surface of body.surfaces) {
      const normals = new Set<string>();
      for (let vertex = surface.firstVertex; vertex < surface.firstVertex + surface.vertices; vertex += 1) normals.add(body.normals.slice(vertex * 3, vertex * 3 + 3).join(","));
      expect(normals.size).toBe(1);
    }
  });

  it("leaves every triangle's corners and normals as they are in one colour, whatever the settings", () => {
    const block = chamferedBlock([1000, 500, 250], 20);
    const round = cylinder(150, 400, 24);
    const stripes = (count: number) => Array.from({ length: count }, (_, triangle) => [RED, null, "#00ff00"][triangle % 3]!);
    const cases: ExportInput[] = [
      { bodies: [{ name: "block", positions: block.positions }], source: MM_Z_UP },
      { bodies: [{ name: "block", positions: block.positions, faceIds: block.faceIds }], source: MM_Z_UP, normals: "face-weighted", creaseAngle: 40 },
      { bodies: [{ name: "round", positions: round.positions }], source: MM_Z_UP, normals: "face-weighted" },
      { bodies: [{ name: "round", positions: round.positions, faceIds: round.faceIds }], source: { unit: 0.0254, up: "Y", handedness: "left" }, pivot: "center", creaseAngle: 5 },
    ];
    for (const input of cases) {
      const body = input.bodies[0]!;
      const plain = exportGameGlb(input);
      const striped = exportGameGlb({ ...input, bodies: [{ ...body, faceColors: stripes(body.positions.length / 9) }] });
      expect(triangleList(readPack(striped.glb).bodies[0]!)).toEqual(triangleList(readPack(plain.glb).bodies[0]!));
      expect(striped.facts.bodies[0]).toMatchObject({
        triangles: plain.facts.bodies[0]!.triangles,
        openEdges: 0,
        nonManifoldEdges: 0,
        degenerateTrianglesDropped: 0,
        materialSlots: 3,
        bounds: plain.facts.bodies[0]!.bounds,
      });
      expect(striped.facts.bodies[0]!.vertices).toBeGreaterThanOrEqual(plain.facts.bodies[0]!.vertices);
    }
  });

  it("keeps a coarse cylinder's side smooth across the line where two colours meet", () => {
    // Eight segments: side triangles are 45 degrees apart, and only the face ids keep them soft.
    const shape = cylinder(1, 2, 8);
    const base = { name: "post", positions: shape.positions, faceIds: shape.faceIds, color: BLUE };
    const plain = exportGameGlb({ bodies: [base], source: { unit: 1, up: "Z" } });
    const { glb, facts } = exportGameGlb({ bodies: [{ ...base, faceColors: halfPaintedSide(8, RED) }], source: { unit: 1, up: "Z" } });
    expect(plain.facts.bodies[0]!.vertices).toBe(2 * 8 + 2 * 9);
    // The two colours meet along two lines down the side: two corners each, written once more.
    expect(facts.bodies[0]).toMatchObject({ triangles: 32, vertices: 2 * 8 + 2 * 9 + 4, openEdges: 0 });
    expect(facts.bodies[0]!.slots).toEqual([
      { material: "color_c0392b", triangles: 8, vertices: 10 },
      { material: "color_2980ba", triangles: 24, vertices: 2 * 9 + 2 * 5 },
    ]);
    const body = readPack(glb).bodies[0]!;
    // Every vertex of the red part is on the side, and its normal points straight out from the axis.
    for (let vertex = 0; vertex < 10; vertex += 1) {
      const [x, , z] = body.positions.slice(vertex * 3, vertex * 3 + 3);
      const [nx, ny, nz] = body.normals.slice(vertex * 3, vertex * 3 + 3);
      expect(ny).toBeCloseTo(0, 6);
      expect(nx! * x! + nz! * z!).toBeCloseTo(1, 5);
    }
    expect(triangleList(body)).toEqual(triangleList(readPack(plain.glb).bodies[0]!));
  });

  it("keeps colours and face ids lined up with their triangles when some are dropped", () => {
    const shape = cylinder(1, 2, 8);
    const noArea = [0, 0, 0, 0, 0, 0, 1, 1, 1];
    const onOneLine = [0, 0, 0, 1, 0, 0, 2, 0, 0];
    // A triangle without area at the front, one after the first segment and one at the end, each
    // in a colour no other triangle has.
    const positions = [...noArea, ...shape.positions.slice(0, 36), ...onOneLine, ...shape.positions.slice(36), ...noArea];
    const colors = halfPaintedSide(8, RED);
    const faceColors = ["#111111", ...colors.slice(0, 4), "#222222", ...colors.slice(4), "#333333"];
    const ids = Array.from(shape.faceIds);
    const faceIds = [99, ...ids.slice(0, 4), 98, ...ids.slice(4), 97];
    const dirty = exportGameGlb({ bodies: [{ name: "post", positions, faceIds, faceColors, color: BLUE }], source: { unit: 1, up: "Z" } });
    const clean = exportGameGlb({ bodies: [{ name: "post", positions: shape.positions, faceIds: shape.faceIds, faceColors: colors, color: BLUE }], source: { unit: 1, up: "Z" } });
    expect(dirty.facts.bodies[0]).toMatchObject({ triangles: 32, degenerateTrianglesDropped: 3, openEdges: 0 });
    expect(dirty.facts.bodies[0]!.slots).toEqual(clean.facts.bodies[0]!.slots);
    // The colours of the dropped triangles are on nothing that was written, so they are not materials.
    expect(dirty.facts.materials.map((material) => material.color)).toEqual(["#c0392b", "#2980ba"]);
    expect(readGlb(dirty.glb).json.materials).toHaveLength(2);
    const [dirtyBody, cleanBody] = [readPack(dirty.glb).bodies[0]!, readPack(clean.glb).bodies[0]!];
    dirtyBody.surfaces.forEach((surface, index) => {
      expect(triangleList(dirtyBody, surface.firstTriangle, surface.triangles)).toEqual(triangleList(cleanBody, cleanBody.surfaces[index]!.firstTriangle, surface.triangles));
    });
  });

  it("welds across colours: a body of separate coloured triangles is still closed", () => {
    const faceColors = Array.from({ length: 12 }, (_, triangle) => `#0000${(triangle + 1).toString(16).padStart(2, "0")}`);
    const { facts } = painted({ faceColors }, { creaseAngle: 180 });
    expect(facts.bodies[0]).toMatchObject({ triangles: 12, vertices: 36, materialSlots: 12, openEdges: 0, nonManifoldEdges: 0 });
    expect(facts.total.materialSlots).toBe(12);
  });

  it("writes a unit tangent at a right angle to the normal for every vertex of every primitive", () => {
    const round = cylinder(150, 400, 24);
    const document = readGlb(exportGameGlb({ bodies: [{ name: "round", positions: round.positions, faceColors: halfPaintedSide(24, RED) }], source: MM_Z_UP }).glb);
    const primitives = document.json.meshes![0]!.primitives;
    expect(primitives).toHaveLength(2);
    for (const primitive of primitives) {
      const normals = readAccessor(document, primitive.attributes["NORMAL"]!);
      const tangents = readAccessor(document, primitive.attributes["TANGENT"]!);
      expect(tangents.length / 4).toBe(normals.length / 3);
      for (let vertex = 0; vertex < normals.length / 3; vertex += 1) {
        const [nx, ny, nz] = normals.slice(vertex * 3, vertex * 3 + 3);
        const [tx, ty, tz, tw] = tangents.slice(vertex * 4, vertex * 4 + 4);
        expect(Math.hypot(tx!, ty!, tz!)).toBeCloseTo(1, 6);
        expect(nx! * tx! + ny! * ty! + nz! * tz!).toBeCloseTo(0, 6);
        expect(tw).toBe(1);
      }
    }
  });

  it("chooses 16-bit or 32-bit indices for each primitive by its own vertices", () => {
    // 22000 separate triangles: all but the last in the body's colour make 65997 vertices.
    const positions = new Float32Array(22000 * 9);
    for (let t = 0; t < 22000; t += 1) positions.set([t * 2, 0, 0, t * 2 + 1, 0, 0, t * 2, 1, 0], t * 9);
    const faceColors = new Array<string | null>(22000).fill(null);
    faceColors[21999] = RED;
    const { glb, facts } = exportGameGlb({ bodies: [{ name: "many", positions, faceColors }], source: METRES, pivot: "origin" });
    const { json } = readGlb(glb);
    expect(json.accessors![0]).toMatchObject({ componentType: 5125, count: 65997 });
    expect(json.accessors![4]).toMatchObject({ componentType: 5123, count: 3 });
    expect(facts.bodies[0]!.slots).toEqual([
      { material: "color_cccccc", triangles: 21999, vertices: 65997 },
      { material: "color_c0392b", triangles: 1, vertices: 3 },
    ]);
    const body = readPack(glb).bodies[0]!;
    expect([...body.indices.slice(-3)]).toEqual([65997, 65998, 65999]);
    expect([...body.positions.slice(-9)]).toEqual([43998, 0, 0, 43999, 0, 0, 43998, 1, 0]);
  });

  it("counts every triangle against the limit, whatever its colour", () => {
    expect(refusal({ bodies: [{ name: "Box", positions: cube.positions, faceColors: paintedTop(RED) }], source: MM_Z_UP, maxTriangles: 11 }).code).toBe("TOO_MANY_TRIANGLES");
    expect(() => painted({}, { maxTriangles: 12 })).not.toThrow();
  });
});

describe("face colours that are refused", () => {
  const withColors = (faceColors: unknown, extra: Record<string, unknown> = {}) => refusal({ bodies: [{ name: "part", positions: cube.positions, faceColors, ...extra }], source: MM_Z_UP });

  it("refuses a list that is not one entry per triangle", () => {
    expect(withColors([RED, RED, RED])).toEqual({ code: "BAD_FACE_COLORS", message: 'Body "part": faceColors holds 3 entries for 12 triangles. It needs exactly one per triangle.' });
    expect(withColors(new Array(13).fill(null)).code).toBe("BAD_FACE_COLORS");
    expect(withColors([]).code).toBe("BAD_FACE_COLORS");
  });

  it("refuses anything that is not a list", () => {
    expect(withColors(RED)).toEqual({ code: "BAD_FACE_COLORS", message: 'Body "part": faceColors must be an array with one colour, or null, per triangle.' });
    expect(withColors(new Uint32Array(12)).code).toBe("BAD_FACE_COLORS");
    expect(withColors({ length: 12 }).code).toBe("BAD_FACE_COLORS");
  });

  it("refuses an entry that is not a colour, naming the triangle", () => {
    const list = (bad: unknown) => [null, null, null, bad, ...new Array<null>(8).fill(null)];
    expect(withColors(list("red"))).toEqual({ code: "BAD_COLOR", message: 'Body "part", triangle 3: colour "red" is not "#rrggbb" or "#rgb". Transparency is not supported.' });
    expect(withColors(list("#ff000080")).code).toBe("BAD_COLOR");
    expect(withColors(list([255, 0, 0]))).toEqual({ code: "BAD_COLOR", message: 'Body "part", triangle 3: colour must be a hex string or [r, g, b] with each channel from 0 to 1.' });
    expect(withColors(list(7)).code).toBe("BAD_COLOR");
    expect(withColors(list({ r: 1 })).code).toBe("BAD_COLOR");
    expect(withColors(list(false)).code).toBe("BAD_COLOR");
  });

  it("refuses a face colour whose material name another body uses for a different colour", () => {
    const { code, message } = refusal({
      bodies: [
        { name: "a", positions: cube.positions, color: "#00ff00", materialName: "color_c0392b" },
        { name: "b", positions: cube.positions, faceColors: paintedTop(RED) },
      ],
      source: MM_Z_UP,
    });
    expect(code).toBe("MATERIAL_CONFLICT");
    expect(message).toBe('Material "color_c0392b" is used with two colours, #00ff00 and #c0392b (body "b"). Give each colour its own material name.');
  });

  it("checks the face colours of every body before it exports any", () => {
    const { code, message } = refusal({
      bodies: [
        { name: "ok", positions: cube.positions },
        { name: "bad", positions: cube.positions, faceColors: [null] },
      ],
      source: MM_Z_UP,
    });
    expect(code).toBe("BAD_FACE_COLORS");
    expect(message).toContain('Body "bad"');
  });
});
