import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_TRIANGLES, exportGameGlb, GameExportError, type ExportInput, type GameExportErrorCode } from "../src/index.js";
import { box } from "./fixtures.js";

const good = box([0, 0, 0], [1, 1, 1]).positions;
const source = { unit: 1, up: "Y" } as const;

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

function withBody(body: Record<string, unknown>, options: Record<string, unknown> = {}) {
  return refusal({ bodies: [{ name: "part", positions: good, ...body }], source, ...options });
}

describe("refused input", () => {
  it("refuses an export with no bodies", () => {
    expect(refusal({ bodies: [], source }).code).toBe("NO_BODIES");
    expect(refusal({ source }).code).toBe("NO_BODIES");
  });

  it("refuses an empty body", () => {
    expect(withBody({ positions: new Float32Array(0) })).toEqual({ code: "EMPTY_BODY", message: 'Body "part" has no vertices.' });
    expect(withBody({ indices: [] })).toEqual({ code: "EMPTY_BODY", message: 'Body "part" has no triangles.' });
  });

  it("refuses a body whose triangles all have no area", () => {
    const flat = withBody({ positions: [0, 0, 0, 1, 0, 0, 2, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5] });
    expect(flat.code).toBe("ALL_DEGENERATE");
    expect(flat.message).toContain("all 2 triangles have no area");
  });

  it("refuses positions that are not finite numbers, naming the vertex", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const positions = Float32Array.from(good);
      positions[16] = bad;
      const { code, message } = withBody({ positions });
      expect(code).toBe("NON_FINITE_POSITION");
      expect(message).toContain("vertex 5");
    }
    expect(withBody({ positions: [0, 0, 0, 1, 0, 0, 0, "1", 0] }).code).toBe("NON_FINITE_POSITION");
  });

  it("refuses positions that are not whole vertices or whole triangles", () => {
    expect(withBody({ positions: good.slice(0, 10) }).code).toBe("BAD_POSITIONS");
    expect(withBody({ positions: good.slice(0, 12) })).toEqual({
      code: "BAD_POSITIONS",
      message: 'Body "part": without indices every three vertices make a triangle, but there are 4 vertices.',
    });
    expect(withBody({ positions: "0 0 0" }).code).toBe("BAD_POSITIONS");
  });

  it("refuses an index that points past the vertices", () => {
    const { code, message } = withBody({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 3] });
    expect(code).toBe("INDEX_OUT_OF_RANGE");
    expect(message).toBe('Body "part": index 2 points at vertex 3, but the body has 3 vertices.');
    expect(withBody({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, -1] }).code).toBe("INDEX_OUT_OF_RANGE");
  });

  it("refuses indices that are not whole triangles of whole numbers", () => {
    expect(withBody({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1] }).code).toBe("BAD_INDICES");
    expect(withBody({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 1.5] }).code).toBe("BAD_INDICES");
    expect(withBody({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, NaN] }).code).toBe("BAD_INDICES");
  });

  it("refuses more triangles than the limit, before doing any work", () => {
    expect(DEFAULT_MAX_TRIANGLES).toBe(2_000_000);
    const { code, message } = withBody({}, { maxTriangles: 11 });
    expect(code).toBe("TOO_MANY_TRIANGLES");
    expect(message).toContain("more than 11 triangles");
    // The limit is for the whole export, not for each body.
    expect(refusal({ bodies: [{ name: "a", positions: good }, { name: "b", positions: good }], source, maxTriangles: 23 }).code).toBe("TOO_MANY_TRIANGLES");
    expect(() => exportGameGlb({ bodies: [{ name: "a", positions: good }, { name: "b", positions: good }], source, maxTriangles: 24 })).not.toThrow();
  });

  it("refuses the default limit being passed", () => {
    // Three vertices shared by every triangle keep this cheap to build.
    const indices = new Uint8Array((DEFAULT_MAX_TRIANGLES + 1) * 3);
    expect(withBody({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices }).code).toBe("TOO_MANY_TRIANGLES");
  });

  it("refuses face ids that do not match the triangles", () => {
    expect(withBody({ faceIds: [0, 1, 2] })).toEqual({ code: "BAD_FACE_IDS", message: 'Body "part": faceIds holds 3 ids for 12 triangles. It needs exactly one per triangle.' });
    expect(withBody({ faceIds: new Array(12).fill(0.5) }).code).toBe("BAD_FACE_IDS");
  });

  it("refuses a body without a name", () => {
    expect(refusal({ bodies: [{ positions: good }], source }).code).toBe("BAD_NAME");
    expect(withBody({ name: "  " }).code).toBe("BAD_NAME");
    expect(withBody({ materialName: "" }).code).toBe("BAD_NAME");
  });

  it("refuses colours it cannot read", () => {
    expect(withBody({ color: "red" }).code).toBe("BAD_COLOR");
    expect(withBody({ color: "#ff000080" }).code).toBe("BAD_COLOR");
    expect(withBody({ color: [1, 0] }).code).toBe("BAD_COLOR");
    expect(withBody({ color: [255, 0, 0] }).code).toBe("BAD_COLOR");
    expect(withBody({ color: [0.5, NaN, 0] }).code).toBe("BAD_COLOR");
  });

  it("refuses a source space it cannot read", () => {
    expect(refusal({ bodies: [{ name: "part", positions: good }] }).code).toBe("BAD_SOURCE_SPACE");
    for (const bad of [{ unit: 0, up: "Y" }, { unit: -1, up: "Y" }, { unit: NaN, up: "Z" }, { unit: 1, up: "X" }, { unit: 1 }, { unit: 1, up: "Y", handedness: "both" }]) {
      expect(refusal({ bodies: [{ name: "part", positions: good }], source: bad }).code).toBe("BAD_SOURCE_SPACE");
    }
  });

  it("refuses options outside their range", () => {
    const options: Record<string, unknown>[] = [
      { creaseAngle: -1 },
      { creaseAngle: 181 },
      { creaseAngle: NaN },
      { weldTolerance: -1 },
      { maxTriangles: 0 },
      { maxTriangles: 1.5 },
      { normals: "smooth" },
      { placement: "world" },
      { colorSpace: "p3" },
      { pivot: "top" },
      { pivot: [0, 0] },
      { pivot: [0, 0, NaN] },
      { profile: "godot3" },
      { profile: { id: "x", name: "X", unit: "m", unitMeters: 0, up: "Y", conventions: { collision: [], lod: [] } } },
    ];
    for (const option of options) expect([JSON.stringify(option), withBody({}, option).code]).toEqual([JSON.stringify(option), "BAD_OPTION"]);
  });

  it("refuses provenance that is not plain JSON", () => {
    expect(withBody({}, { provenance: { when: new Date(0) } }).code).toBe("BAD_PROVENANCE");
    expect(withBody({}, { provenance: { ratio: NaN } })).toEqual({ code: "BAD_PROVENANCE", message: "provenance.ratio is not a finite number, so it cannot be stored as JSON." });
    expect(withBody({}, { provenance: [() => 1] }).code).toBe("BAD_PROVENANCE");
    const loop: Record<string, unknown> = {};
    loop["self"] = loop;
    expect(withBody({}, { provenance: loop }).code).toBe("BAD_PROVENANCE");
  });

  it("checks every body before it exports any", () => {
    expect(() => exportGameGlb({ bodies: [{ name: "ok", positions: good }, { name: "bad", positions: [NaN, 0, 0, 1, 0, 0, 0, 1, 0] }], source })).toThrowError(/Body "bad": vertex 0/);
  });
});
