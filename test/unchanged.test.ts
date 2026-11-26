// Bodies with one colour each are written exactly as version 0.1.1 wrote them: the same bytes,
// but for the version number inside the generator string. The hashes below were taken from
// 0.1.1's own output for these inputs, so a later change that moves a single byte fails here.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeGlb } from "../src/glb-write.js";
import { EXTRAS_KEY, exportGameGlb, readGlb, type ExportInput, type PackExtras } from "../src/index.js";
import { box, chamferedBlock, cylinder, fold, MM_Z_UP } from "./fixtures.js";

const block = chamferedBlock([1000, 500, 250], 20);
const round = cylinder(150, 400, 48);
const small = box([0, 0, 0], [10, 10, 10]).positions;
const pair = [
  { name: "Base Plate", positions: box([100, 200, 0], [700, 600, 40]).positions, color: "#c0392b" },
  { name: "Top Cap", positions: box([300, 300, 40], [500, 500, 160]).positions, color: [0.16, 0.5, 0.73] as const, materialName: "Blue Paint" },
];

const cases: Record<string, { input: ExportInput; sha256: string }> = {
  "a chamfered block with face ids and a colour": {
    input: { bodies: [{ name: "Chamfered Block", positions: block.positions, faceIds: block.faceIds, color: "#d98a3d" }], source: MM_Z_UP },
    sha256: "202a64ed80503c4bae2f8f02aa1f400b0bb4b3bcfbacfa84b272f29d6f2e6299",
  },
  "a cylinder with face-weighted normals and provenance": {
    input: { bodies: [{ name: "Cylinder", positions: round.positions }], source: MM_Z_UP, normals: "face-weighted", provenance: { id: 1, tags: ["a", null] } },
    sha256: "b69ac00542525a8dd371bf1991cbf59006084f2dc27639117d888f52ab5ef399",
  },
  "two bodies as designed, for Unreal": {
    input: { bodies: pair, source: MM_Z_UP, placement: "designed", profile: "unreal5" },
    sha256: "21d8a3bc4eba648c57ff0586a73669ec29d2d4b9477a1204efb1577e80af892e",
  },
  "an assembly from a left-handed source in inches": {
    input: { bodies: pair, source: { unit: 0.0254, up: "Y", handedness: "left" }, placement: "assembly", pivot: "center", profile: "unity6" },
    sha256: "fb9d0a3631f005733a2090991e1e52b8068721825b797cce3cbc4f918ce87e7f",
  },
  "five bodies that share colours": {
    input: {
      bodies: [
        { name: "a", positions: small, color: "#ff0000" },
        { name: "b", positions: small, color: [1, 0, 0] },
        { name: "c", positions: small },
        { name: "d", positions: small, color: "#0f0" },
        { name: "e", positions: small, color: "#ff0000", materialName: "Painted Steel" },
      ],
      source: MM_Z_UP,
      pivot: "min-corner",
    },
    sha256: "65d451da11407233cc797592978072ec4e6585abbef71c3d5f761ee4a2fe73fe",
  },
  "indexed triangles, with two that have no area": {
    input: {
      bodies: [{ name: "box", positions: [...small, 5, 5, 5, 6, 6, 6], indices: [36, 36, 37, ...Array.from({ length: 36 }, (_, at) => at), 0, 36, 37], color: "#336699" }],
      source: { unit: 1, up: "Y" },
      pivot: "origin",
      creaseAngle: 180,
    },
    sha256: "b44904bda93ccf41996fedab8b43b187f9e98c43b6da1448fb57b50be364d96f",
  },
  "an open fold with a soft edge": {
    input: { bodies: [{ name: "fold", positions: fold(20).positions, faceIds: fold(20).faceIds }], source: { unit: 0.01, up: "Z" }, weldTolerance: 0, pivot: [1, 2, 3] },
    sha256: "8e1d3174976ff99672d7eff8873004efa0a81b0356d69fcbb408f67341d35a63",
  },
};

/** The file's hash with the version taken out of the two places the generator string is written. */
function hashWithoutVersion(glb: Uint8Array): string {
  const { json, bin } = readGlb(glb);
  // Reading a file and writing it back gives the same bytes, so nothing but the version is hidden.
  expect(encodeGlb(json, bin)).toEqual(glb);
  json.asset.generator = "corbelo-game-export";
  (json.scenes![0]!.extras![EXTRAS_KEY] as PackExtras).facts.generator = "corbelo-game-export";
  return createHash("sha256").update(encodeGlb(json, bin)).digest("hex");
}

describe("bodies with one colour each", () => {
  it.each(Object.entries(cases))("are the bytes version 0.1.1 wrote: %s", (_, { input, sha256 }) => {
    expect(hashWithoutVersion(exportGameGlb(input).glb)).toBe(sha256);
  });
});
