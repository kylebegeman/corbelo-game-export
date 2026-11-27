// The published JSON Schema against what the exporter really writes. Every object in the schema
// refuses unknown keys, so a fact added to the code without the schema fails here.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { beforeAll } from "vitest";
import { checkGameAsset, ENGINE_PROFILES, EXTRAS_KEY, exportGameAsset, exportGameGlb, exportGamePack, PLAYER_PROFILES, readGlb, type AssetInput, type CollisionKernel, type ExportInput, type PackInput } from "../src/index.js";
import { box, chamferedBlock, cutCylinder, cylinder, doorFrame, ell, halfPaintedSide, MM_Z_UP, paintedPatch, paintedTop, ramp, stairs } from "./fixtures.js";
import { loadKernel } from "./kernel.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => JSON.parse(readFileSync(join(root, "schema", name), "utf8")) as Record<string, unknown>;
const schema = read("pack.schema.json");
const reportSchema = read("check-report.schema.json");
const manifestSchema = read("pack-manifest.schema.json");
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validPack = ajv.compile(schema);
const validReport = ajv.compile(reportSchema);
// The manifest refers to the other two by file name, next to its own address.
const validManifest = ajv.compile(manifestSchema);
const validFacts = ajv.compile({ $ref: `${schema["$id"] as string}#/$defs/PackFacts` });
const validProfile = ajv.compile({ $ref: `${schema["$id"] as string}#/$defs/EngineProfile` });

const block = chamferedBlock([1000, 500, 250], 20);
const round = cylinder(150, 400, 24);
const pair = [
  { name: "Base Plate", positions: box([100, 200, 0], [700, 600, 40]).positions, color: "#c0392b" },
  { name: "Top Cap", positions: box([300, 300, 40], [500, 500, 160]).positions, color: [0.16, 0.5, 0.73] as const },
];

const cases: Record<string, ExportInput> = {
  "the defaults": { bodies: [{ name: "Block", positions: block.positions }], source: MM_Z_UP },
  "face ids, face-weighted normals and Unreal": { bodies: [{ name: "Post", positions: round.positions, faceIds: round.faceIds }], source: MM_Z_UP, profile: "unreal5", normals: "face-weighted", creaseAngle: 45 },
  "two bodies as designed, with provenance": { bodies: pair, source: MM_Z_UP, placement: "designed", provenance: { part: "p1", revision: 3, tags: ["a", null] } },
  "an assembly with a point pivot, inches, Y up and left-handed": { bodies: pair, source: { unit: 0.0254, up: "Y", handedness: "left" }, placement: "assembly", pivot: [1, 2, 3], profile: "unity6" },
  "a body in two colours": { bodies: [{ name: "Post", positions: round.positions, faceIds: round.faceIds, color: "#2980ba", faceColors: halfPaintedSide(24, "#c0392b") }], source: MM_Z_UP },
  "an assembly of a painted body and a plain one that share a colour": {
    bodies: [{ ...pair[0]!, faceColors: paintedTop("#2980ba"), materialName: "Plate" }, { name: "Top Cap", positions: pair[1]!.positions, color: "#2980ba" }],
    source: MM_Z_UP,
    placement: "assembly",
    profile: "unreal5",
  },
  "a painted body that says what it was cut from, with names for its colours": {
    bodies: [
      {
        name: "Post",
        positions: cutCylinder(150, 400, 24).positions,
        color: "#2980ba",
        faceColors: paintedPatch(24, "#c0392b"),
        faceMaterialNames: { "#c0392b": "Signal Red", "#2980ba": "Sky Blue" },
        refines: { surfaces: [{ positions: round.positions, faceIds: round.faceIds }], triangleOf: cutCylinder(150, 400, 24).triangleOf },
      },
    ],
    source: MM_Z_UP,
  },
  "a profile of the caller's own": {
    bodies: pair,
    source: MM_Z_UP,
    placement: "assembly",
    profile: { id: "mine", name: "Mine", unit: "dm", unitMeters: 0.1, up: "Z", conventions: { collision: [{ role: "collision-box", affix: "suffix", text: "_box", pattern: "{name}_box" }], lod: [] } },
  },
};

describe("schema/pack.schema.json", () => {
  it.each(Object.entries(cases))("accepts what is written for %s", (_, input) => {
    const { glb, facts } = exportGameGlb(input);
    const extras = readGlb(glb).json.scenes![0]!.extras![EXTRAS_KEY];
    expect(validPack(extras), JSON.stringify(validPack.errors)).toBe(true);
    // The facts as a file, after the same trip through JSON the command line gives them.
    expect(validFacts(JSON.parse(JSON.stringify(facts))), JSON.stringify(validFacts.errors)).toBe(true);
  });

  it("accepts every built-in engine profile", () => {
    for (const profile of Object.values(ENGINE_PROFILES)) expect(validProfile(profile), JSON.stringify(validProfile.errors)).toBe(true);
  });

  it("refuses a fact it does not know and a fact that is missing", () => {
    const facts = JSON.parse(JSON.stringify(exportGameGlb(cases["the defaults"]!).facts)) as Record<string, unknown>;
    expect(validFacts({ ...facts, guessed: true })).toBe(false);
    const { total: _total, ...rest } = facts;
    expect(validFacts(rest)).toBe(false);
    const body = (facts["bodies"] as Record<string, unknown>[])[0]!;
    expect(validFacts({ ...facts, bodies: [{ ...body, triangles: 0 }] })).toBe(false);
    expect(validFacts({ ...facts, bodies: [{ ...body, collision: "box" }] })).toBe(false);
  });

  it("knows the slots of a body in several colours, and refuses slots it cannot be", () => {
    const facts = JSON.parse(JSON.stringify(exportGameGlb(cases["a body in two colours"]!).facts)) as Record<string, unknown>;
    const body = (facts["bodies"] as Record<string, unknown>[])[0]!;
    expect(body["slots"]).toHaveLength(2);
    expect(validFacts(facts)).toBe(true);
    const slots = body["slots"] as Record<string, unknown>[];
    const withSlots = (changed: unknown) => validFacts({ ...facts, bodies: [{ ...body, slots: changed }] });
    // One slot is a body in one colour, which has no list of slots.
    expect(withSlots([slots[0]])).toBe(false);
    expect(withSlots([slots[0], { ...slots[1], triangles: 0 }])).toBe(false);
    expect(withSlots([slots[0], { ...slots[1], color: "#c0392b" }])).toBe(false);
    expect(withSlots([slots[0], { material: "color_c0392b" }])).toBe(false);
    // A body in one colour is written without the list.
    expect(exportGameGlb(cases["the defaults"]!).facts.bodies[0]).not.toHaveProperty("slots");
  });

  it("knows what a body's shading was taken from, and refuses what that cannot be", () => {
    const facts = JSON.parse(JSON.stringify(exportGameGlb(cases["a painted body that says what it was cut from, with names for its colours"]!).facts)) as Record<string, unknown>;
    const body = (facts["bodies"] as Record<string, unknown>[])[0]!;
    expect(body["shadedFrom"]).toEqual({ surfaces: 1, triangles: 96 });
    expect(body["materials"]).toEqual(["Signal_Red", "Sky_Blue"]);
    const withShadedFrom = (changed: unknown) => validFacts({ ...facts, bodies: [{ ...body, shadedFrom: changed }] });
    expect(withShadedFrom({ surfaces: 2, triangles: 10 })).toBe(true);
    expect(withShadedFrom({ surfaces: 0, triangles: 10 })).toBe(false);
    expect(withShadedFrom({ surfaces: 1 })).toBe(false);
    expect(withShadedFrom({ surfaces: 1, triangles: 10, exact: true })).toBe(false);
    expect(withShadedFrom(true)).toBe(false);
    // A body that does not say what it was cut from is written without it.
    expect(exportGameGlb(cases["a body in two colours"]!).facts.bodies[0]).not.toHaveProperty("shadedFrom");
  });
});

const post = cylinder(150, 400, 48);
const frame = doorFrame(3000, 300, 2800, 1200, 2200);
const custom = { id: "mine", name: "Mine", unit: "dm", unitMeters: 0.1, up: "Z" as const, conventions: { collision: [], lod: [] } };

const assets: Record<string, AssetInput> = {
  "the defaults": { bodies: [{ name: "Crate", positions: box([0, 0, 0], [500, 500, 500]).positions }], source: MM_Z_UP },
  "no collision": { bodies: [{ name: "Crate", positions: box([0, 0, 0], [500, 500, 500]).positions }], source: MM_Z_UP, collision: "none" },
  "everything, for Godot": {
    bodies: [
      {
        name: "Post",
        positions: post.positions,
        faceIds: post.faceIds,
        color: "#2980ba",
        faceColors: halfPaintedSide(48, "#c0392b"),
        lods: [{ positions: cylinder(150, 400, 24).positions }, { positions: cylinder(150, 400, 12).positions, faceColors: halfPaintedSide(12, "#c0392b") }],
        attachPoints: [{ name: "Top", position: [0, 0, 400], direction: [0, 0, 1] }, { name: "Side", position: [150, 0, 200] }],
      },
    ],
    source: MM_Z_UP,
    collision: { shape: "hull", tolerance: 0.1, maxHullVertices: 32 },
    texcoords: { tileMeters: 0.5 },
  },
  "detail levels as a group, for Unreal": { bodies: [{ name: "Post", positions: post.positions, lods: [{ positions: cylinder(150, 400, 12).positions }] }], source: MM_Z_UP, profile: "unreal5", texcoords: true },
  "pieces of the caller's own, for Unity": {
    bodies: [{ name: "Ell", positions: ell(1000, 500).positions, collisionPieces: [{ positions: box([0, 0, 0], [1000, 500, 500]).positions }, { positions: box([0, 500, 0], [500, 1000, 500]).positions }] }],
    source: MM_Z_UP,
    profile: "unity6",
  },
  "a shape that is too far off, and a body that is not closed": {
    bodies: [{ name: "Ell", positions: ell(1000, 500).positions }, { name: "Open", positions: box([2000, 0, 0], [2500, 500, 500]).positions.slice(9) }],
    source: MM_Z_UP,
    placement: "designed",
  },
  "a doorway, stairs and a ramp in a profile of the caller's own": {
    bodies: [
      { name: "Frame", positions: frame.positions },
      { name: "Stairs", positions: stairs(5, 180, 280, 1200).positions },
      { name: "Ramp", positions: ramp(4000, 2000, 1500).positions },
    ],
    source: MM_Z_UP,
    profile: custom,
    placement: "assembly",
  },
};

describe("schema/pack.schema.json for a game asset", () => {
  let kernel: CollisionKernel;
  beforeAll(async () => {
    kernel = await loadKernel();
  });

  it.each(Object.entries(assets))("accepts what is written for %s", (_, input) => {
    const { glb, facts } = exportGameAsset(input);
    expect(validPack(readGlb(glb).json.scenes![0]!.extras![EXTRAS_KEY]), JSON.stringify(validPack.errors)).toBe(true);
    expect(validFacts(JSON.parse(JSON.stringify(facts))), JSON.stringify(validFacts.errors)).toBe(true);
  });

  it("accepts a general convex decomposition", () => {
    const { facts } = exportGameAsset({ bodies: [{ name: "Ell", positions: ell(1000, 500).positions }], source: MM_Z_UP, kernel });
    expect(facts.bodies[0]!.collision).toMatchObject({ shape: "decomposition", pieces: 2 });
    expect(facts.settings.collision!.kernel).toBe(true);
    expect(validFacts(JSON.parse(JSON.stringify(facts))), JSON.stringify(validFacts.errors)).toBe(true);
  });

  it("refuses collision, detail levels and attach points that cannot be", () => {
    const facts = JSON.parse(JSON.stringify(exportGameAsset(assets["everything, for Godot"]!).facts)) as Record<string, unknown>;
    const body = (facts["bodies"] as Record<string, unknown>[])[0]!;
    const withBody = (changed: Record<string, unknown>) => validFacts({ ...facts, bodies: [{ ...body, ...changed }] });
    const collision = body["collision"] as Record<string, unknown>;
    const lods = body["lods"] as Record<string, unknown>[];
    const points = body["attachPoints"] as Record<string, unknown>[];
    expect(withBody({})).toBe(true);
    expect(withBody({ collision: { ...collision, shape: "sphere" } })).toBe(false);
    expect(withBody({ collision: { ...collision, requested: "mesh" } })).toBe(false);
    expect(withBody({ collision: { ...collision, exact: true } })).toBe(false);
    expect(withBody({ collision: { ...collision, nodes: [{ ...(collision["nodes"] as Record<string, unknown>[])[0], kind: "sphere" }] } })).toBe(false);
    expect(withBody({ collision: { ...collision, volume: { collision: 1 } } })).toBe(false);
    // One level is a body without lower levels, which has no list of them.
    expect(withBody({ lods: [lods[0]] })).toBe(false);
    expect(withBody({ lods: [lods[0], { ...lods[1], visible: "no" }] })).toBe(false);
    expect(withBody({ lods: [lods[0], { ...lods[1], deviation: { meters: 0.01 } }] })).toBe(false);
    expect(withBody({ attachPoints: [] })).toBe(false);
    expect(withBody({ attachPoints: [{ ...points[0], direction: [0, 1] }] })).toBe(false);
    expect(withBody({ attachPoints: [{ name: "Top" }] })).toBe(false);
    const settings = facts["settings"] as Record<string, unknown>;
    expect(validFacts({ ...facts, settings: { ...settings, lodLayout: "flat" } })).toBe(false);
    expect(validFacts({ ...facts, settings: { ...settings, texcoords: { projection: "sphere", tileMeters: 1 } } })).toBe(false);
    expect(validFacts({ ...facts, settings: { ...settings, collision: { shape: "auto" } } })).toBe(false);
  });
});

describe("schema/check-report.schema.json", () => {
  const reports = Object.entries(assets).flatMap(([name, input]) => [
    [name, input, {}] as const,
    [`${name}, as a kit piece for another player`, input, { assetClass: "kit-piece", player: "unreal5", gridMeters: 0.5, budget: { maxTriangles: 10 }, expect: { opening: true, stairs: true, ramp: true } }] as const,
  ]);

  it.each(reports)("accepts the report for %s", (_, input, options) => {
    const report = checkGameAsset(exportGameAsset(input).glb, options);
    expect(validReport(JSON.parse(JSON.stringify(report))), JSON.stringify(validReport.errors)).toBe(true);
  });

  it("accepts the report of a plain export, and a player of the caller's own with keys of its own", () => {
    const glb = exportGameGlb(cases["two bodies as designed, with provenance"]!).glb;
    expect(validReport(JSON.parse(JSON.stringify(checkGameAsset(glb)))), JSON.stringify(validReport.errors)).toBe(true);
    const player = { ...PLAYER_PROFILES.godot4, id: "scout", origin: "account", revision: 3 };
    const report = JSON.parse(JSON.stringify(checkGameAsset(glb, { player }))) as Record<string, unknown>;
    expect(report["player"]).toMatchObject({ id: "scout", revision: 3 });
    expect(validReport(report), JSON.stringify(validReport.errors)).toBe(true);
  });

  it("sees every status in the reports it was given", () => {
    const seen = new Set<string>();
    for (const [, input, options] of reports) for (const result of checkGameAsset(exportGameAsset(input).glb, options).results) seen.add(`${result.id}:${result.status}`);
    for (const status of ["pass", "warn", "fail", "not-measured"]) expect([...seen].some((entry) => entry.endsWith(`:${status}`)), status).toBe(true);
    for (const id of ["player-openings", "player-steps", "player-ramps", "collision", "detail-levels"]) {
      expect([...seen].filter((entry) => entry.startsWith(`${id}:`)).length, id).toBeGreaterThan(1);
    }
  });

  it("refuses a report with a result missing, out of order, or of a kind it does not know", () => {
    const report = JSON.parse(JSON.stringify(checkGameAsset(exportGameAsset(assets["the defaults"]!).glb))) as Record<string, unknown>;
    const results = report["results"] as Record<string, unknown>[];
    expect(validReport(report)).toBe(true);
    expect(validReport({ ...report, results: results.slice(0, 11) })).toBe(false);
    expect(validReport({ ...report, results: [results[1], results[0], ...results.slice(2)] })).toBe(false);
    expect(validReport({ ...report, results: [...results, results[0]] })).toBe(false);
    expect(validReport({ ...report, status: "not-measured" })).toBe(false);
    expect(validReport({ ...report, guessed: true })).toBe(false);
    const withFirst = (changed: Record<string, unknown>) => validReport({ ...report, results: [{ ...results[0], ...changed }, ...results.slice(1)] });
    expect(withFirst({ status: "unknown" })).toBe(false);
    expect(withFirst({ values: {} })).toBe(false);
    expect(withFirst({ values: { ...(results[0]!["values"] as object), extra: 1 } })).toBe(false);
    // A reason goes with not-measured, and only with it.
    expect(withFirst({ reason: "because" })).toBe(false);
    expect(withFirst({ status: "not-measured" })).toBe(false);
    expect(withFirst({ status: "not-measured", reason: "because" })).toBe(true);
    const { budget: _budget, ...noBudget } = report;
    expect(validReport(noBudget)).toBe(false);
    expect(validReport({ ...report, player: { id: "scout" } })).toBe(false);
  });
});

describe("schema/pack-manifest.schema.json", () => {
  const crate = (size: number) => ({ name: "Body", positions: box([0, 0, 0], [size, size, size]).positions, color: "#8a5a2b", materialName: "Wood" });
  const packs: Record<string, PackInput> = {
    "one asset": { name: "Wooden Crate", source: MM_Z_UP, bodies: [crate(500)] },
    "one asset with everything": { ...assets["everything, for Godot"]!, name: "post", generatedAt: "2026-01-02T03:04:05Z", revision: "r12", provenance: { project: "p-1", tags: ["a", null] }, checks: { assetClass: "kit-piece" } },
    "a family for Unreal": { name: "crate", source: MM_Z_UP, profile: "unreal5", rows: [{ name: "small", bodies: [crate(400)], provenance: { size: 400 } }, { name: "large", bodies: [crate(900)] }] },
    "a family without checks": { name: "crate", source: MM_Z_UP, checks: false, rows: [{ name: "small", bodies: [crate(400)] }] },
  };

  it.each(Object.entries(packs))("accepts the manifest of %s", (_, input) => {
    const pack = exportGamePack(input);
    expect(validManifest(JSON.parse(JSON.stringify(pack.manifest))), JSON.stringify(validManifest.errors)).toBe(true);
    // The file in the pack is the same manifest.
    expect(validManifest(JSON.parse(new TextDecoder().decode(pack.files.at(-1)!.bytes))), JSON.stringify(validManifest.errors)).toBe(true);
  });

  it("refuses a manifest with a file it cannot trust or a key it does not know", () => {
    const manifest = JSON.parse(JSON.stringify(exportGamePack(packs["a family for Unreal"]!).manifest)) as Record<string, unknown>;
    const files = manifest["files"] as Record<string, unknown>[];
    expect(validManifest(manifest)).toBe(true);
    expect(validManifest({ ...manifest, guessed: true })).toBe(false);
    expect(validManifest({ ...manifest, kind: "kit" })).toBe(false);
    expect(validManifest({ ...manifest, files: [] })).toBe(false);
    const withFile = (changed: Record<string, unknown>) => validManifest({ ...manifest, files: [{ ...files[0], ...changed }, files[1]] });
    expect(withFile({ sha256: "abc" })).toBe(false);
    expect(withFile({ sha256: (files[0]!["sha256"] as string).toUpperCase() })).toBe(false);
    expect(withFile({ name: "../SM_Crate_Small.glb" })).toBe(false);
    expect(withFile({ name: "SM_Crate_Small.gltf" })).toBe(false);
    expect(withFile({ bytes: 0 })).toBe(false);
    expect(withFile({ role: "texture" })).toBe(false);
    // The facts and the checks of a file are held to their own schemas.
    expect(withFile({ facts: { ...(files[0]!["facts"] as object), guessed: true } })).toBe(false);
    expect(withFile({ checks: { ...(files[0]!["checks"] as object), status: "unknown" } })).toBe(false);
    const { facts: _facts, ...noFacts } = files[0]!;
    expect(validManifest({ ...manifest, files: [noFacts, files[1]] })).toBe(false);
  });
});

describe("the three schema files", () => {
  it("are what the package publishes, each under an address of its own", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { exports: Record<string, unknown>; files: string[] };
    for (const [name, file] of [["pack.schema.json", schema], ["check-report.schema.json", reportSchema], ["pack-manifest.schema.json", manifestSchema]] as const) {
      expect(manifest.exports[`./schema/${name}`]).toBe(`./schema/${name}`);
      expect(file["$id"]).toBe(`https://raw.githubusercontent.com/kylebegeman/corbelo-game-export/main/schema/${name}`);
      expect(file["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema");
    }
    expect(manifest.files).toContain("schema");
  });
});
