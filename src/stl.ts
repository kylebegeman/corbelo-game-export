import { refuse } from "./errors.js";

export interface StlMesh {
  /** Triangle soup: nine numbers per triangle, in the file's own units and axes. */
  positions: Float32Array;
  triangles: number;
  format: "binary" | "ascii";
  /** The name after `solid` in an ASCII file. Null for binary files and unnamed solids. */
  name: string | null;
}

const BINARY_HEADER_BYTES = 84;
const BINARY_TRIANGLE_BYTES = 50;

/**
 * Reads a binary or ASCII STL file. The normals stored in the file are ignored; the exporter
 * computes its own. A file is binary when its length matches its triangle count exactly,
 * whatever its first bytes say, and ASCII when it starts with `solid`.
 */
export function readStl(data: Uint8Array): StlMesh {
  if (!(data instanceof Uint8Array)) refuse("BAD_STL", "An STL file must be given as a Uint8Array.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length >= BINARY_HEADER_BYTES) {
    const triangles = view.getUint32(80, true);
    if (data.length === BINARY_HEADER_BYTES + triangles * BINARY_TRIANGLE_BYTES) {
      const positions = new Float32Array(triangles * 9);
      for (let t = 0; t < triangles; t += 1) {
        // Each record is a normal (skipped), three vertices and two attribute bytes.
        const at = BINARY_HEADER_BYTES + t * BINARY_TRIANGLE_BYTES + 12;
        for (let k = 0; k < 9; k += 1) positions[t * 9 + k] = view.getFloat32(at + k * 4, true);
      }
      return { positions, triangles, format: "binary", name: null };
    }
  }

  const text = new TextDecoder("utf-8").decode(data);
  const header = /^\s*solid\b[ \t]*([^\r\n]*)/i.exec(text);
  if (header === null) {
    refuse(
      "BAD_STL",
      data.length >= BINARY_HEADER_BYTES
        ? `This is not an STL file: it does not start with "solid", and as a binary STL its header says ${view.getUint32(80, true)} triangles, which does not match its ${data.length} bytes.`
        : "This is not an STL file: it is too short to be binary and does not start with \"solid\".",
    );
  }
  const values: number[] = [];
  const tokens = text.split(/\s+/);
  let facets = 0;
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at]!.toLowerCase();
    if (token === "facet") facets += 1;
    if (token !== "vertex") continue;
    for (let k = 1; k <= 3; k += 1) {
      const word = tokens[at + k];
      const value = word === undefined || word === "" ? NaN : Number(word);
      if (Number.isNaN(value)) refuse("BAD_STL", `ASCII STL: vertex ${Math.floor(values.length / 3) + 1} has a coordinate that is not a number (${JSON.stringify(word ?? "")}).`);
      values.push(value);
    }
    at += 3;
  }
  if (values.length % 9 !== 0 || values.length / 9 !== facets) {
    refuse("BAD_STL", `ASCII STL: found ${facets} facets but ${values.length / 3} vertices. Every facet needs exactly three.`);
  }
  const name = header[1]!.trim();
  return { positions: Float32Array.from(values), triangles: facets, format: "ascii", name: name === "" ? null : name };
}
