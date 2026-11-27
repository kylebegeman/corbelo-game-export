// The message catalog: every key it has, what a template can say, and a catalog of the
// consumer's own in place of the English one. That every text a check really makes is what its
// key and values rebuild is held over the whole suite by plain-words.setup.ts, and
// wording.test.ts brings out every key.
import { describe, expect, it } from "vitest";
import { checkGameAsset, checkKit, CHECK_IDS, exportGameAsset, exportGameGlb, KIT_CHECK_IDS, kitLayouts, resolveKit } from "../src/index.js";
import { ENGLISH_MESSAGES, fillMessage, fillReason, fillTemplate, MESSAGE_KEYS, missingMessageKeys, type MessageCatalog } from "../src/messages.js";
import { box, MM_Z_UP } from "./fixtures.js";
import { corridorKit } from "./kit-fixtures.js";
import { namesIn, notRebuilt } from "./message-keys.js";

/** Every key, written out: one that is taken away or renamed fails here, and a new one is added here. */
const KEYS = [
  "size.expected",
  "size.unexpected",
  "size.units",
  "pivot.off-grid",
  "pivot.far",
  "pivot.none",
  "pivot.same",
  "pivot.own",
  "pivot.body",
  "triangles.budget",
  "vertices.budget",
  "shading.no-normals",
  "shading.back-facing",
  "shading.wide",
  "shading.edges",
  "clean-mesh.found",
  "clean-mesh.clean",
  "clean-mesh.flipped",
  "clean-mesh.inside-out",
  "clean-mesh.non-manifold",
  "clean-mesh.open",
  "clean-mesh.slivers",
  "clean-mesh.dropped",
  "material-slots.budget",
  "collision.none",
  "collision.none.reason",
  "collision.beyond",
  "collision.nearer.refused",
  "collision.nearer.most",
  "collision.nearer.cut",
  "collision.nearer.pieces",
  "collision.nearer.kernel",
  "collision.missing",
  "collision.inwards",
  "collision.inwards.reason",
  "collision.open",
  "collision.open.reason",
  "collision.has-edges",
  "collision.faces-inwards",
  "collision.within",
  "collision.within-each",
  "detail-levels.none",
  "detail-levels.none.reason",
  "detail-levels.found",
  "detail-levels.more",
  "detail-levels.same",
  "detail-levels.open",
  "detail-levels.moved",
  "detail-levels.smaller",
  "player-openings.expected",
  "player-openings.none",
  "player-openings.none.reason",
  "player-openings.passes",
  "player-openings.sill",
  "player-openings.fits-none",
  "player-steps.expected",
  "player-steps.none",
  "player-steps.none.reason",
  "player-steps.climbed",
  "player-steps.tall",
  "player-ramps.expected",
  "player-ramps.none",
  "player-ramps.none.reason",
  "player-ramps.steep",
  "player-ramps.walked",
  "on-grid.off",
  "on-grid.size",
  "on-grid.pivot",
  "on-grid.socket",
  "on-grid.whole",
  "seams.no-sockets",
  "seams.no-sockets.reason",
  "seams.empty",
  "seams.differ",
  "seams.no-pairs",
  "seams.no-pairs.reason",
  "seams.match",
  "in-cells.out",
  "in-cells.piece",
  "in-cells.trim",
  "in-cells.in",
  "in-cells.in-with-trim",
  "layouts.none",
  "layouts.none.reason",
  "layouts.left-out",
  "layouts.skipped.no-piece",
  "layouts.skipped.no-mate",
  "layouts.skipped.no-row",
  "layouts.skipped.no-ring",
  "layouts.open",
  "layouts.layout",
  "layouts.doubled",
  "layouts.blocked",
  "layouts.mismatched",
  "layouts.apart",
  "layouts.apart-by",
  "layouts.overlap",
  "layouts.trim",
  "layouts.no-joints",
  "layouts.no-kernel",
  "layouts.no-kernel.reason",
  "layouts.not-solid",
  "layouts.not-solid.reason",
  "layouts.closed",
  "corners.differ",
  "corners.differ.reason",
  "corners.no-pairs",
  "corners.no-pairs.reason",
  "corners.off",
  "corners.on-edge",
  "corners.match",
  "walkable.blocked",
  "walkable.narrow",
  "walkable.shut",
  "walkable.rise",
  "walkable.slope",
  "walkable.floor",
  "walkable.nothing",
  "walkable.nothing.reason",
  "walkable.passes",
  "collision-tiles.no-sockets",
  "collision-tiles.no-sockets.reason",
  "collision-tiles.no-shapes",
  "collision-tiles.no-shapes.reason",
  "collision-tiles.missing",
  "collision-tiles.empty",
  "collision-tiles.lip",
  "collision-tiles.no-pairs",
  "collision-tiles.no-pairs.reason",
  "collision-tiles.flush",
];

const crate = (): Uint8Array => exportGameAsset({ bodies: [{ name: "Crate", positions: box([0, 0, 0], [500, 500, 500]).positions }], source: MM_Z_UP }).glb;

describe("the keys of the catalog", () => {
  it("are these, each one", () => {
    expect([...MESSAGE_KEYS]).toEqual(KEYS);
    expect(Object.keys(ENGLISH_MESSAGES)).toEqual(KEYS);
    expect(new Set(KEYS).size).toBe(KEYS.length);
  });

  it("start with the id of a check, and a reason has the key of its message", () => {
    const ids = [...CHECK_IDS, ...KIT_CHECK_IDS];
    for (const key of MESSAGE_KEYS) {
      const id = ids.find((one) => key.startsWith(`${one}.`));
      expect(id, key).toBeDefined();
      expect(key.slice(id!.length + 1), key).toMatch(/^[a-z][a-z-]*(\.[a-z][a-z-]*)?$/);
      if (key.endsWith(".reason")) expect(MESSAGE_KEYS, key).toContain(key.slice(0, -".reason".length));
    }
    // No check of an asset shares an id with a check of a kit, so no key is said by both.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("have a template that closes every brace it opens and uses the three kinds only", () => {
    for (const key of MESSAGE_KEYS) {
      const template: string = ENGLISH_MESSAGES[key];
      let depth = 0;
      for (const letter of template) {
        if (letter === "{") depth += 1;
        if (letter === "}") depth -= 1;
        expect(depth, key).toBeGreaterThanOrEqual(0);
      }
      expect(depth, key).toBe(0);
      for (const kind of template.matchAll(/\{\s*\w+\s*,\s*(\w+)/g)) expect(["plural", "select", "join"], `${key}: ${kind[1]}`).toContain(kind[1]);
      // Every choice by a number or a text says what stands for anything else.
      for (const choice of template.matchAll(/, (plural|select), /g)) expect(template.slice(choice.index), key).toContain("other {");
    }
  });
});

describe("fillTemplate", () => {
  it("writes named values in, and picks words by a number and by a text", () => {
    expect(fillTemplate("{count} triangles, against a budget of {budget}.", { count: 12, budget: 2000 })).toBe("12 triangles, against a budget of 2000.");
    const bodies = "{count, plural, one {# body has} other {# bodies have}} no collision shape.";
    expect(fillTemplate(bodies, { count: 1 })).toBe("1 body has no collision shape.");
    expect(fillTemplate(bodies, { count: 3 })).toBe("3 bodies have no collision shape.");
    expect(fillTemplate(bodies, { count: 0 })).toBe("0 bodies have no collision shape.");
    const exact = "{step, plural, =0 {{player} climbs no steps} other {{player} steps up # m}}";
    expect(fillTemplate(exact, { step: 0, player: "Scout" })).toBe("Scout climbs no steps");
    expect(fillTemplate(exact, { step: 0.3, player: "Scout" })).toBe("Scout steps up 0.3 m");
    const pivot = "at {mode, select, center {the middle} origin {the origin} other {a point}}";
    expect(fillTemplate(pivot, { mode: "center" })).toBe("at the middle");
    expect(fillTemplate(pivot, { mode: "min-corner" })).toBe("at a point");
  });

  it("writes a list with what stands between its items, and around each", () => {
    expect(fillTemplate("{names, join, with {, }}", { names: ["a", "b", "c"] })).toBe("a, b, c");
    expect(fillTemplate("{names}", { names: ["a", "b"] })).toBe("a, b");
    expect(fillTemplate("{modules, join, with { by }} modules", { modules: [1, 2, 1.5] })).toBe("1 by 2 by 1.5 modules");
    expect(fillTemplate('{names, join, with { and } each {"#"}}', { names: ["Lid", "Base"] })).toBe('"Lid" and "Base"');
    expect(fillTemplate("{names, join, with {; }}.", { names: [] })).toBe(".");
  });

  it("fills a part that has a key of its own from the catalog, at any depth", () => {
    const found = [
      { key: "clean-mesh.open", values: { count: 2 }, text: "2 open edges" },
      { key: "clean-mesh.slivers", values: { count: 1 }, text: "1 sliver triangle" },
    ];
    expect(fillTemplate(ENGLISH_MESSAGES["clean-mesh.found"], { found }, ENGLISH_MESSAGES)).toBe("The mesh has 2 open edges, 1 sliver triangle.");
    expect(fillTemplate(ENGLISH_MESSAGES["clean-mesh.found"], { found: [{ key: "clean-mesh.open", values: { count: 1 }, text: "said otherwise" }] }, ENGLISH_MESSAGES)).toBe("The mesh has 1 open edge.");
    const own: MessageCatalog = { "clean-mesh.open": "{count} offene Kanten", "collision.has-edges": "„{name}“ hat {edges, join, with { und }}" };
    // A catalog with no template for a part says the part in English, as the result has it.
    expect(fillTemplate("Netz: {found, join, with { + }}", { found }, own)).toBe("Netz: 2 offene Kanten + 1 sliver triangle");
    expect(fillTemplate("{why}", { why: { key: "collision.has-edges", values: { name: "Lid", edges: [found[0]!] } } }, own)).toBe("„Lid“ hat 2 offene Kanten");
    // With no catalog a part is said as the result has it, and a part with no text by its key.
    expect(fillTemplate("Mesh: {found, join, with { + }}", { found })).toBe("Mesh: 2 open edges + 1 sliver triangle");
    expect(fillTemplate("{part}", { part: { key: "clean-mesh.slivers", values: { count: 4 } } }, own)).toBe("clean-mesh.slivers");
  });

  it("leaves a name it was given no value for as it is written, and text with no names alone", () => {
    expect(fillTemplate("{count} of {total}", { count: 2 })).toBe("2 of {total}");
    expect(fillTemplate("Nothing to fill.")).toBe("Nothing to fill.");
    expect(fillTemplate("A # is a sign here.", {})).toBe("A # is a sign here.");
    // A value is written as it is: braces and signs in a name a person gave are not read as a template.
    expect(fillTemplate('"{name}" has {count, plural, one {# edge} other {# edges}}', { name: "{#}", count: 2 })).toBe('"{#}" has 2 edges');
  });

  it("takes a name for what the values and the catalog hold, never for what any object has of itself", () => {
    expect(fillTemplate("{constructor} {toString} {__proto__}", {})).toBe("{constructor} {toString} {__proto__}");
    expect(fillTemplate("{constructor}", { constructor: "a builder" })).toBe("a builder");
    expect(fillTemplate("{part}", { part: { key: "constructor" } }, {})).toBe("constructor");
    const old = { message: "As it was said.", messageKey: "constructor", reason: "Why.", reasonKey: "toString" };
    expect(fillMessage(old, {})).toBe("As it was said.");
    expect(fillReason(old, {})).toBe("Why.");
    // A catalog read from a file may hold what is not text under a key: that is no template.
    expect(fillMessage({ message: "As it was said.", messageKey: "size.expected" }, { "size.expected": 7 as never })).toBe("As it was said.");
  });

  it("picks the form of a number by the language of the catalog", () => {
    const polish = "{count, plural, one {# plik} few {# pliki} many {# plików} other {# pliku}}";
    expect([1, 3, 5, 22, 1.5].map((count) => fillTemplate(polish, { count }, {}, "pl"))).toEqual(["1 plik", "3 pliki", "5 plików", "22 pliki", "1.5 pliku"]);
    // English has two forms, so the same template read as English says the last for all but one.
    expect(fillTemplate(polish, { count: 3 })).toBe("3 pliku");
  });

  it("names every value of a template, however deep in its choices", () => {
    expect([...namesIn(ENGLISH_MESSAGES["player-steps.tall"])].sort()).toEqual(["clears", "player", "rise", "step"]);
    expect([...namesIn(ENGLISH_MESSAGES["pivot.same"])].sort()).toEqual(["grid", "mode", "offGrid"]);
  });
});

describe("a result of a check", () => {
  it("has a key and named values beside its English text, and a reason has its own", () => {
    const report = checkGameAsset(crate());
    const size = report.results[0]!;
    expect(size).toMatchObject({ id: "size", message: "The asset is 0.5 m on its longest side, a size a small prop has.", messageKey: "size.expected", messageValues: { longest: 0.5, unit: "m", assetClass: "small-prop" } });
    expect(Object.keys(size)).toEqual(["id", "status", "message", "messageKey", "messageValues", "values"]);
    const levels = report.results.find((result) => result.id === "detail-levels")!;
    expect(levels).toMatchObject({ status: "not-measured", messageKey: "detail-levels.none", messageValues: {}, reasonKey: "detail-levels.none.reason", reasonValues: {} });
    expect(Object.keys(levels)).toEqual(["id", "status", "message", "messageKey", "messageValues", "reason", "reasonKey", "reasonValues", "values"]);
    for (const result of report.results) {
      expect(result.messageKey, result.id).toMatch(new RegExp(`^${result.id}\\.`));
      expect(result.reasonKey === undefined, result.id).toBe(result.reason === undefined);
    }
    expect(notRebuilt(report)).toEqual([]);
    expect(notRebuilt(checkKit(corridorKit()))).toEqual([]);
  });

  it("is said in English by the catalog as the check said it, and in other words by a catalog of the caller's own", () => {
    const report = checkGameAsset(exportGameGlb({ bodies: [{ name: "Crate", positions: box([0, 0, 0], [500, 500, 500]).positions }], source: MM_Z_UP }).glb, { budget: { maxTriangles: 4 } });
    for (const result of report.results) {
      expect(fillMessage(result, ENGLISH_MESSAGES), result.id).toBe(result.message);
      expect(fillReason(result, ENGLISH_MESSAGES), result.id).toBe(result.reason);
    }
    const german: MessageCatalog = {
      "triangles.budget": "{count} Dreiecke bei einem Budget von {budget} für {assetClass, select, small-prop {ein kleines Requisit} other {ein Teil}}.",
      "collision.none": "Die Datei hat keine Kollisionsform.",
      "collision.none.reason": "Mit der Datei wurde keine Kollision geschrieben.",
    };
    const said = (id: string) => report.results.find((result) => result.id === id)!;
    expect(fillMessage(said("triangles"), german, "de")).toBe("12 Dreiecke bei einem Budget von 4 für ein kleines Requisit.");
    expect(fillMessage(said("collision"), german, "de")).toBe("Die Datei hat keine Kollisionsform.");
    expect(fillReason(said("collision"), german, "de")).toBe("Mit der Datei wurde keine Kollision geschrieben.");
    // What the catalog has no template for is said as the check said it.
    expect(fillMessage(said("vertices"), german, "de")).toBe(said("vertices").message);
    expect(fillReason(said("detail-levels"), german, "de")).toBe(said("detail-levels").reason);
    expect(fillReason(said("size"), german)).toBeUndefined();
  });

  it("from before version 0.1.8, with no key, is said as it was written", () => {
    const old = { id: "size", status: "pass", message: "The asset is 0.5 m on its longest side, a size a small prop has." };
    expect(fillMessage(old, { "size.expected": "Anders." })).toBe(old.message);
    expect(fillReason({ reason: "No collision was written with the file." }, { "collision.none.reason": "Anders." })).toBe("No collision was written with the file.");
    // The rule of this suite is stricter than a reader has to be: a result of this version always has its key.
    expect(notRebuilt({ results: [old] } as never)).not.toEqual([]);
  });

  it("is refused by the rule of this suite when its text is not what its key and values rebuild", () => {
    const report = JSON.parse(JSON.stringify(checkGameAsset(crate()))) as { results: { id: string; message: string; messageKey?: string; messageValues?: Record<string, unknown> }[] };
    expect(notRebuilt(report as never)).toEqual([]);
    report.results[0]!.message = "The asset is half a metre long.";
    report.results[2]!.messageValues!["extra"] = 1;
    delete report.results[3]!.messageValues!["budget"];
    report.results[4]!.messageKey = "shading.unheard-of";
    report.results[5]!.messageKey = "size.expected";
    const wrong = notRebuilt(report as never).join("\n");
    expect(wrong).toContain('"size.expected" rebuilds');
    expect(wrong).toContain('"triangles.budget" is given extra, which its template does not use');
    expect(wrong).toContain('the template of "vertices.budget" uses budget, which it was not given');
    expect(wrong).toContain('the catalog has no "shading.unheard-of"');
    expect(wrong).toContain('clean-mesh: the key "size.expected" does not start with the id of its check');
  });
});

describe("a test layout that was not built", () => {
  it("says why by key too, in the layouts and in the reason of the check", () => {
    const kit = resolveKit(corridorKit((pieces) => [pieces[0]!, pieces[4]!, pieces[5]!]));
    const { skipped } = kitLayouts(kit);
    expect(skipped.map((skip) => [skip.name, skip.reasonKey, skip.reasonValues])).toEqual([
      ["corner", "layouts.skipped.no-piece", { layout: "corner" }],
      ["tee", "layouts.skipped.no-piece", { layout: "tee" }],
      ["cross", "layouts.skipped.no-piece", { layout: "cross" }],
      ["rise", "layouts.skipped.no-piece", { layout: "rise" }],
      ["room", "layouts.skipped.no-piece", { layout: "room" }],
    ]);
    for (const skip of skipped) expect(fillReason(skip, ENGLISH_MESSAGES), skip.name).toBe(skip.reason);
    expect(fillReason(skipped[1]!, { "layouts.skipped.no-piece": "Kein Teil für {layout, select, tee {eine Abzweigung} other {das}}." })).toBe("Kein Teil für eine Abzweigung.");
    const layouts = checkKit(corridorKit((pieces) => [pieces[5]!])).results.find((result) => result.id === "layouts")!;
    expect(layouts).toMatchObject({ status: "not-measured", messageKey: "layouts.none", reasonKey: "layouts.none.reason" });
    expect(fillReason(layouts, ENGLISH_MESSAGES)).toBe(layouts.reason);
    expect(layouts.reason).toMatch(/^"run": No piece has two sockets on opposite sides of one storey\. "corner": /);
  });
});

describe("a catalog of the caller's own", () => {
  it("is whole when it has a template for every key", () => {
    expect(missingMessageKeys(ENGLISH_MESSAGES)).toEqual([]);
    expect(missingMessageKeys({})).toEqual(KEYS);
    const { "size.units": _, ...rest } = ENGLISH_MESSAGES;
    expect(missingMessageKeys(rest)).toEqual(["size.units"]);
    expect(missingMessageKeys({ ...rest, "size.units": 7 as never })).toEqual(["size.units"]);
  });

  it("that is whole says every result with no word of English", () => {
    // Every template in capitals, which no English text of a check is.
    const shouted: MessageCatalog = Object.fromEntries(MESSAGE_KEYS.map((key) => [key, `<${key}>`]));
    for (const report of [checkGameAsset(crate()), checkKit(corridorKit())]) {
      for (const result of report.results) {
        expect(fillMessage(result, shouted)).toBe(`<${result.messageKey}>`);
        if (result.reason !== undefined) expect(fillReason(result, shouted)).toBe(`<${result.reasonKey}>`);
      }
    }
  });
});
