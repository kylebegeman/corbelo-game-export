import { validateBytes } from "gltf-validator";
import { describe, expect, it } from "vitest";
import { BinaryBuilder, encodeGlb } from "../src/glb-write.js";
import { exportGameGlb, GameExportError, readAccessor, readGlb, readPack } from "../src/index.js";
import { box, chamferedBlock, cylinder, MM_Z_UP } from "./fixtures.js";

const block = chamferedBlock([1000, 500, 250], 20);

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GameExportError);
    expect((error as GameExportError).code).toBe("BAD_GLB");
    return (error as Error).message;
  }
  throw new Error("Expected the GLB to be refused.");
}

describe("GLB file", () => {
  it("has a well-formed header and padded chunks", () => {
    const { glb } = exportGameGlb({ bodies: [{ name: "block", positions: block.positions }], source: MM_Z_UP });
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(new TextDecoder().decode(glb.subarray(0, 4))).toBe("glTF");
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(glb.length);
    expect(glb.length % 4).toBe(0);
    expect(view.getUint32(12, true) % 4).toBe(0);
  });

  it("describes indexed triangles with positions, normals and tangents", () => {
    const { glb } = exportGameGlb({ bodies: [{ name: "block", positions: block.positions }], source: MM_Z_UP });
    const { json } = readGlb(glb);
    expect(json.scene).toBe(0);
    expect(json.scenes![0]!.nodes).toEqual([0]);
    const primitive = json.meshes![0]!.primitives[0]!;
    expect(primitive.mode).toBe(4);
    expect(Object.keys(primitive.attributes).sort()).toEqual(["NORMAL", "POSITION", "TANGENT"]);
    const [indices, positions, normals] = [json.accessors![primitive.indices!]!, json.accessors![primitive.attributes["POSITION"]!]!, json.accessors![primitive.attributes["NORMAL"]!]!];
    expect(indices).toMatchObject({ componentType: 5123, type: "SCALAR", count: 44 * 3 });
    expect(positions).toMatchObject({ componentType: 5126, type: "VEC3", count: 96, min: [-0.5, 0, -0.25], max: [0.5, 0.25, 0.25] });
    expect(normals).toMatchObject({ componentType: 5126, type: "VEC3", count: 96 });
    expect(json.accessors![primitive.attributes["TANGENT"]!]).toMatchObject({ componentType: 5126, type: "VEC4", count: 96 });
    expect(json.bufferViews!.map((view) => view.target)).toEqual([34963, 34962, 34962, 34962]);
    expect(json.bufferViews!.every((view) => view.byteOffset! % 4 === 0)).toBe(true);
  });

  it("passes the Khronos glTF validator with no errors or warnings", async () => {
    const files = [
      exportGameGlb({ bodies: [{ name: "block", positions: block.positions, faceIds: block.faceIds, color: "#d98a3d" }], source: MM_Z_UP }),
      exportGameGlb({ bodies: [{ name: "cylinder", positions: cylinder(150, 400, 48).positions }], source: MM_Z_UP, normals: "face-weighted", provenance: { id: 1 } }),
      exportGameGlb({
        bodies: [
          { name: "red", positions: box([0, 0, 0], [100, 100, 100]).positions, color: "#ff0000" },
          { name: "blue", positions: box([300, 0, 0], [400, 50, 20]).positions, color: "#0000ff" },
        ],
        source: MM_Z_UP,
        placement: "designed",
        profile: "unreal5",
      }),
      exportGameGlb({ bodies: [{ name: "mirror", positions: block.positions }], source: { unit: 0.01, up: "Z", handedness: "left" }, pivot: "min-corner" }),
    ];
    for (const { glb } of files) {
      const report = await validateBytes(glb);
      // The one thing the validator has to say is a note that the tangents are not needed by
      // any texture. They are there for the engine: see `tangentFor`.
      expect([...new Set(report.issues.messages.map((message: { code: string }) => message.code))]).toEqual(["UNUSED_MESH_TANGENT"]);
      expect(report.issues).toMatchObject({ numErrors: 0, numWarnings: 0, numHints: 0 });
    }
  });

  it("uses 32-bit indices once a body has more than 65535 vertices", () => {
    // 22000 separate triangles make 66000 vertices.
    const positions = new Float32Array(22000 * 9);
    for (let t = 0; t < 22000; t += 1) positions.set([t * 2, 0, 0, t * 2 + 1, 0, 0, t * 2, 1, 0], t * 9);
    const { glb, facts } = exportGameGlb({ bodies: [{ name: "many", positions }], source: { unit: 1, up: "Y" }, pivot: "origin" });
    const { json } = readGlb(glb);
    expect(facts.total.vertices).toBe(66000);
    expect(json.accessors![0]).toMatchObject({ componentType: 5125, count: 66000 });
    const body = readPack(glb).bodies[0]!;
    expect(body.indices[65999]).toBe(65999);
    expect([...body.positions.slice(-9)]).toEqual([43998, 0, 0, 43999, 0, 0, 43998, 1, 0]);
  });
});

describe("GLB reader", () => {
  it("reads back exactly what was written", () => {
    const shape = box([0, 0, 0], [1, 2, 3]);
    const indices = Uint32Array.from({ length: 36 }, (_, i) => i);
    const { glb } = exportGameGlb({ bodies: [{ name: "Box", positions: shape.positions, indices, color: "#336699" }], source: { unit: 1, up: "Y" }, pivot: "origin", creaseAngle: 180 });
    const pack = readPack(glb);
    expect(pack.bodies).toHaveLength(1);
    const body = pack.bodies[0]!;
    expect(body.name).toBe("Box");
    expect(body.translation).toEqual([0, 0, 0]);
    expect(body.material).toMatchObject({ name: "color_336699", metallicFactor: 0, roughnessFactor: 0.8 });
    // With every edge soft the eight corners come back in the order the soup first used them.
    const corners = new Set<string>();
    for (let at = 0; at < body.positions.length; at += 3) corners.add(body.positions.slice(at, at + 3).join(","));
    expect(corners.size).toBe(8);
    for (let corner = 0; corner < 36; corner += 1) {
      const vertex = body.indices[corner]!;
      expect([...body.positions.slice(vertex * 3, vertex * 3 + 3)]).toEqual([...shape.positions.slice(corner * 3, corner * 3 + 3)]);
    }
  });

  it("reads each accessor in its own component type", () => {
    const { glb } = exportGameGlb({ bodies: [{ name: "block", positions: block.positions }], source: MM_Z_UP });
    const document = readGlb(glb);
    expect(readAccessor(document, 0)).toBeInstanceOf(Uint16Array);
    expect(readAccessor(document, 1)).toBeInstanceOf(Float32Array);
    expect(readAccessor(document, 1)).toHaveLength(96 * 3);
    expect(readAccessor(document, 2)).toHaveLength(96 * 3);
  });

  it("reads a GLB held in the middle of a larger buffer", () => {
    const { glb } = exportGameGlb({ bodies: [{ name: "block", positions: block.positions }], source: MM_Z_UP });
    const padded = new Uint8Array(glb.length + 5);
    padded.set(glb, 5);
    expect(readPack(padded.subarray(5)).bodies[0]!.positions).toEqual(readPack(glb).bodies[0]!.positions);
  });

  it("reads interleaved buffer views and accessor offsets", () => {
    // Two vertices, each a position followed by a normal, 24 bytes per vertex.
    const binary = new BinaryBuilder();
    binary.add(Float32Array.from([1, 2, 3, 0, 0, 1, 4, 5, 6, 0, 1, 0]), 34962);
    const glb = encodeGlb(
      {
        asset: { version: "2.0" },
        bufferViews: [{ ...binary.views[0]!, byteStride: 24 }],
        accessors: [
          { bufferView: 0, componentType: 5126, count: 2, type: "VEC3" },
          { bufferView: 0, byteOffset: 12, componentType: 5126, count: 2, type: "VEC3" },
        ],
        buffers: [{ byteLength: 48 }],
      },
      binary.finish(),
    );
    const document = readGlb(glb);
    expect([...readAccessor(document, 0)]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...readAccessor(document, 1)]).toEqual([0, 0, 1, 0, 1, 0]);
  });

  it("returns nothing but the document for a GLB from somewhere else", () => {
    const glb = encodeGlb({ asset: { version: "2.0", generator: "other" }, scenes: [{ nodes: [] }] }, new Uint8Array(0));
    expect(readPack(glb)).toEqual({ generator: "other", profile: null, facts: null, provenance: null, bodies: [] });
  });

  it("refuses data that is not a GLB", () => {
    const { glb } = exportGameGlb({ bodies: [{ name: "block", positions: block.positions }], source: MM_Z_UP });
    expect(refusal(() => readGlb(new Uint8Array(40)))).toContain('first four bytes are not "glTF"');
    expect(refusal(() => readGlb(glb.subarray(0, glb.length - 8)))).toContain(`header says ${glb.length} bytes but only ${glb.length - 8} were given`);
    const wrongVersion = Uint8Array.from(glb);
    wrongVersion[4] = 1;
    expect(refusal(() => readGlb(wrongVersion))).toContain("version 1");
    const brokenJson = Uint8Array.from(glb);
    brokenJson[20] = 0x5b;
    expect(refusal(() => readGlb(brokenJson))).toContain("JSON chunk cannot be read");
  });

  it("refuses accessors it cannot read", () => {
    const { glb } = exportGameGlb({ bodies: [{ name: "block", positions: block.positions }], source: MM_Z_UP });
    const document = readGlb(glb);
    expect(refusal(() => readAccessor(document, 99))).toBe("Accessor 99 does not exist.");
    document.json.accessors![1]!.count = 100000;
    expect(refusal(() => readAccessor(document, 1))).toBe("Accessor 1 reads past the end of its buffer view.");
    document.json.accessors![2]!.sparse = {};
    expect(refusal(() => readAccessor(document, 2))).toContain("sparse");
  });
});
