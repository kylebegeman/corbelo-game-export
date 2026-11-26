// What earlier versions wrote is still written, byte for byte, but for the version number inside
// the generator string. Bodies with one colour each are the bytes of 0.1.1, bodies with a colour
// per face are the bytes of 0.1.2, which added them, and bodies that name the materials of their
// face colours or say what they were cut from are the bytes of 0.1.3, which added those. The
// hashes below were taken from those versions' own output for these inputs, so a later change
// that moves a single byte of a file that asks for nothing new fails here.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeGlb } from "../src/glb-write.js";
import { EXTRAS_KEY, exportGameGlb, readGlb, type ExportInput, type PackExtras } from "../src/index.js";
import { box, chamferedBlock, cutAtMiddles, cutCylinder, cylinder, fold, halfPaintedSide, MM_Z_UP, paintedPatch, paintedTop, tube, turned } from "./fixtures.js";

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

// Version 0.1.2 gave a body a colour per face. These are its bytes for bodies that have them.
const coloured: Record<string, { input: ExportInput; sha256: string }> = {
  "a box with its top in another colour": {
    input: { bodies: [{ name: "Crate", positions: box([0, 0, 0], [100, 200, 300]).positions, color: "#2980ba", faceColors: paintedTop("#c0392b") }], source: MM_Z_UP },
    sha256: "91082b1166b7a3ffcdfb5c8fadbaffc040ef1d7f82b05cf1448b9b1e87517497",
  },
  "a cylinder with half its side in another colour, face ids and a named material": {
    input: {
      bodies: [{ name: "Post", positions: round.positions, faceIds: round.faceIds, color: "#2980ba", materialName: "Blue Paint", faceColors: halfPaintedSide(48, "#c0392b") }],
      source: MM_Z_UP,
      normals: "face-weighted",
      profile: "unreal5",
    },
    sha256: "80d9acdbeb9716228709ccbd21f1689dad69639ba20095a70b439d0921e205e8",
  },
  "an assembly of a painted body and a plain one that share a colour": {
    input: {
      bodies: [
        { ...pair[0]!, faceColors: paintedTop("#2980ba") },
        { name: "Top Cap", positions: pair[1]!.positions, color: "#2980ba" },
        { name: "Chamfered Block", positions: block.positions, faceIds: block.faceIds, color: [0.5, 0.5, 0.5], faceColors: Array.from({ length: 44 }, (_, triangle) => (triangle % 3 === 0 ? "#f00" : triangle % 3 === 1 ? [1, 0, 0] : null)) },
      ],
      source: MM_Z_UP,
      placement: "assembly",
    },
    sha256: "cfc54c66ea8265ffce46586712d9cd82841e8ac433d3f7ddeb0a58cf1e4a8d74",
  },
  "indexed triangles with a colour each, two of them without area": {
    input: {
      bodies: [
        {
          name: "box",
          positions: [...small, 5, 5, 5, 6, 6, 6],
          indices: [36, 36, 37, ...Array.from({ length: 36 }, (_, at) => at), 0, 36, 37],
          color: "#336699",
          faceColors: ["#000000", ...Array.from({ length: 12 }, (_, triangle) => (triangle < 4 ? "#ffffff" : triangle < 8 ? null : "#369")), "#123456"],
        },
      ],
      source: { unit: 1, up: "Y", handedness: "left" },
      pivot: "min-corner",
      colorSpace: "linear",
    },
    sha256: "34be54cf7f17130da2a5fb2f04f9b9845b05727fc584ee1b1bdfd8990937350d",
  },
};

// Version 0.1.3 gave face colours names for their materials, and let a body say what it was cut from.
const pieces = cutCylinder(150, 400, 48);
const pipe = tube(150, 60, 400, 48);
const split = cutAtMiddles(block);
const refined: Record<string, { input: ExportInput; sha256: string }> = {
  "a painted cylinder cut finer, shaded from the cylinder, with names for both colours": {
    input: {
      bodies: [
        {
          name: "Post",
          positions: pieces.positions,
          color: "#2980ba",
          faceColors: paintedPatch(48, "#c0392b"),
          faceMaterialNames: { "#c0392b": "Signal Red", "#2980BA": "Sky Blue" },
          refines: { surfaces: [{ positions: round.positions, faceIds: round.faceIds }], triangleOf: pieces.triangleOf },
        },
      ],
      source: MM_Z_UP,
    },
    sha256: "702734b20d4009232b2fd3d96f180d37dc191028a648235dc3058d991f6a7cac",
  },
  "a tube shaded from a cylinder and the turned cylinder that cut it, for Unreal": {
    input: {
      bodies: [
        {
          name: "Tube",
          positions: pipe.positions,
          refines: { surfaces: [{ positions: round.positions, faceIds: round.faceIds }, { positions: turned(cylinder(60, 400, 48)).positions }], surfaceOf: pipe.surfaceOf, triangleOf: pipe.triangleOf },
        },
      ],
      source: MM_Z_UP,
      profile: "unreal5",
      creaseAngle: 10,
    },
    sha256: "2f75e8c7ddabd613f3f5a18b229069027ecce52d7d264e03f9ef1a72b8793c91",
  },
  "a chamfered block cut at its middles, face-weighted, from a left-handed source, beside a plain body": {
    input: {
      bodies: [
        { name: "Block", positions: split.positions, faceIds: split.faceIds, color: "#d98a3d", materialName: "Oak", refines: { surfaces: [{ positions: block.positions, faceIds: block.faceIds }], triangleOf: split.triangleOf } },
        { name: "Crate", positions: small, color: "#336699", faceColors: paintedTop("#d98a3d"), faceMaterialNames: { "#d98a3d": "Oak", "#fff": "White" } },
      ],
      source: { unit: 0.001, up: "Y", handedness: "left" },
      normals: "face-weighted",
      creaseAngle: 50,
      placement: "assembly",
    },
    sha256: "d6a1247ca5705275a6259a8b6f91fa1b688846dd456eab6eec6aee54534fe28b",
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

describe("bodies with a colour per face", () => {
  it.each(Object.entries(coloured))("are the bytes version 0.1.2 wrote: %s", (_, { input, sha256 }) => {
    expect(hashWithoutVersion(exportGameGlb(input).glb)).toBe(sha256);
  });
});

describe("bodies with names for their face colours, or that say what they were cut from", () => {
  it.each(Object.entries(refined))("are the bytes version 0.1.3 wrote: %s", (_, { input, sha256 }) => {
    expect(hashWithoutVersion(exportGameGlb(input).glb)).toBe(sha256);
  });
});
