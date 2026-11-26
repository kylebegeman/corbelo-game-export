import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPack, VERSION, type PackFacts } from "../src/index.js";
import { runCli, runJob } from "../src/node.js";
import { asciiStl, binaryStl, box, chamferedBlock, cylinder, halfPaintedSide } from "./fixtures.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "corbelo-game-export-cli-"));
  mkdirSync(join(dir, "parts"));
  writeFileSync(join(dir, "parts/block.stl"), binaryStl(chamferedBlock([1000, 500, 250], 20).positions));
  writeFileSync(join(dir, "parts/lid.stl"), asciiStl(box([0, 0, 250], [1000, 500, 270]).positions, "lid"));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function writeJob(name: string, job: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof job === "string" ? job : JSON.stringify(job));
  return path;
}

function cli(...args: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const code = runCli(args, { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

const job = {
  bodies: [
    { name: "Block", stl: "parts/block.stl", color: "#d98a3d" },
    { name: "Lid", stl: "parts/lid.stl", color: [0.2, 0.4, 0.6], materialName: "Lid Paint" },
  ],
  source: { unit: 0.001, up: "Z" },
  profile: "unreal5",
  pivot: "origin",
  placement: "designed",
  creaseAngle: 40,
  provenance: { order: 42 },
  output: { glb: "out/pack.glb" },
};

describe("command line", () => {
  it("runs a job file and writes the GLB and the facts", () => {
    const { code, out, err } = cli(writeJob("job.json", job));
    expect(err).toBe("");
    expect(code).toBe(0);
    const summary = JSON.parse(out) as Record<string, unknown>;
    expect(summary).toEqual({
      glb: join(dir, "out/pack.glb"),
      facts: join(dir, "out/pack.facts.json"),
      bytes: readFileSync(join(dir, "out/pack.glb")).length,
      bodies: 2,
      triangles: 56,
      // The job's crease angle of 40 degrees keeps the block's corner triangles soft against
      // their chamfers (35 degrees apart): 48 vertices, not the 96 of the default 30. The lid has 24.
      vertices: 72,
      materialSlots: 2,
    });
    const pack = readPack(readFileSync(join(dir, "out/pack.glb")));
    const facts = JSON.parse(readFileSync(join(dir, "out/pack.facts.json"), "utf8")) as PackFacts;
    expect(facts).toEqual(pack.facts);
    expect(pack.provenance).toEqual({ order: 42 });
    expect(pack.bodies.map((body) => body.name)).toEqual(["Block", "Lid"]);
    expect(facts.profile).toBe("unreal5");
    expect(facts.settings).toMatchObject({ pivot: "origin", placement: "designed", creaseAngle: 40 });
    expect(facts.materials.map((material) => material.name)).toEqual(["color_d98a3d", "Lid_Paint"]);
    expect(facts.total.bounds.meters.size).toEqual([1, 0.27000001072883606, 0.5]);
  });

  it("lets --out and --facts win over the job", () => {
    const glb = join(dir, "elsewhere/a.glb");
    const facts = join(dir, "elsewhere/deep/a.json");
    const { code, out } = cli(writeJob("job.json", job), "--out", glb, "--facts", facts);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ glb, facts });
    expect(existsSync(glb) && existsSync(facts)).toBe(true);
  });

  it("needs somewhere to write", () => {
    const { output: _output, ...noOutput } = job;
    const { code, err } = cli(writeJob("no-output.json", noOutput));
    expect(code).toBe(1);
    expect(err).toBe('corbelo-game-export: error [BAD_JOB]: Nowhere to write the GLB. Set "output.glb" in the job or pass --out.\n');
  });

  it("reports a missing STL file", () => {
    const { code, err, out } = cli(writeJob("missing.json", { ...job, bodies: [{ name: "Gone", stl: "parts/gone.stl" }] }));
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe(`corbelo-game-export: error [BAD_JOB]: Cannot read STL file ${join(dir, "parts/gone.stl")}: ENOENT.\n`);
  });

  it("reports a file that is not STL, naming the body", () => {
    writeFileSync(join(dir, "parts/notes.stl"), "these are notes, not a mesh");
    const { code, err } = cli(writeJob("not-stl.json", { ...job, bodies: [{ name: "Notes", stl: "parts/notes.stl" }] }));
    expect(code).toBe(1);
    expect(err).toContain('error [BAD_STL]: Body "Notes"');
  });

  it("passes on what the exporter refuses", () => {
    const { code, err } = cli(writeJob("limit.json", { ...job, maxTriangles: 10 }));
    expect(code).toBe(1);
    expect(err).toContain("error [TOO_MANY_TRIANGLES]");
    expect(existsSync(join(dir, "limit.glb"))).toBe(false);
  });

  it("reads face ids from a file beside the STL, which keeps a coarse cylinder's side smooth", () => {
    // Eight segments: neighbouring side triangles are 45 degrees apart, past the 30 degree crease.
    const post = cylinder(100, 300, 8);
    writeFileSync(join(dir, "parts/post.stl"), binaryStl(post.positions));
    writeFileSync(join(dir, "parts/post.faces.json"), JSON.stringify(Array.from(post.faceIds)));
    const base = { source: { unit: 0.001, up: "Z" }, output: { glb: "post.glb" } };
    const plain = runJob(writeJob("post-plain.json", { ...base, bodies: [{ name: "Post", stl: "parts/post.stl" }] }));
    const faced = runJob(writeJob("post-faced.json", { ...base, bodies: [{ name: "Post", stl: "parts/post.stl", faceIds: "parts/post.faces.json" }] }));
    expect(plain.report.settings.faceIds).toBe(false);
    expect(faced.report.settings.faceIds).toBe(true);
    expect(faced.report.total.triangles).toBe(plain.report.total.triangles);
    // Faceted: each side quad has its own four corners. Smooth: neighbours share them.
    expect(faced.report.total.vertices).toBeLessThan(plain.report.total.vertices);
  });

  it("refuses face ids that are missing, not JSON, not a list or the wrong count", () => {
    const withIds = (faceIds: unknown): unknown => ({ ...job, bodies: [{ name: "Block", stl: "parts/block.stl", faceIds }] });
    writeFileSync(join(dir, "parts/broken.json"), "[1, 2,");
    writeFileSync(join(dir, "parts/object.json"), '{"ids":[1]}');
    writeFileSync(join(dir, "parts/short.json"), "[1, 2, 3]");
    writeFileSync(join(dir, "parts/half.json"), JSON.stringify(Array.from({ length: 44 }, (_, at) => at + 0.5)));
    expect(cli(writeJob("ids1.json", withIds(7))).err).toContain('error [BAD_JOB]: Body "Block": "faceIds" must be the path of a JSON file');
    expect(cli(writeJob("ids2.json", withIds("parts/none.json"))).err).toMatch(/error \[BAD_JOB\]: Cannot read face id file .*none\.json: ENOENT/);
    expect(cli(writeJob("ids3.json", withIds("parts/broken.json"))).err).toMatch(/error \[BAD_FACE_IDS\]: Body "Block" \(.*broken\.json\): the face id file is not valid JSON/);
    expect(cli(writeJob("ids4.json", withIds("parts/object.json"))).err).toContain("must hold one JSON array of whole numbers");
    expect(cli(writeJob("ids5.json", withIds("parts/short.json"))).err).toContain("faceIds holds 3 ids for 44 triangles");
    expect(cli(writeJob("ids6.json", withIds("parts/half.json"))).err).toContain("not a whole number");
    expect(existsSync(join(dir, "out/pack.glb"))).toBe(true);
  });

  it("reads face colours from a file beside the STL, and writes the body with a slot for each", () => {
    const post = cylinder(100, 300, 8);
    writeFileSync(join(dir, "parts/striped.stl"), binaryStl(post.positions));
    writeFileSync(join(dir, "parts/striped.faces.json"), JSON.stringify(Array.from(post.faceIds)));
    // null is the body's own colour; a colour may be spelled as a hex string or as [r, g, b].
    const colors: unknown[] = halfPaintedSide(8, "#c0392b");
    colors[1] = [192 / 255, 57 / 255, 43 / 255];
    writeFileSync(join(dir, "parts/striped.colors.json"), JSON.stringify(colors));
    const body = { name: "Post", stl: "parts/striped.stl", faceIds: "parts/striped.faces.json", color: "#2980ba" };
    const base = { source: { unit: 0.001, up: "Z" }, output: { glb: "striped.glb" } };
    const plain = runJob(writeJob("striped-plain.json", { ...base, bodies: [body] }));
    const { code, out } = cli(writeJob("striped.json", { ...base, bodies: [{ ...body, faceColors: "parts/striped.colors.json" }] }));
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ bodies: 1, triangles: 32, vertices: plain.report.total.vertices + 4, materialSlots: 2 });
    const pack = readPack(readFileSync(join(dir, "striped.glb")));
    expect(pack.bodies).toHaveLength(1);
    expect(pack.bodies[0]!.surfaces.map((surface) => [surface.material!.name, surface.triangles])).toEqual([
      ["color_c0392b", 8],
      ["color_2980ba", 24],
    ]);
    expect(pack.facts!.bodies[0]!.slots).toEqual([
      { material: "color_c0392b", triangles: 8, vertices: 10 },
      { material: "color_2980ba", triangles: 24, vertices: 28 },
    ]);
  });

  it("refuses face colours that are missing, not JSON, not a list, the wrong count or not colours", () => {
    const refused = (file: string, faceColors: unknown): string => {
      const { code, err } = cli(writeJob(file, { ...job, bodies: [{ name: "Block", stl: "parts/block.stl", faceColors }] }));
      expect(code).toBe(1);
      return err;
    };
    writeFileSync(join(dir, "parts/colors-broken.json"), '["#ff0000",');
    writeFileSync(join(dir, "parts/colors-object.json"), '{"colors":["#ff0000"]}');
    writeFileSync(join(dir, "parts/colors-short.json"), '["#ff0000", null]');
    writeFileSync(join(dir, "parts/colors-bad.json"), JSON.stringify(Array.from({ length: 44 }, (_, at) => (at === 5 ? "crimson" : null))));
    expect(refused("colors1.json", ["#ff0000"])).toContain('error [BAD_JOB]: Body "Block": "faceColors" must be the path of a JSON file holding one colour, or null, per triangle.');
    expect(refused("colors2.json", "parts/none.json")).toMatch(/error \[BAD_JOB\]: Cannot read face colour file .*none\.json: ENOENT/);
    expect(refused("colors3.json", "parts/colors-broken.json")).toMatch(/error \[BAD_FACE_COLORS\]: Body "Block" \(.*colors-broken\.json\): the face colour file is not valid JSON/);
    expect(refused("colors4.json", "parts/colors-object.json")).toMatch(/error \[BAD_FACE_COLORS\]: .* must hold one JSON array of colours\./);
    expect(refused("colors5.json", "parts/colors-short.json")).toContain("error [BAD_FACE_COLORS]: Body \"Block\": faceColors holds 2 entries for 44 triangles");
    expect(refused("colors6.json", "parts/colors-bad.json")).toContain('error [BAD_COLOR]: Body "Block", triangle 5: colour "crimson"');
  });

  it("refuses keys it does not know, so a typing mistake is not ignored", () => {
    expect(cli(writeJob("typo.json", { ...job, pivit: "center" })).err).toContain('error [BAD_JOB]: The job has an unknown key "pivit"');
    expect(cli(writeJob("typo2.json", { ...job, bodies: [{ name: "Block", stl: "parts/block.stl", colour: "#fff" }] })).err).toContain('Body 0 has an unknown key "colour"');
    expect(cli(writeJob("typo3.json", { ...job, output: { glb: "x.glb", fact: "x.json" } })).err).toContain('"output" has an unknown key "fact"');
  });

  it("refuses a job that is not valid", () => {
    expect(cli(writeJob("broken.json", "{ not json")).err).toContain("error [BAD_JOB]: The job file");
    expect(cli(join(dir, "nowhere.json")).err).toContain("error [BAD_JOB]: Cannot read job file");
    expect(cli(writeJob("list.json", [])).err).toContain("must hold a JSON object");
    expect(cli(writeJob("no-bodies.json", { ...job, bodies: [] })).err).toContain('needs a "bodies" list');
    expect(cli(writeJob("no-source.json", { bodies: job.bodies, output: job.output })).err).toContain('needs a "source" object');
    expect(cli(writeJob("no-stl.json", { ...job, bodies: [{ name: "Block" }] })).err).toContain('Body "Block" needs an "stl" file path');
  });

  it("exits with 2 for a wrong command line", () => {
    expect(cli()).toEqual({ code: 2, out: "", err: "corbelo-game-export: no job file given. Try --help.\n" });
    expect(cli("a.json", "b.json").code).toBe(2);
    expect(cli("a.json", "--out").code).toBe(2);
    expect(cli("--fast", "a.json").err).toContain("unknown option --fast");
  });

  it("prints help and its version", () => {
    expect(cli("--help")).toMatchObject({ code: 0, err: "" });
    expect(cli("--help").out).toContain("corbelo-game-export <job.json>");
    expect(cli("--version")).toEqual({ code: 0, out: `${VERSION}\n`, err: "" });
  });

  it("can be called as a function with the same result", () => {
    const result = runJob(writeJob("job.json", job));
    expect(result.glb).toBe(join(dir, "out/pack.glb"));
    expect(result.report.total.triangles).toBe(56);
    expect(result.bytes).toBe(readFileSync(result.glb).length);
  });
});

describe("built command", () => {
  const bin = join(root, "dist/cli.js");

  it("runs as a program and writes the same files", () => {
    const jobPath = writeJob("built.json", { ...job, output: { glb: "built/pack.glb" } });
    const out = execFileSync(process.execPath, [bin, jobPath], { encoding: "utf8" });
    expect(JSON.parse(out)).toMatchObject({ glb: join(dir, "built/pack.glb"), triangles: 56 });
    expect(readFileSync(join(dir, "built/pack.glb")).equals(readFileSync(join(dir, "out/pack.glb")))).toBe(true);
  });

  it("exits with 1 and a message on standard error when it refuses", () => {
    const result = spawnSync(process.execPath, [bin, writeJob("built-bad.json", { ...job, source: { unit: 0, up: "Z" } })], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^corbelo-game-export: error \[BAD_SOURCE_SPACE\]: source\.unit must be a positive number/);
  });

  it("is the program package.json points at, and starts with a Node shebang", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { bin: Record<string, string> };
    expect(manifest.bin).toEqual({ "corbelo-game-export": "dist/cli.js" });
    expect(readFileSync(bin, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});
