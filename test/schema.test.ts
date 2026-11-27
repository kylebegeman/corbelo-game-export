// The published JSON Schema against what the exporter really writes. Every object in the schema
// refuses unknown keys, so a fact added to the code without the schema fails here.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { beforeAll } from "vitest";
import {
  checkGameAsset,
  checkKit,
  ENGINE_PROFILES,
  EXTRAS_KEY,
  exportBlockout,
  exportGameAsset,
  exportGameGlb,
  exportGamePack,
  exportKitPack,
  lockJson,
  PLAYER_PROFILES,
  planInstall,
  readGlb,
  verifyPack,
  type AssetInput,
  type CollisionKernel,
  type ExportInput,
  type KitGrid,
  type KitPackInput,
  type KitPieceInput,
  type PackInput,
} from "../src/index.js";
import { box, chamferedBlock, cutCylinder, cylinder, doorFrame, ell, halfPaintedSide, joined, MM_Z_UP, moved, paintedPatch, paintedTop, ramp, stairs } from "./fixtures.js";
import { loadKernel } from "./kernel.js";
import { bodyOf, corridorKit, corridorPieces, flatBoxes, SLAB, swap, WALL, withLamp } from "./kit-fixtures.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => JSON.parse(readFileSync(join(root, "schema", name), "utf8")) as Record<string, unknown>;
const schema = read("pack.schema.json");
const reportSchema = read("check-report.schema.json");
const manifestSchema = read("pack-manifest.schema.json");
const kitReportSchema = read("kit-check-report.schema.json");
const blockoutSchema = read("blockout.schema.json");
const kitJobSchema = read("kit-job.schema.json");
const lockSchema = read("lock.schema.json");
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validPack = ajv.compile(schema);
const validReport = ajv.compile(reportSchema);
// The others refer to the ones before them by file name, next to their own address.
const validKitReport = ajv.compile(kitReportSchema);
const validBlockout = ajv.compile(blockoutSchema);
const validBlockoutFacts = ajv.compile({ $ref: `${blockoutSchema["$id"] as string}#/$defs/BlockoutFacts` });
const validManifest = ajv.compile(manifestSchema);
const validKitJob = ajv.compile(kitJobSchema);
const validLock = ajv.compile(lockSchema);
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
  "a detail level that says what it was cut from": {
    bodies: [
      {
        name: "Post",
        positions: post.positions,
        lods: [{ positions: cutCylinder(150, 400, 12).positions, refines: { surfaces: [{ positions: cylinder(150, 400, 12).positions, faceIds: cylinder(150, 400, 12).faceIds }], triangleOf: cutCylinder(150, 400, 12).triangleOf } }],
      },
    ],
    source: MM_Z_UP,
  },
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

  it("describes what each body's collision was made with, and still reads facts from before that was there", () => {
    const facts = JSON.parse(JSON.stringify(exportGameAsset({ ...assets["the defaults"]!, collisions: [{ shape: "hull", maxPieces: 4, maxHullVertices: 16 }] }).facts)) as { bodies: { collision: Record<string, unknown> }[] };
    expect(facts.bodies[0]!.collision).toMatchObject({ requested: "hull", maxPieces: 4, maxHullVertices: 16 });
    const withCollision = (change: (collision: Record<string, unknown>) => void) => {
      const changed = JSON.parse(JSON.stringify(facts)) as typeof facts;
      change(changed.bodies[0]!.collision);
      return validFacts(changed);
    };
    expect(withCollision(() => undefined)).toBe(true);
    // Version 0.1.7 wrote neither.
    expect(withCollision((collision) => (delete collision["maxPieces"], delete collision["maxHullVertices"]))).toBe(true);
    // Only a decomposition of a body given the rest of it says how many pieces were the caller's.
    expect(facts.bodies[0]!.collision["givenPieces"]).toBeUndefined();
    expect(withCollision((collision) => (collision["givenPieces"] = 2))).toBe(true);
    expect(withCollision((collision) => (collision["givenPieces"] = -1))).toBe(false);
    expect(withCollision((collision) => (collision["maxPieces"] = 0))).toBe(false);
    expect(withCollision((collision) => (collision["maxHullVertices"] = 3))).toBe(false);
  });

  it("accepts a decomposition of the rest of a body, beside the pieces that were given", () => {
    const post = cylinder(150, 400, 24);
    const corner = moved(ell(1000, 500), [1000, 0, 0]);
    const { facts } = exportGameAsset({
      bodies: [{ name: "Stand", positions: joined(post, corner).positions, collisionPieces: [{ positions: post.positions }], collisionRemainder: { positions: corner.positions } }],
      source: MM_Z_UP,
      kernel,
    });
    expect(facts.bodies[0]!.collision).toMatchObject({ shape: "decomposition", pieces: 3, givenPieces: 1 });
    expect(validFacts(JSON.parse(JSON.stringify(facts))), JSON.stringify(validFacts.errors)).toBe(true);
  });

  it("describes what a detail level was shaded from, and still reads facts from before that was there", () => {
    const facts = JSON.parse(JSON.stringify(exportGameAsset(assets["a detail level that says what it was cut from"]!).facts)) as { bodies: { lods: Record<string, unknown>[] }[] };
    const [full, level] = facts.bodies[0]!.lods;
    expect(full).not.toHaveProperty("shadedFrom");
    expect(level!["shadedFrom"]).toEqual({ surfaces: 1, triangles: 48 });
    const withShadedFrom = (changed: unknown) => validFacts({ ...facts, bodies: [{ ...facts.bodies[0], lods: [full, { ...level, shadedFrom: changed }] }] });
    expect(withShadedFrom({ surfaces: 1, triangles: 48 }), JSON.stringify(validFacts.errors)).toBe(true);
    expect(withShadedFrom({ surfaces: 0, triangles: 48 })).toBe(false);
    expect(withShadedFrom({ surfaces: 1 })).toBe(false);
    expect(withShadedFrom({ surfaces: 1, triangles: 48, meshes: 1 })).toBe(false);
    // Version 0.1.7 wrote no level with it.
    const { shadedFrom: _, ...before } = level!;
    expect(validFacts({ ...facts, bodies: [{ ...facts.bodies[0], lods: [full, before] }] }), JSON.stringify(validFacts.errors)).toBe(true);
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

  it("describes the player's name in the values of each player check, and still reads a report from before it was there", () => {
    const report = JSON.parse(JSON.stringify(checkGameAsset(exportGameAsset(assets["the defaults"]!).glb))) as { results: { id: string; values: Record<string, unknown> }[] };
    const players = report.results.filter((result) => result.id.startsWith("player-"));
    expect(players.map((result) => [result.id, result.values["player"], result.values["playerName"]])).toEqual([
      ["player-openings", "godot4-character-body", "Godot 4 CharacterBody3D"],
      ["player-steps", "godot4-character-body", "Godot 4 CharacterBody3D"],
      ["player-ramps", "godot4-character-body", "Godot 4 CharacterBody3D"],
    ]);
    const withValues = (change: (values: Record<string, unknown>) => void) => {
      const changed = JSON.parse(JSON.stringify(report)) as typeof report;
      for (const result of changed.results) if (result.id.startsWith("player-")) change(result.values);
      return validReport(changed);
    };
    expect(withValues(() => undefined)).toBe(true);
    // Version 0.1.6 wrote the id alone.
    expect(withValues((values) => delete values["playerName"])).toBe(true);
    expect(withValues((values) => (values["playerName"] = 7))).toBe(false);
    expect(withValues((values) => delete values["player"])).toBe(false);
  });

  it("describes what each body's collision came to, and still reads a report from before that was there", () => {
    const report = JSON.parse(JSON.stringify(checkGameAsset(exportGameAsset(assets["the defaults"]!).glb))) as { results: { id: string; values: { bodies: Record<string, unknown>[] } }[] };
    const bodies = () => report.results.find((result) => result.id === "collision")!.values.bodies;
    expect(bodies()[0]).toMatchObject({ tolerance: 0.05, status: "pass" });
    const withBody = (change: (body: Record<string, unknown>) => void) => {
      const changed = JSON.parse(JSON.stringify(report)) as typeof report;
      change(changed.results.find((result) => result.id === "collision")!.values.bodies[0]!);
      return validReport(changed);
    };
    expect(withBody(() => undefined)).toBe(true);
    // Version 0.1.7 wrote neither.
    expect(withBody((body) => (delete body["tolerance"], delete body["status"]))).toBe(true);
    expect(withBody((body) => (body["status"] = "fine"))).toBe(false);
    expect(withBody((body) => (body["tolerance"] = -1))).toBe(false);
  });

  it("describes the key and the named values of each message, and still reads a report from before they were there", () => {
    const report = JSON.parse(JSON.stringify(checkGameAsset(exportGameAsset(assets["the defaults"]!).glb))) as { results: Record<string, unknown>[] };
    for (const result of report.results) expect(Object.keys(result), result["id"] as string).toEqual(expect.arrayContaining(["messageKey", "messageValues"]));
    const at = (id: string) => report.results.findIndex((result) => result["id"] === id);
    const withResult = (id: string, change: (result: Record<string, unknown>) => void) => {
      const changed = JSON.parse(JSON.stringify(report)) as typeof report;
      change(changed.results[at(id)]!);
      return validReport(changed);
    };
    const withAll = (change: (result: Record<string, unknown>) => void) => {
      const changed = JSON.parse(JSON.stringify(report)) as typeof report;
      for (const result of changed.results) change(result);
      return validReport(changed);
    };
    expect(withAll(() => undefined), JSON.stringify(validReport.errors)).toBe(true);
    // Version 0.1.7 wrote the English text alone.
    expect(withAll((result) => { for (const key of ["messageKey", "messageValues", "reasonKey", "reasonValues"]) delete result[key]; }), JSON.stringify(validReport.errors)).toBe(true);
    // A key is the id of its check, a dot and what was found.
    expect(withResult("size", (result) => (result["messageKey"] = "size.some-new-finding"))).toBe(true);
    expect(withResult("size", (result) => (result["messageKey"] = "pivot.same"))).toBe(false);
    expect(withResult("size", (result) => (result["messageKey"] = "size"))).toBe(false);
    expect(withResult("size", (result) => (result["messageKey"] = "size.Expected"))).toBe(false);
    expect(withResult("size", (result) => (result["messageKey"] = 7))).toBe(false);
    // A value is a text, a number, a part with a key of its own, or a list of those.
    const nested = { found: [{ key: "clean-mesh.open", values: { count: 2 }, text: "2 open edges" }, "more", 3], why: { key: "collision.has-edges" } };
    expect(withResult("size", (result) => (result["messageValues"] = nested)), JSON.stringify(validReport.errors)).toBe(true);
    expect(withResult("size", (result) => (result["messageValues"] = { flag: true }))).toBe(false);
    expect(withResult("size", (result) => (result["messageValues"] = { part: { values: {} } }))).toBe(false);
    expect(withResult("size", (result) => (result["messageValues"] = { part: { key: "size.units", guessed: 1 } }))).toBe(false);
    expect(withResult("size", (result) => (result["messageValues"] = ["longest"]))).toBe(false);
    // The key of a reason goes with not-measured, as the reason does, and is the key of its message with ".reason".
    expect(report.results[at("detail-levels")]).toMatchObject({ status: "not-measured", reasonKey: "detail-levels.none.reason", reasonValues: {} });
    expect(withResult("detail-levels", (result) => (result["reasonKey"] = "detail-levels.none"))).toBe(false);
    expect(withResult("detail-levels", (result) => (result["reasonKey"] = "collision.none.reason"))).toBe(false);
    expect(withResult("detail-levels", (result) => (result["reasonValues"] = { flag: null }))).toBe(false);
    expect(withResult("size", (result) => (result["reasonKey"] = "size.expected.reason"))).toBe(false);
    expect(withResult("size", (result) => (result["reasonValues"] = {}))).toBe(false);
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
    // A kit has the part that says what the kit is, and nothing else has it.
    expect(validManifest({ ...manifest, kind: "kit" })).toBe(false);
    expect(validManifest({ ...manifest, kit: {} })).toBe(false);
    expect(validManifest({ ...manifest, scenes: [] })).toBe(false);
    expect(validManifest({ ...manifest, kind: "terrain" })).toBe(false);
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

/** Kits that end in every status: as they should be, and each with something wrong or left out. */
const sizesOf = (grid: KitGrid): { M: number; S: number } => ({ M: grid.moduleMeters * 1000, S: grid.storeyMeters * 1000 });
const threshold = (grid: KitGrid): KitPieceInput => {
  const { M } = sizesOf(grid);
  const good = corridorPieces(grid)[0]!;
  return { ...good, bodies: [...good.bodies!, bodyOf("threshold", [[[M - 100, 500, 150], [M + 50, M - 500, 250]]])], trim: ["threshold"] };
};
const splitWall = (grid: KitGrid): KitPieceInput => {
  const { M, S } = sizesOf(grid);
  const boxes = flatBoxes(grid, ["+x", "-x"]);
  const split: typeof boxes = [boxes[0]!, [[0, 0, SLAB], [M, WALL, 1500]], [[0, 0, 1500], [M, WALL, S]], boxes[2]!];
  return { ...corridorPieces(grid)[0]!, bodies: [bodyOf("straight", boxes, { visible: joined(...split.map(([min, max]) => box(min, max))) })] };
};
const skirting = (grid: KitGrid): KitPieceInput => {
  const { M } = sizesOf(grid);
  const good = corridorPieces(grid)[5]!;
  return { ...good, bodies: [...good.bodies!, bodyOf("skirting", [[[-300, 500, 0], [100, M - 500, 100]]])], trim: ["skirting"] };
};
const kits: Record<string, KitPackInput> = {
  "the corridor kit": corridorKit(undefined, { revision: "r7", generatedAt: "2026-01-01T00:00:00Z", provenance: { part: "corridor kit" } }),
  "a kit with a lamp of three detail levels": corridorKit(withLamp),
  "a kit for Unreal, with a layout of the caller's own and mates": corridorKit(undefined, {
    profile: "unreal5",
    mates: { corridor: "corridor" },
    layouts: [{ name: "dead end", placements: [{ piece: "endcap", cell: [0, 0, 0] }, { piece: "straight", cell: [1, 0, 0] }, { piece: "endcap", cell: [2, 0, 0], turn: 2 }] }],
  }),
  "a pivot off the grid": corridorKit(swap((grid) => ({ ...corridorPieces(grid)[0]!, pivot: [100, 0, 0] }))),
  "a wall in two parts": corridorKit(swap(splitWall)),
  "trim that runs into the next piece": corridorKit(swap(threshold)),
  "trim that reaches too far": corridorKit(swap(skirting)),
  "no collision": corridorKit(undefined, { collision: "none" }),
  "no sockets": corridorKit((pieces) => pieces.slice(0, 2).map((piece) => ({ ...piece, sockets: [] }))),
  "layouts that do not close": corridorKit(undefined, {
    layouts: [
      { name: "gap", placements: [{ piece: "straight", cell: [0, 0, 0] }, { piece: "straight", cell: [2, 0, 0] }] },
      { name: "twice", placements: [{ piece: "straight", cell: [0, 0, 0] }, { piece: "doorway", cell: [0, 0, 0] }, { piece: "straight", cell: [1, 0, 0] }] },
    ],
  }),
  "a kit with no checks and no scenes": corridorKit(undefined, { checks: false, pieceChecks: false, scenes: false }),
};
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("schema/kit-check-report.schema.json", () => {
  let kernel: CollisionKernel;
  beforeAll(async () => {
    kernel = await loadKernel();
  });

  it.each(Object.entries(kits))("accepts the report for %s", (_, input) => {
    const report = checkKit(input);
    expect(validKitReport(json(report)), JSON.stringify(validKitReport.errors)).toBe(true);
  });

  it("accepts a report made with a kernel, for another module size and another player", () => {
    const report = checkKit(kits["trim that runs into the next piece"]!, { kernel, player: "unity6" });
    expect(report.kernel).toBe(true);
    expect(validKitReport(json(report)), JSON.stringify(validKitReport.errors)).toBe(true);
    const other = checkKit(kits["the corridor kit"]!, { grid: { moduleMeters: 4, storeyMeters: 3.5 }, toleranceMeters: 0.001 });
    expect(validKitReport(json(other)), JSON.stringify(validKitReport.errors)).toBe(true);
  });

  it("sees every status in the reports it was given", () => {
    const seen = new Set<string>();
    for (const input of Object.values(kits)) for (const result of checkKit(input).results) seen.add(`${result.id}:${result.status}`);
    for (const result of checkKit(kits["trim that runs into the next piece"]!, { kernel }).results) seen.add(`${result.id}:${result.status}`);
    for (const status of ["pass", "warn", "fail", "not-measured"]) expect([...seen].some((entry) => entry.endsWith(`:${status}`)), status).toBe(true);
    for (const id of ["on-grid", "seams", "in-cells", "layouts", "corners", "walkable", "collision-tiles"]) {
      expect([...seen].filter((entry) => entry.startsWith(`${id}:`)).length, id).toBeGreaterThan(1);
    }
  });

  it("describes the player's name in the values of Walkable, and still reads a report from before it was there", () => {
    const report = json(checkKit(kits["the corridor kit"]!)) as unknown as { results: { id: string; values: Record<string, unknown> }[] };
    const walk = report.results.find((result) => result.id === "walkable")!;
    expect([walk.values["player"], walk.values["playerName"]]).toEqual(["godot4-character-body", "Godot 4 CharacterBody3D"]);
    expect(validKitReport(report), JSON.stringify(validKitReport.errors)).toBe(true);
    // Version 0.1.6 wrote the id alone.
    delete walk.values["playerName"];
    expect(validKitReport(report), JSON.stringify(validKitReport.errors)).toBe(true);
    walk.values["playerName"] = 7;
    expect(validKitReport(report)).toBe(false);
  });

  it("describes the key and the named values of each message and of each layout left out, and still reads a report from before they were there", () => {
    type Loose = { results: (Record<string, unknown> & { values: { skipped?: Record<string, unknown>[] } })[] };
    const report = json(checkKit(corridorKit((pieces) => [pieces[0]!, pieces[4]!, pieces[5]!]))) as unknown as Loose;
    const skippedOf = (copy: Loose) => copy.results.find((result) => result["id"] === "layouts")!.values.skipped!;
    expect(skippedOf(report).length).toBeGreaterThan(0);
    for (const skip of skippedOf(report)) expect(skip).toMatchObject({ reasonKey: "layouts.skipped.no-piece", reasonValues: { layout: skip["name"] } });
    for (const result of report.results) expect(Object.keys(result), result["id"] as string).toEqual(expect.arrayContaining(["messageKey", "messageValues"]));
    const changed = (change: (report: Loose) => void) => {
      const copy = json(report);
      change(copy);
      return validKitReport(copy);
    };
    expect(changed(() => undefined), JSON.stringify(validKitReport.errors)).toBe(true);
    // Version 0.1.7 wrote the English text alone.
    const strip = (value: Record<string, unknown>) => { for (const key of ["messageKey", "messageValues", "reasonKey", "reasonValues"]) delete value[key]; };
    expect(changed((copy) => [...copy.results, ...skippedOf(copy)].forEach(strip)), JSON.stringify(validKitReport.errors)).toBe(true);
    expect(changed((copy) => (copy.results[0]!["messageKey"] = "seams.match"))).toBe(false);
    expect(changed((copy) => (copy.results[0]!["messageKey"] = "on-grid.some-new-finding"))).toBe(true);
    expect(changed((copy) => (copy.results[0]!["messageValues"] = { flag: false }))).toBe(false);
    expect(changed((copy) => (copy.results[0]!["reasonKey"] = "on-grid.whole.reason"))).toBe(false);
    expect(changed((copy) => (skippedOf(copy)[0]!["reasonKey"] = "layouts.none.reason"))).toBe(false);
    expect(changed((copy) => (skippedOf(copy)[0]!["reasonKey"] = "layouts.skipped.some-new-reason"))).toBe(true);
    expect(changed((copy) => (skippedOf(copy)[0]!["reasonValues"] = { layout: null }))).toBe(false);
    expect(changed((copy) => (skippedOf(copy)[0]!["guessed"] = true))).toBe(false);
    // The manifest of a kit pack holds the same layouts left out, to the same rule.
    const manifest = json(exportKitPack(corridorKit((pieces) => [pieces[0]!, pieces[4]!, pieces[5]!])).manifest) as unknown as { kit: { skippedLayouts: Record<string, unknown>[] } };
    expect(manifest.kit.skippedLayouts[0]).toMatchObject({ reasonKey: "layouts.skipped.no-piece" });
    expect(validManifest(manifest), JSON.stringify(validManifest.errors)).toBe(true);
    manifest.kit.skippedLayouts.forEach(strip);
    expect(validManifest(manifest), JSON.stringify(validManifest.errors)).toBe(true);
    manifest.kit.skippedLayouts[0]!["reasonKey"] = "seams.no-pairs.reason";
    expect(validManifest(manifest)).toBe(false);
  });

  it("refuses a report with a result missing, out of order, or of a kind it does not know", () => {
    const report = json(checkKit(kits["the corridor kit"]!)) as unknown as Record<string, unknown>;
    const results = report["results"] as Record<string, unknown>[];
    expect(validKitReport(report)).toBe(true);
    expect(validKitReport({ ...report, results: results.slice(0, 6) })).toBe(false);
    expect(validKitReport({ ...report, results: [results[1], results[0], ...results.slice(2)] })).toBe(false);
    expect(validKitReport({ ...report, results: [...results, results[0]] })).toBe(false);
    expect(validKitReport({ ...report, status: "not-measured" })).toBe(false);
    expect(validKitReport({ ...report, guessed: true })).toBe(false);
    expect(validKitReport({ ...report, grid: { moduleMeters: 0, storeyMeters: 3, trimMeters: 0.1 } })).toBe(false);
    expect(validKitReport({ ...report, layouts: [{ name: "run", origin: "guessed", placements: [] }] })).toBe(false);
    expect(validKitReport({ ...report, layouts: [{ name: "run", origin: "given", placements: [{ piece: "straight", cell: [0, 0, 0], turn: 4 }] }] })).toBe(false);
    const withFirst = (changed: Record<string, unknown>) => validKitReport({ ...report, results: [{ ...results[0], ...changed }, ...results.slice(1)] });
    expect(withFirst({ status: "unknown" })).toBe(false);
    expect(withFirst({ values: {} })).toBe(false);
    expect(withFirst({ values: { ...(results[0]!["values"] as object), extra: 1 } })).toBe(false);
    // A reason goes with not-measured, and only with it.
    expect(withFirst({ reason: "because" })).toBe(false);
    expect(withFirst({ status: "not-measured" })).toBe(false);
    expect(withFirst({ status: "not-measured", reason: "because" })).toBe(true);
  });
});

describe("schema/blockout.schema.json", () => {
  it.each(Object.entries(kits))("accepts every layout of %s as a scene", (_, input) => {
    const names = checkKit(input).layouts.map((layout) => layout.name);
    for (const name of names) {
      const { glb, facts } = exportBlockout(input, name, { provenance: { layout: name } });
      expect(validBlockout(readGlb(glb).json.scenes![0]!.extras![EXTRAS_KEY]), JSON.stringify(validBlockout.errors)).toBe(true);
      expect(validBlockoutFacts(json(facts)), JSON.stringify(validBlockoutFacts.errors)).toBe(true);
    }
  });

  it("knows the nodes that hold detail levels, and refuses facts that cannot be", () => {
    const facts = json(exportBlockout(kits["a kit with a lamp of three detail levels"]!, "run").facts) as unknown as Record<string, unknown>;
    const lods = facts["lods"] as Record<string, unknown>[];
    expect(lods.length).toBeGreaterThan(0);
    expect(validBlockoutFacts(facts)).toBe(true);
    expect(validBlockoutFacts({ ...facts, guessed: true })).toBe(false);
    expect(validBlockoutFacts({ ...facts, kind: "asset" })).toBe(false);
    expect(validBlockoutFacts({ ...facts, lods: [] })).toBe(false);
    // One level is a body without lower levels, which is not listed.
    expect(validBlockoutFacts({ ...facts, lods: [{ ...lods[0], levels: (lods[0]!["levels"] as unknown[]).slice(0, 1) }] })).toBe(false);
    const placements = facts["placements"] as Record<string, unknown>[];
    expect(validBlockoutFacts({ ...facts, placements: [{ ...placements[0], degrees: 45 }, ...placements.slice(1)] })).toBe(false);
    const { meshes: _meshes, ...rest } = facts;
    expect(validBlockoutFacts(rest)).toBe(false);
    // A layout of pieces with one level each is written without the list.
    expect(exportBlockout(kits["the corridor kit"]!, "run").facts).not.toHaveProperty("lods");
  });
});

describe("schema/pack-manifest.schema.json for a kit", () => {
  let kernel: CollisionKernel;
  beforeAll(async () => {
    kernel = await loadKernel();
  });

  it.each(Object.entries(kits))("accepts the manifest of %s", (_, input) => {
    const pack = exportKitPack(input);
    expect(pack.manifest.kind).toBe("kit");
    expect(validManifest(json(pack.manifest)), JSON.stringify(validManifest.errors)).toBe(true);
    expect(validManifest(JSON.parse(new TextDecoder().decode(pack.files.at(-1)!.bytes))), JSON.stringify(validManifest.errors)).toBe(true);
  });

  it("accepts the manifest of a kit made with a kernel", () => {
    const pack = exportKitPack({ ...kits["trim that runs into the next piece"]!, kernel });
    expect(pack.manifest.kit!.checks!.kernel).toBe(true);
    expect(validManifest(json(pack.manifest)), JSON.stringify(validManifest.errors)).toBe(true);
  });

  it("refuses a kit it cannot be, a scene it cannot trust and a kit with no kit in it", () => {
    const manifest = json(exportKitPack(kits["the corridor kit"]!).manifest) as unknown as Record<string, unknown>;
    const kit = manifest["kit"] as Record<string, unknown>;
    const scenes = manifest["scenes"] as Record<string, unknown>[];
    expect(validManifest(manifest)).toBe(true);
    const { kit: _kit, ...noKit } = manifest;
    expect(validManifest(noKit)).toBe(false);
    expect(validManifest({ ...manifest, kind: "family" })).toBe(false);
    const withKit = (changed: Record<string, unknown>) => validManifest({ ...manifest, kit: { ...kit, ...changed } });
    expect(withKit({})).toBe(true);
    expect(withKit({ guessed: true })).toBe(false);
    expect(withKit({ frame: { up: "Y", toFile: "as it is" } })).toBe(false);
    expect(withKit({ cellSize: [3, 3] })).toBe(false);
    const pieces = kit["pieces"] as Record<string, unknown>[];
    const sockets = pieces[0]!["sockets"] as Record<string, unknown>[];
    const withSocket = (changed: Record<string, unknown>) => withKit({ pieces: [{ ...pieces[0], sockets: [{ ...sockets[0], ...changed }] }, ...pieces.slice(1)] });
    expect(withSocket({})).toBe(true);
    expect(withSocket({ side: "up" })).toBe(false);
    expect(withSocket({ region: [[0, 0, 0]] })).toBe(false);
    expect(withSocket({ passage: "yes" })).toBe(false);
    const library = kit["meshLibrary"] as Record<string, unknown>;
    expect(withKit({ meshLibrary: { ...library, items: [{ id: 0, name: "corridor_straight" }] } })).toBe(false);
    // The kit checks are held to their own schema.
    expect(withKit({ checks: { ...(kit["checks"] as object), status: "unknown" } })).toBe(false);
    const withScene = (changed: Record<string, unknown>) => validManifest({ ...manifest, scenes: [{ ...scenes[0], ...changed }, ...scenes.slice(1)] });
    expect(withScene({})).toBe(true);
    expect(withScene({ sha256: "abc" })).toBe(false);
    expect(withScene({ name: "../corridor_layout_run.glb" })).toBe(false);
    expect(withScene({ role: "model" })).toBe(false);
    expect(withScene({ facts: { ...(scenes[0]!["facts"] as object), guessed: true } })).toBe(false);
  });
});

describe("schema/kit-job.schema.json", () => {
  const bodies = [{ name: "straight", stl: "straight.stl", color: "#8a8f98", materialName: "Concrete", collisionPieces: [{ stl: "straight-0.stl" }], lods: [{ stl: "straight-lod1.stl" }] }];
  const job = {
    name: "hall",
    source: MM_Z_UP,
    grid: { moduleMeters: 3, storeyMeters: 3 },
    collision: "pieces",
    pieces: [
      { name: "straight", bodies, sockets: [{ type: "corridor", side: "+x", passage: true }, { name: "back", type: "corridor", plane: { point: [0, 1500, 1500], normal: [-1, 0, 0] }, region: [[0, 0, 0], [0, 3000, 0], [0, 3000, 3000]] }], trim: ["skirting"], provenance: { part: 1 } },
      { name: "stairs", glb: "hall_stairs.glb", cells: [2, 1, 2], origin: [0, 0, 0], sockets: [{ type: "corridor", side: "+x", cell: [1, 0, 1] }] },
    ],
    mates: { plug: "hole" },
    layouts: [{ name: "pair", placements: [{ piece: "straight", cell: [0, 0, 0] }, { piece: "straight", cell: [1, 0, 0], turn: 2 }] }],
    checks: { player: "godot4", toleranceMeters: 0.0005 },
    pieceChecks: { gridMeters: 0.5 },
    scenes: true,
    kernel: "manifold-3d",
    revision: "k1",
    generatedAt: "2026-01-01T00:00:00Z",
    provenance: { project: "p-1" },
    output: { dir: "out", zip: "hall.zip" },
  };

  it("accepts a kit written as data", () => {
    expect(validKitJob(job), JSON.stringify(validKitJob.errors)).toBe(true);
    expect(validKitJob({ name: "hall", source: MM_Z_UP, grid: job.grid, pieces: [{ name: "a", glb: "a.glb" }], checks: false, pieceChecks: false, scenes: false })).toBe(true);
  });

  it("knows the rest of a body that is given to be cut up, and refuses what a kit does not take", () => {
    const withBody = (changed: Record<string, unknown>) => validKitJob({ ...job, pieces: [{ ...job.pieces[0], bodies: [{ ...bodies[0], ...changed }] }] });
    expect(withBody({ collisionRemainder: { stl: "straight-rest.stl" } })).toBe(true);
    expect(withBody({ collisionRemainder: { stl: "" } })).toBe(false);
    expect(withBody({ collisionRemainder: { stl: "straight-rest.stl", name: "rest" } })).toBe(false);
    // A detail level may say what it was cut from, as a body may.
    expect(withBody({ lods: [{ stl: "straight-lod1.stl", refines: { surfaces: [{ stl: "straight-lod1-uncut.stl" }], triangleOf: "straight-lod1.of.json" } }] })).toBe(true);
    expect(withBody({ lods: [{ stl: "straight-lod1.stl", refines: "straight-lod1-uncut.stl" }] })).toBe(false);
    expect(withBody({ lods: [{ stl: "straight-lod1.stl", refined: {} }] })).toBe(false);
    expect(validKitJob({ ...job, collisions: ["box"] })).toBe(false);
    expect(validKitJob({ ...job, pivots: ["center"] })).toBe(false);
  });

  it("refuses what the pack command refuses", () => {
    const withPiece = (changed: Record<string, unknown>) => validKitJob({ ...job, pieces: [{ ...job.pieces[0], ...changed }] });
    expect(withPiece({})).toBe(true);
    expect(validKitJob({ ...job, pieces: [] })).toBe(false);
    expect(validKitJob({ ...job, pieces: [{ name: "a" }] })).toBe(false);
    expect(withPiece({ glb: "a.glb" })).toBe(false);
    expect(withPiece({ colour: "red" })).toBe(false);
    expect(withPiece({ bodies: [{ name: "a" }] })).toBe(false);
    expect(withPiece({ bodies: [{ ...bodies[0], positions: [0, 0, 0] }] })).toBe(false);
    expect(withPiece({ sockets: [{ type: "corridor" }] })).toBe(false);
    expect(withPiece({ sockets: [{ side: "+x" }] })).toBe(false);
    expect(validKitJob({ ...job, rows: [] })).toBe(false);
    expect(validKitJob({ ...job, bodies })).toBe(false);
    expect(validKitJob({ ...job, grid: { moduleMeters: 3 } })).toBe(false);
    expect(validKitJob({ ...job, kernel: "another" })).toBe(false);
    expect(validKitJob({ ...job, output: { folder: "out" } })).toBe(false);
    const { grid: _grid, ...noGrid } = job;
    expect(validKitJob(noGrid)).toBe(false);
  });
});

describe("schema/lock.schema.json", () => {
  const nothing = (): undefined => undefined;
  const crate = { name: "Crate", positions: box([0, 0, 0], [400, 400, 400]).positions, color: "#8a5a2b", materialName: "Wood" };
  const family = verifyPack(exportGamePack({ name: "crate", source: MM_Z_UP, rows: [{ name: "small", bodies: [crate], provenance: { part: "crate-small" } }, { name: "large", bodies: [crate] }], revision: "r1", generatedAt: "2026-01-02T03:04:05Z", provenance: { part: "crates" } }).files);
  const asset = verifyPack(exportGamePack({ name: "post", source: MM_Z_UP, bodies: [crate] }).files);
  const kit = verifyPack(exportKitPack(kits["the corridor kit"]!).files);

  it("accepts the lock file of a family, an asset and a kit, in one project", () => {
    let lock = planInstall(family, undefined, nothing).lock;
    lock = planInstall(asset, lock, nothing, { into: "art/props" }).lock;
    lock = planInstall(kit, lock, nothing).lock;
    expect(lock.packs.map((pack) => [pack.name, pack.kind, pack.into])).toEqual([["corridor", "kit", "assets/corridor"], ["crate", "family", "assets/crate"], ["post", "asset", "art/props/post"]]);
    expect(validLock(JSON.parse(lockJson(lock))), JSON.stringify(validLock.errors)).toBe(true);
    expect(validLock({ schema: 1, packs: [] })).toBe(true);
  });

  it("refuses what the package does not read back", () => {
    const lock = JSON.parse(lockJson(planInstall(family, undefined, nothing).lock)) as { schema: number; packs: Record<string, unknown>[] };
    const pack = lock.packs[0]!;
    const files = pack["files"] as Record<string, unknown>[];
    const withPack = (changed: Record<string, unknown>) => validLock({ ...lock, packs: [{ ...pack, ...changed }] });
    const withFile = (changed: Record<string, unknown>) => withPack({ files: [{ ...files[0], ...changed }, ...files.slice(1)] });
    expect(withPack({})).toBe(true);
    expect(validLock({ ...lock, schema: 2 })).toBe(false);
    expect(validLock({ ...lock, guessed: true })).toBe(false);
    expect(withPack({ guessed: true })).toBe(false);
    expect(withPack({ kind: "terrain" })).toBe(false);
    expect(withPack({ digest: "abc" })).toBe(false);
    expect(withPack({ inTheBuild: { revision: "r1" } })).toBe(false);
    for (const into of ["../outside", "/tmp/assets", "assets/../..", "assets\\crate", "C:/assets", "./assets", ""]) expect(withPack({ into }), into).toBe(false);
    for (const path of ["../crate_small.glb", "/crate_small.glb", "a/../../b.glb", "a\\b.glb"]) expect(withFile({ path }), path).toBe(false);
    expect(withFile({ path: "scenes/crate_small.glb" })).toBe(true);
    expect(withFile({ role: "texture" })).toBe(false);
    expect(withFile({ bytes: -1 })).toBe(false);
    expect(withFile({ bytes: 1.5 })).toBe(false);
    expect(withFile({ sha256: (files[0]!["sha256"] as string).toUpperCase() })).toBe(false);
    expect(withFile({ guessed: true })).toBe(false);
  });
});

describe("the schema files", () => {
  it("are what the package publishes, each under an address of its own", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { exports: Record<string, unknown>; files: string[] };
    const published = { "pack.schema.json": schema, "check-report.schema.json": reportSchema, "pack-manifest.schema.json": manifestSchema, "kit-check-report.schema.json": kitReportSchema, "blockout.schema.json": blockoutSchema, "kit-job.schema.json": kitJobSchema, "lock.schema.json": lockSchema };
    expect(readdirSync(join(root, "schema")).sort()).toEqual(Object.keys(published).sort());
    for (const [name, file] of Object.entries(published)) {
      expect(manifest.exports[`./schema/${name}`]).toBe(`./schema/${name}`);
      expect(file["$id"]).toBe(`https://raw.githubusercontent.com/kylebegeman/corbelo-game-export/main/schema/${name}`);
      expect(file["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema");
    }
    expect(manifest.files).toContain("schema");
  });
});
