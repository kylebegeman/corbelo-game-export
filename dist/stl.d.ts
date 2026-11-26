export interface StlMesh {
    /** Triangle soup: nine numbers per triangle, in the file's own units and axes. */
    positions: Float32Array;
    triangles: number;
    format: "binary" | "ascii";
    /** The name after `solid` in an ASCII file. Null for binary files and unnamed solids. */
    name: string | null;
}
/**
 * Reads a binary or ASCII STL file. The normals stored in the file are ignored; the exporter
 * computes its own. A file is binary when its length matches its triangle count exactly,
 * whatever its first bytes say, and ASCII when it starts with `solid`.
 */
export declare function readStl(data: Uint8Array): StlMesh;
