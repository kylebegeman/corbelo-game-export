// The published JSON Schema against what the exporter really writes. Every object in the schema
// refuses unknown keys, so a fact added to the code without the schema fails here.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { ENGINE_PROFILES, EXTRAS_KEY, exportGameGlb, readGlb, type ExportInput } from "../src/index.js";
import { box, chamferedBlock, cutCylinder, cylinder, halfPaintedSide, MM_Z_UP, paintedPatch, paintedTop } from "./fixtures.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(root, "schema/pack.schema.json"), "utf8")) as Record<string, unknown>;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validPack = ajv.compile(schema);
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
