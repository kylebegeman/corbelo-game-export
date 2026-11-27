import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 as zlibCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  ASSET_BUDGETS,
  checkGameAsset,
  crc32,
  exportGameAsset,
  exportGamePack,
  GameExportError,
  GENERATOR,
  GLB_MEDIA_TYPE,
  MANIFEST_MEDIA_TYPE,
  packToZip,
  PLAYER_PROFILES,
  readGlb,
  readPack,
  sha256Hex,
  writeZip,
  type GameExportErrorCode,
  type PackInput,
  type PackManifest,
} from "../src/index.js";
import { box, cylinder, ell, halfPaintedSide, MM_Z_UP, seeded } from "./fixtures.js";

function refusal(run: () => unknown): { code: GameExportErrorCode; message: string } {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GameExportError);
    return { code: (error as GameExportError).code, message: (error as Error).message };
  }
  throw new Error("Expected a refusal.");
}

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const nodeSha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** A crate of a size, as a body in one colour. */
const crate = (size: number) => ({ name: "Body", positions: box([0, 0, 0], [size, size, size]).positions, color: "#8a5a2b", materialName: "Wood" });

/** A barrel with a painted band: two material slots, in whichever order its triangles come. */
const barrel = (radius: number, segments: number) => ({
  name: "Body",
  positions: cylinder(radius, radius * 3, segments).positions,
  color: "#8a5a2b",
  materialName: "Wood",
  faceColors: halfPaintedSide(segments, "#c0392b"),
  faceMaterialNames: { "#c0392b": "Band" },
});

const family: PackInput = {
  name: "crate",
  source: MM_Z_UP,
  rows: [
    { name: "small", bodies: [crate(400)] },
    { name: "large", bodies: [crate(900)] },
  ],
};

/** One file read out of a ZIP archive. */
interface ReadEntry {
  name: string;
  bytes: Uint8Array;
  method: number;
  flags: number;
  time: number;
  date: number;
  crc: number;
}

/**
 * A ZIP reader written for these tests, from the format's own description and not from the
 * writer: it finds the end record from the back, walks the central directory, then follows each
 * entry to its local header and checks that the two agree.
 */
function readZip(zip: Uint8Array): ReadEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = zip.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("No end of central directory record.");
  const count = view.getUint16(end + 10, true);
  expect(view.getUint16(end + 8, true)).toBe(count);
  const directorySize = view.getUint32(end + 12, true);
  const directory = view.getUint32(end + 16, true);
  expect(directory + directorySize).toBe(end);
  expect(view.getUint16(end + 20, true)).toBe(0);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ReadEntry[] = [];
  let at = directory;
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error(`Entry ${index} of the central directory has no signature.`);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (view.getUint32(local, true) !== 0x04034b50) throw new Error(`"${name}" has no local header.`);
    // The local header says the same as the directory.
    expect([view.getUint16(local + 6, true), view.getUint16(local + 8, true), view.getUint16(local + 10, true), view.getUint16(local + 12, true)]).toEqual([flags, method, time, date]);
    expect([view.getUint32(local + 14, true), view.getUint32(local + 18, true), view.getUint32(local + 22, true)]).toEqual([crc, packed, size]);
    const localName = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    expect(decoder.decode(zip.subarray(local + 30, local + 30 + localName))).toBe(name);
    if (method !== 0) throw new Error(`"${name}" is compressed, and this reader only reads stored files.`);
    expect(packed).toBe(size);
    const start = local + 30 + localName + localExtra;
    entries.push({ name, bytes: zip.slice(start, start + size), method, flags, time, date, crc });
  }
  expect(at).toBe(end);
  return entries;
}

describe("SHA-256", () => {
  it("gives the published answers", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("agrees with Node's own at every length around a block, and for a long file", () => {
    const random = seeded(7);
    for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 100_003]) {
      const data = Uint8Array.from({ length }, () => Math.floor(random() * 256));
      expect(sha256Hex(data), `${length} bytes`).toBe(nodeSha256(data));
    }
    // A view into a larger buffer is read from where the view starts.
    const whole = Uint8Array.from({ length: 300 }, (_, at) => at % 251);
    expect(sha256Hex(whole.subarray(100, 200))).toBe(nodeSha256(whole.slice(100, 200)));
  });
});

describe("a pack of one asset", () => {
  const input: PackInput = { name: "Wooden Crate", source: MM_Z_UP, bodies: [crate(500)] };

  it("is one GLB and a manifest, named after the asset the way the engine names things", () => {
    const pack = exportGamePack(input);
    expect(pack.name).toBe("wooden_crate");
    expect(pack.files.map((file) => [file.name, file.mediaType])).toEqual([["wooden_crate.glb", GLB_MEDIA_TYPE], ["wooden_crate.pack.json", MANIFEST_MEDIA_TYPE]]);
    expect(exportGamePack({ ...input, profile: "unreal5" }).files.map((file) => file.name)).toEqual(["SM_WoodenCrate.glb", "SM_WoodenCrate.pack.json"]);
    expect(exportGamePack({ ...input, profile: "unity6" }).files.map((file) => file.name)).toEqual(["WoodenCrate.glb", "WoodenCrate.pack.json"]);
    expect(exportGamePack({ ...input, naming: "prop_{family}_{row}" }).name).toBe("prop_wooden_crate");
  });

  it("names the node and the mesh as the file is named", () => {
    const pack = exportGamePack({ ...input, profile: "unreal5" });
    const read = readPack(pack.files[0]!.bytes);
    expect(read.bodies.map((body) => body.name)).toEqual(["SM_WoodenCrate"]);
    expect(read.facts!.bodies[0]).toMatchObject({ name: "SM_WoodenCrate", sourceName: "SM_WoodenCrate" });
    const { json } = readGlb(pack.files[0]!.bytes);
    expect(json.meshes![read.facts!.bodies[0]!.mesh]!.name).toBe("SM_WoodenCrate");
    // The collision shape is named from it too, the way Unreal reads it.
    expect(read.facts!.bodies[0]!.collision!.nodes.map((node) => node.name)).toEqual(["UBX_SM_WoodenCrate_00"]);
    // Several bodies keep their own names.
    const two = exportGamePack({ ...input, bodies: [{ ...crate(500), name: "Box" }, { name: "Lid", positions: box([0, 0, 500], [500, 500, 520]).positions }], placement: "designed" });
    expect(readPack(two.files[0]!.bytes).bodies.map((body) => body.name)).toEqual(["Box", "Lid"]);
  });

  it("lists the file in the manifest with its size, its SHA-256, its facts and its checks", () => {
    const pack = exportGamePack(input);
    const [glb, manifestFile] = pack.files;
    const { manifest } = pack;
    expect(manifest).toMatchObject({
      schema: 1,
      kind: "asset",
      name: "wooden_crate",
      generator: GENERATOR,
      profile: "godot4",
      engine: { unit: "m", unitMeters: 1, up: "Y" },
      naming: { pattern: "{family}_{row}" },
      assetClass: "small-prop",
      budget: ASSET_BUDGETS["small-prop"],
      player: PLAYER_PROFILES.godot4,
      status: "pass",
      materials: [{ name: "Wood", color: "#8a5a2b", files: ["wooden_crate.glb"] }],
    });
    expect(manifest.files).toHaveLength(1);
    const [listed] = manifest.files;
    expect(listed).toMatchObject({ name: "wooden_crate.glb", role: "model", mediaType: "model/gltf-binary", bytes: glb!.bytes.length, asset: "wooden_crate" });
    expect(listed).not.toHaveProperty("row");
    expect(listed!.sha256).toBe(nodeSha256(glb!.bytes));
    expect(listed!.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The facts and the checks are the ones the GLB itself gives.
    expect(listed!.facts).toEqual(readPack(glb!.bytes).facts);
    expect(listed!.checks).toEqual(checkGameAsset(glb!.bytes));
    // The manifest file is the manifest, as JSON a person can read, ending with a new line.
    const written = text(manifestFile!.bytes);
    expect(JSON.parse(written)).toEqual(JSON.parse(JSON.stringify(manifest)));
    expect(written.endsWith("}\n")).toBe(true);
    expect(written).toContain('\n  "kind": "asset",\n');
    // A point stays on one line.
    expect(written).toMatch(/"baseColorFactor": \[[0-9.]+, [0-9.]+, [0-9.]+, 1\]/);
  });

  it("is the same GLB exportGameAsset writes for the same body and name", () => {
    const pack = exportGamePack(input);
    const direct = exportGameAsset({ source: MM_Z_UP, bodies: [{ ...crate(500), name: "wooden_crate" }] });
    expect(Buffer.from(pack.files[0]!.bytes).equals(Buffer.from(direct.glb))).toBe(true);
  });

  it("passes the asset options on: collision, texture coordinates, detail levels and attach points", () => {
    const post = cylinder(150, 400, 48).positions;
    const pack = exportGamePack({
      name: "post",
      source: MM_Z_UP,
      profile: "unity6",
      collision: { shape: "hull", tolerance: 0.1 },
      texcoords: { tileMeters: 0.5 },
      bodies: [{ name: "Body", positions: post, lods: [{ positions: cylinder(150, 400, 16).positions }], attachPoints: [{ name: "Top", position: [0, 0, 400], direction: [0, 0, 1] }] }],
    });
    const { facts } = pack.manifest.files[0]!;
    expect(facts.settings).toMatchObject({ texcoords: { projection: "box", tileMeters: 0.5 }, collision: { shape: "hull", tolerance: 0.1 }, lodLayout: "group" });
    expect(facts.bodies[0]!.collision).toMatchObject({ requested: "hull", shape: "hull", pieces: 1 });
    expect(facts.bodies[0]!.lods!.map((level) => level.name)).toEqual(["Post_LOD0", "Post_LOD1"]);
    expect(facts.bodies[0]!.attachPoints!.map((point) => point.sourceName)).toEqual(["Top"]);
  });

  it("writes a time or a revision only when given one, and never reads the clock", () => {
    const plain = exportGamePack(input);
    expect(plain.manifest).not.toHaveProperty("generatedAt");
    expect(plain.manifest).not.toHaveProperty("revision");
    expect(text(plain.files[1]!.bytes)).not.toMatch(/20\d\d-\d\d-\d\d/);
    const stamped = exportGamePack({ ...input, generatedAt: "2026-01-02T03:04:05Z", revision: "r12" });
    expect(stamped.manifest).toMatchObject({ generatedAt: "2026-01-02T03:04:05Z", revision: "r12" });
    // Neither is in the GLB: the model's bytes do not move with the time it was packed.
    expect(Buffer.from(stamped.files[0]!.bytes).equals(Buffer.from(plain.files[0]!.bytes))).toBe(true);
  });

  it("gives the same bytes for the same input", () => {
    const first = exportGamePack({ ...family, provenance: { order: 7 }, revision: "r1" });
    const second = exportGamePack({ ...family, provenance: { order: 7 }, revision: "r1" });
    expect(first.files.map((file) => file.name)).toEqual(second.files.map((file) => file.name));
    for (const [at, file] of first.files.entries()) expect(Buffer.from(file.bytes).equals(Buffer.from(second.files[at]!.bytes)), file.name).toBe(true);
    expect(Buffer.from(packToZip(first)).equals(Buffer.from(packToZip(second)))).toBe(true);
  });

  it("runs the checks with the options given, or not at all", () => {
    const kit = exportGamePack({ ...input, checks: { assetClass: "kit-piece", player: "unreal5", budget: { maxTriangles: 100 } } });
    expect(kit.manifest).toMatchObject({ assetClass: "kit-piece", budget: { maxTriangles: 100, maxVertices: 6000, maxMaterialSlots: 3 }, player: PLAYER_PROFILES.unreal5 });
    expect(kit.manifest.files[0]!.checks).toMatchObject({ assetClass: "kit-piece" });
    const none = exportGamePack({ ...input, checks: false });
    for (const key of ["assetClass", "budget", "player", "status"]) expect(none.manifest).not.toHaveProperty(key);
    expect(none.manifest.files[0]).not.toHaveProperty("checks");
    // The GLB is the same either way.
    expect(none.manifest.files[0]!.sha256).toBe(kit.manifest.files[0]!.sha256);
  });

  it("stores the caller's provenance in the manifest and in the GLB", () => {
    const pack = exportGamePack({ ...input, provenance: { project: "p-1", note: "first" } });
    expect(pack.manifest.provenance).toEqual({ project: "p-1", note: "first" });
    expect(pack.manifest.files[0]).not.toHaveProperty("provenance");
    expect(readPack(pack.files[0]!.bytes).provenance).toEqual({ project: "p-1", note: "first" });
    expect(exportGamePack(input).manifest).not.toHaveProperty("provenance");
  });
});

describe("a pack of a family", () => {
  it("is one GLB for each row, in the order of the rows, named by the engine's pattern", () => {
    expect(exportGamePack({ ...family, profile: "unreal5" }).files.map((file) => file.name)).toEqual(["SM_Crate_Small.glb", "SM_Crate_Large.glb", "SM_Crate.pack.json"]);
    expect(exportGamePack(family).files.map((file) => file.name)).toEqual(["crate_small.glb", "crate_large.glb", "crate.pack.json"]);
    expect(exportGamePack({ ...family, profile: "unity6" }).files.map((file) => file.name)).toEqual(["Crate_Small.glb", "Crate_Large.glb", "Crate.pack.json"]);
    expect(exportGamePack({ ...family, naming: "env_{family}_{ROW}" }).files.map((file) => file.name)).toEqual(["env_crate_SMALL.glb", "env_crate_LARGE.glb", "env_crate.pack.json"]);
    const pack = exportGamePack({ ...family, profile: "unreal5" });
    expect(pack.manifest).toMatchObject({ kind: "family", name: "SM_Crate", naming: { pattern: "SM_{Family}_{Row}" }, profile: "unreal5" });
    expect(pack.manifest.files.map((file) => [file.asset, file.row])).toEqual([["SM_Crate_Small", "small"], ["SM_Crate_Large", "large"]]);
    for (const [at, file] of pack.manifest.files.entries()) {
      expect(file.sha256).toBe(nodeSha256(pack.files[at]!.bytes));
      expect(readPack(pack.files[at]!.bytes).bodies.map((body) => body.name)).toEqual([file.asset]);
    }
    expect(pack.manifest.files[1]!.facts.total.bounds.meters.size.map((value) => Math.round(value * 1e6) / 1e6)).toEqual([0.9, 0.9, 0.9]);
  });

  it("keeps the names when the rows change: a row is named by what it is called, not where it stands", () => {
    const before = exportGamePack(family);
    const after = exportGamePack({ ...family, rows: [{ name: "medium", bodies: [crate(600)] }, family.rows![1]!, family.rows![0]!] });
    expect(after.files.map((file) => file.name)).toEqual(["crate_medium.glb", "crate_large.glb", "crate_small.glb", "crate.pack.json"]);
    const hash = (pack: typeof before, name: string) => pack.manifest.files.find((file) => file.name === name)!.sha256;
    // A row that did not change is the same file, byte for byte.
    expect(hash(after, "crate_small.glb")).toBe(hash(before, "crate_small.glb"));
    expect(hash(after, "crate_large.glb")).toBe(hash(before, "crate_large.glb"));
  });

  it("shares material slots: every row has them by name, in the same order", () => {
    // The two barrels have their painted triangles at different places in their lists.
    const pack = exportGamePack({ name: "barrel", source: MM_Z_UP, rows: [{ name: "small", bodies: [barrel(150, 12)] }, { name: "large", bodies: [barrel(300, 48)] }] });
    expect(pack.manifest.materials.map((material) => [material.name, material.color, material.files])).toEqual([
      ["Band", "#c0392b", ["barrel_small.glb", "barrel_large.glb"]],
      ["Wood", "#8a5a2b", ["barrel_small.glb", "barrel_large.glb"]],
    ]);
    for (const file of pack.files.slice(0, 2)) {
      const read = readPack(file.bytes);
      expect(read.bodies[0]!.surfaces.map((surface) => surface.material!.name)).toEqual(["Band", "Wood"]);
      expect(read.facts!.materials.map((material) => material.name)).toEqual(["Band", "Wood"]);
    }
    // A row that only uses one of them lists only that one, and the manifest says which files use which.
    const mixed = exportGamePack({ name: "barrel", source: MM_Z_UP, rows: [{ name: "plain", bodies: [crate(300)] }, { name: "banded", bodies: [barrel(150, 12)] }] });
    expect(mixed.manifest.materials.map((material) => [material.name, material.files])).toEqual([["Band", ["barrel_banded.glb"]], ["Wood", ["barrel_plain.glb", "barrel_banded.glb"]]]);
  });

  it("refuses a material name that means two colours in two rows", () => {
    const { code, message } = refusal(() => exportGamePack({ ...family, rows: [family.rows![0]!, { name: "large", bodies: [{ ...crate(900), color: "#444444" }] }] }));
    expect(code).toBe("MATERIAL_CONFLICT");
    expect(message).toBe('Material "Wood" is #8a5a2b in crate_small.glb and #444444 in crate_large.glb. In a family a material name means one colour.');
  });

  it("checks every row, and takes the worst result as the pack's status", () => {
    // A box collides exactly. The L on its own row has nothing nearer than its hull, a sixth too much.
    const pack = exportGamePack({ name: "block", source: MM_Z_UP, rows: [{ name: "square", bodies: [crate(500)] }, { name: "ell", bodies: [{ name: "Body", positions: ell(1000, 500).positions, color: "#8a5a2b", materialName: "Wood" }] }] });
    expect(pack.manifest.files.map((file) => file.checks!.status)).toEqual(["pass", "fail"]);
    expect(pack.manifest.status).toBe("fail");
    expect(exportGamePack({ ...family, checks: { assetClass: "large-prop" } }).manifest.status).toBe("warn");
    expect(exportGamePack(family).manifest.status).toBe("pass");
  });

  it("stores each row's provenance with its file, and the pack's with the others", () => {
    const pack = exportGamePack({
      ...family,
      provenance: { family: "crate", table: 3 },
      rows: [{ ...family.rows![0]!, provenance: { size: 400 } }, family.rows![1]!],
    });
    expect(pack.manifest.provenance).toEqual({ family: "crate", table: 3 });
    expect(pack.manifest.files[0]!.provenance).toEqual({ size: 400 });
    expect(pack.manifest.files[1]).not.toHaveProperty("provenance");
    expect(readPack(pack.files[0]!.bytes).provenance).toEqual({ size: 400 });
    expect(readPack(pack.files[1]!.bytes).provenance).toEqual({ family: "crate", table: 3 });
  });
});

describe("what a pack refuses", () => {
  const cases: [string, unknown, GameExportErrorCode, string][] = [
    ["both bodies and rows", { ...family, bodies: [crate(500)] }, "BAD_PACK", "give bodies or rows, and not both"],
    ["neither bodies nor rows", { name: "crate", source: MM_Z_UP }, "BAD_PACK", "give bodies or rows"],
    ["no rows", { ...family, rows: [] }, "BAD_PACK", "at least one row"],
    ["a row that is not one", { ...family, rows: ["small"] }, "BAD_PACK", "Row 0 must be { name, bodies }"],
    ["a row without a name", { ...family, rows: [{ bodies: [crate(500)] }] }, "BAD_PACK", "Row 0 needs a name"],
    ["a row without bodies", { ...family, rows: [{ name: "small", bodies: [] }] }, "NO_BODIES", 'Row "small" needs at least one body.'],
    ["an asset without bodies", { name: "crate", source: MM_Z_UP, bodies: [] }, "NO_BODIES", "The asset needs at least one body."],
    ["two rows with one name", { ...family, rows: [{ name: "Small", bodies: [crate(400)] }, { name: "small!", bodies: [crate(500)] }] }, "BAD_PACK", 'Rows "Small" and "small!" both come out named "crate_small"'],
    ["a name with nothing to name by", { ...family, name: "--" }, "BAD_NAME", "A family needs a name"],
    ["a pattern that names nothing", { ...family, naming: "prop" }, "BAD_NAME", "needs {family} or {row}"],
    ["a time that is not text", { ...family, generatedAt: 1700000000 }, "BAD_PACK", "generatedAt must be text."],
    ["checks that are not options", { ...family, checks: true }, "BAD_PACK", "checks must be false or the options of checkGameAsset."],
    ["check options that make no sense", { ...family, checks: { assetClass: "vehicle" } }, "BAD_OPTION", "assetClass"],
    ["provenance that is not JSON", { ...family, provenance: { when: new Date(0) } }, "BAD_PROVENANCE", "provenance"],
    ["nothing at all", null, "BAD_PACK", "exportGamePack needs"],
  ];
  for (const [what, input, code, message] of cases) {
    it(`refuses ${what}`, () => {
      const refused = refusal(() => exportGamePack(input as PackInput));
      expect(refused.code).toBe(code);
      expect(refused.message).toContain(message);
    });
  }

  it("says which row a body's mistake is in by the exporter's own message", () => {
    const { code, message } = refusal(() => exportGamePack({ ...family, rows: [family.rows![0]!, { name: "large", bodies: [{ name: "Body", positions: [0, 0, 0, 1, 0] }] }] }));
    expect(code).toBe("BAD_POSITIONS");
    expect(message).toContain('"crate_large"');
  });
});

describe("ZIP", () => {
  it("gives the published CRC-32, and Node's own for anything", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    const random = seeded(11);
    const data = Uint8Array.from({ length: 70_001 }, () => Math.floor(random() * 256));
    expect(crc32(data)).toBe(zlibCrc32(data));
  });

  it("holds every file of a pack, stored, in order, and reads back byte for byte", () => {
    const pack = exportGamePack({ ...family, profile: "unreal5" });
    const zip = packToZip(pack);
    const entries = readZip(zip);
    expect(entries.map((entry) => entry.name)).toEqual(["SM_Crate_Small.glb", "SM_Crate_Large.glb", "SM_Crate.pack.json"]);
    for (const [at, entry] of entries.entries()) {
      expect(Buffer.from(entry.bytes).equals(Buffer.from(pack.files[at]!.bytes)), entry.name).toBe(true);
      expect(entry.crc).toBe(zlibCrc32(pack.files[at]!.bytes));
      // Stored, names in UTF-8, dated the first day a ZIP can say.
      expect(entry).toMatchObject({ method: 0, flags: 0x0800, time: 0, date: 0x21 });
    }
    // What came out of the archive is what the manifest in the archive says it is.
    const manifest = JSON.parse(text(entries[2]!.bytes)) as PackManifest;
    for (const file of manifest.files) {
      const entry = entries.find((candidate) => candidate.name === file.name)!;
      expect(entry.bytes.length).toBe(file.bytes);
      expect(nodeSha256(entry.bytes)).toBe(file.sha256);
    }
    // Nothing but the files: local headers, the directory and the end record.
    const names = entries.reduce((total, entry) => total + new TextEncoder().encode(entry.name).length, 0);
    expect(zip.length).toBe(22 + entries.length * (30 + 46) + 2 * names + pack.files.reduce((total, file) => total + file.bytes.length, 0));
  });

  it("is an archive the system's own unzip accepts, where there is one", () => {
    const probe = spawnSync("unzip", ["-v"], { encoding: "utf8" });
    if (probe.error !== undefined || probe.status !== 0) {
      console.warn("unzip is not on PATH: the archive was only read by the reader in this test file.");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "corbelo-game-export-zip-"));
    try {
      const path = join(dir, "pack.zip");
      const pack = exportGamePack(family);
      writeFileSync(path, packToZip(pack));
      const tested = spawnSync("unzip", ["-t", path], { encoding: "utf8" });
      expect(tested.stderr).toBe("");
      expect(tested.status).toBe(0);
      expect(tested.stdout).toContain("No errors detected");
      for (const file of pack.files) {
        const piped = spawnSync("unzip", ["-p", path, file.name], { maxBuffer: 64 * 1024 * 1024 });
        expect(piped.status).toBe(0);
        expect(Buffer.from(file.bytes).equals(piped.stdout), file.name).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes folders, names beyond ASCII and an empty archive", () => {
    const files = [
      { name: "models/crate.glb", bytes: Uint8Array.of(1, 2, 3) },
      { name: "Café/crème brûlée.txt", bytes: new TextEncoder().encode("ok") },
      { name: "empty.bin", bytes: new Uint8Array(0) },
    ];
    const entries = readZip(writeZip(files));
    expect(entries.map((entry) => [entry.name, Array.from(entry.bytes)])).toEqual(files.map((file) => [file.name, Array.from(file.bytes)]));
    expect(entries[2]!.crc).toBe(0);
    const empty = writeZip([]);
    expect(empty.length).toBe(22);
    expect(readZip(empty)).toEqual([]);
  });

  it("gives the same bytes for the same files, and keeps the order given", () => {
    const a = { name: "a.txt", bytes: Uint8Array.of(1) };
    const b = { name: "b.txt", bytes: Uint8Array.of(2) };
    expect(Buffer.from(writeZip([a, b])).equals(Buffer.from(writeZip([a, b])))).toBe(true);
    expect(readZip(writeZip([b, a])).map((entry) => entry.name)).toEqual(["b.txt", "a.txt"]);
  });

  it("refuses names that would write outside the folder it is opened in, and two files with one name", () => {
    const bytes = Uint8Array.of(1);
    for (const name of ["../up.txt", "a/../../up.txt", "/root.txt", "a//b.txt", "a\\b.txt", "./a.txt", "", "a/", "line\nbreak.txt"]) {
      const refused = refusal(() => writeZip([{ name, bytes }]));
      expect(refused.code, JSON.stringify(name)).toBe("BAD_PACK");
    }
    expect(refusal(() => writeZip([{ name: "a.txt", bytes }, { name: "A.TXT", bytes }])).message).toBe('Two files of the archive are named "A.TXT".');
    expect(refusal(() => writeZip([{ name: "a.txt", bytes: [1, 2] as never }])).message).toContain("File 0 of the archive must be { name, bytes }");
    expect(refusal(() => writeZip("a.txt" as never)).code).toBe("BAD_PACK");
    expect(refusal(() => packToZip({} as never)).message).toBe("packToZip needs what exportGamePack returned.");
  });
});
