import { describe, expect, it } from "vitest";
import { exportGameGlb, GameExportError, readStl } from "../src/index.js";
import { asciiStl, binaryStl, chamferedBlock, MM_Z_UP } from "./fixtures.js";

const shape = chamferedBlock([1000, 500, 250], 20);

function refusal(data: Uint8Array): string {
  try {
    readStl(data);
  } catch (error) {
    expect(error).toBeInstanceOf(GameExportError);
    expect((error as GameExportError).code).toBe("BAD_STL");
    return (error as Error).message;
  }
  throw new Error("Expected the STL to be refused.");
}

describe("STL reader", () => {
  it("reads a binary file as triangle soup", () => {
    const mesh = readStl(binaryStl(shape.positions));
    expect(mesh.format).toBe("binary");
    expect(mesh.triangles).toBe(44);
    expect(mesh.name).toBeNull();
    expect(mesh.positions).toEqual(shape.positions);
  });

  it("reads an ASCII file as triangle soup", () => {
    const mesh = readStl(asciiStl(shape.positions, "Chamfered Block"));
    expect(mesh.format).toBe("ascii");
    expect(mesh.triangles).toBe(44);
    expect(mesh.name).toBe("Chamfered Block");
    expect(mesh.positions).toEqual(shape.positions);
  });

  it("reads ASCII with Windows line ends, capitals, tabs and exponents", () => {
    const text = "SOLID\r\nFACET NORMAL 0 0 1\r\n\tOUTER LOOP\r\n\t\tVERTEX 0 0 0\r\n\t\tVERTEX 1.5e1 0 0\r\n\t\tVERTEX 0 -2.5E-1 0\r\n\tENDLOOP\r\nENDFACET\r\nENDSOLID\r\n";
    const mesh = readStl(new TextEncoder().encode(text));
    expect(mesh.name).toBeNull();
    expect([...mesh.positions]).toEqual([0, 0, 0, 15, 0, 0, 0, -0.25, 0]);
  });

  it("reads a binary file whose header starts with the word solid", () => {
    const mesh = readStl(binaryStl(shape.positions, "solid exported by some CAD program"));
    expect(mesh.format).toBe("binary");
    expect(mesh.triangles).toBe(44);
  });

  it("reads from a view into a larger buffer", () => {
    const file = binaryStl(shape.positions);
    const padded = new Uint8Array(file.length + 7);
    padded.set(file, 7);
    expect(readStl(padded.subarray(7)).positions).toEqual(shape.positions);
  });

  it("gives the same export from binary and ASCII", () => {
    const run = (data: Uint8Array) => exportGameGlb({ bodies: [{ name: "block", positions: readStl(data).positions }], source: MM_Z_UP }).glb;
    expect(run(asciiStl(shape.positions))).toEqual(run(binaryStl(shape.positions)));
  });

  it("refuses a binary file that was cut short", () => {
    expect(refusal(binaryStl(shape.positions).subarray(0, 1000))).toContain("its header says 44 triangles, which does not match its 1000 bytes");
  });

  it("refuses data that is not STL", () => {
    expect(refusal(new TextEncoder().encode("hello"))).toContain("too short to be binary");
    expect(refusal(new Uint8Array(200).fill(7))).toContain("not an STL file");
  });

  it("refuses ASCII with a coordinate that is not a number", () => {
    const text = "solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 zero 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x\n";
    expect(refusal(new TextEncoder().encode(text))).toContain('vertex 2 has a coordinate that is not a number ("zero")');
  });

  it("refuses ASCII facets without exactly three vertices", () => {
    const text = "solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nendloop\nendfacet\nendsolid x\n";
    expect(refusal(new TextEncoder().encode(text))).toContain("found 1 facets but 2 vertices");
  });
});
