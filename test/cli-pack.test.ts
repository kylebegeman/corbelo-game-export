import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkGameAsset, packToZip, readPack, VERSION, type CheckReport, type PackManifest } from "../src/index.js";
import { checkFile, runCommand, runPackJob, type CliIo } from "../src/node.js";
import { asciiStl, binaryStl, box, cylinder, doorFrame, ell, halfPaintedSide } from "./fixtures.js";
import { counting, loadKernel } from "./kernel.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "corbelo-game-export-pack-"));
  mkdirSync(join(dir, "parts"));
  const write = (name: string, positions: ArrayLike<number>) => writeFileSync(join(dir, "parts", name), binaryStl(positions));
  write("post.stl", cylinder(150, 400, 48).positions);
  write("post-lod1.stl", cylinder(150, 400, 24).positions);
  write("post-lod2.stl", cylinder(150, 400, 12).positions);
  writeFileSync(join(dir, "parts/post-lod2.colors.json"), JSON.stringify(halfPaintedSide(12, "#c0392b")));
  write("frame.stl", doorFrame(3000, 300, 2800, 1200, 2200).positions);
  write("ell.stl", ell(1000, 500).positions);
  // The two blocks the L was made from.
  writeFileSync(join(dir, "parts/ell-a.stl"), asciiStl(box([0, 0, 0], [1000, 500, 500]).positions, "a"));
  write("ell-b.stl", box([0, 500, 0], [500, 1000, 500]).positions);
  write("crate-small.stl", box([0, 0, 0], [400, 400, 400]).positions);
  write("crate-large.stl", box([0, 0, 0], [900, 900, 900]).positions);
  writeFileSync(join(dir, "parts/notes.stl"), "these are notes, not a mesh");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function writeJob(name: string, job: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof job === "string" ? job : JSON.stringify(job));
  return path;
}

async function command(args: string[], stdin?: string): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const io: CliIo = { out: (text) => (out += text), err: (text) => (err += text) };
  if (stdin !== undefined) io.stdin = () => new TextEncoder().encode(stdin);
  const code = await runCommand(args, io);
  return { code, out, err };
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const source = { unit: 0.001, up: "Z" };

const postJob = {
  name: "post",
  source,
  profile: "unreal5",
  bodies: [
    {
      name: "Post",
      stl: "parts/post.stl",
      color: "#8a5a2b",
      materialName: "Wood",
      lods: [{ stl: "parts/post-lod1.stl" }, { stl: "parts/post-lod2.stl", faceColors: "parts/post-lod2.colors.json" }],
      attachPoints: [{ name: "Top", position: [0, 0, 400], direction: [0, 0, 1] }],
    },
  ],
  collision: { shape: "hull", tolerance: 0.1 },
  texcoords: { tileMeters: 0.5 },
  checks: { assetClass: "small-prop" },
  revision: "r7",
  provenance: { order: 42 },
  output: { dir: "out/post", zip: "out/post.zip" },
};

describe("pack command", () => {
  it("runs a job file, writes the folder and the archive and prints one line about them", async () => {
    const { code, out, err } = await command(["pack", writeJob("post.json", postJob)]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.trimEnd()).not.toContain("\n");
    const summary = JSON.parse(out) as { name: string; status: string; dir: string; zip: string; files: { name: string; mediaType: string; bytes: number; sha256?: string; path: string }[] };
    const glbPath = join(dir, "out/post/SM_Post.glb");
    const manifestPath = join(dir, "out/post/SM_Post.pack.json");
    const glb = readFileSync(glbPath);
    expect(summary).toEqual({
      name: "SM_Post",
      status: "pass",
      dir: join(dir, "out/post"),
      zip: join(dir, "out/post.zip"),
      files: [
        { name: "SM_Post.glb", mediaType: "model/gltf-binary", bytes: glb.length, sha256: sha256(glb), path: glbPath },
        { name: "SM_Post.pack.json", mediaType: "application/json", bytes: readFileSync(manifestPath).length, path: manifestPath },
      ],
    });
    expect(readdirSync(join(dir, "out/post")).sort()).toEqual(["SM_Post.glb", "SM_Post.pack.json"]);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackManifest;
    expect(manifest).toMatchObject({ kind: "asset", name: "SM_Post", profile: "unreal5", revision: "r7", status: "pass", assetClass: "small-prop", provenance: { order: 42 } });
    expect(manifest.files[0]).toMatchObject({ name: "SM_Post.glb", bytes: glb.length, sha256: sha256(glb) });
    const pack = readPack(glb);
    expect(manifest.files[0]!.facts).toEqual(pack.facts);
    expect(pack.provenance).toEqual({ order: 42 });
    const [body] = pack.facts!.bodies;
    expect(pack.facts!.settings).toMatchObject({ texcoords: { projection: "box", tileMeters: 0.5 }, collision: { shape: "hull", tolerance: 0.1, kernel: false }, lodLayout: "group" });
    expect(body!.collision).toMatchObject({ requested: "hull", shape: "hull", pieces: 1, nodes: [{ name: "UCX_SM_Post_00" }] });
    expect(body!.lods!.map((level) => [level.name, level.triangles, level.materialSlots])).toEqual([["SM_Post_LOD0", 192, 1], ["SM_Post_LOD1", 96, 1], ["SM_Post_LOD2", 48, 2]]);
    expect(body!.attachPoints).toMatchObject([{ sourceName: "Top", engine: [0, 0, 40] }]);

    // The archive holds the same two files.
    const zip = readFileSync(join(dir, "out/post.zip"));
    expect(zip.subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");
    expect(zip.includes(glb)).toBe(true);
    expect(zip.includes(readFileSync(manifestPath))).toBe(true);
  });

  it("reads the job from standard input, with paths from --base, and writes the same files", async () => {
    const { output: _output, ...job } = postJob;
    const { code, out, err } = await command(["pack", "-", "--base", dir, "--dir", join(dir, "piped")], JSON.stringify(job));
    expect(err).toBe("");
    expect(code).toBe(0);
    const summary = JSON.parse(out) as Record<string, unknown>;
    expect(summary).toMatchObject({ name: "SM_Post", dir: join(dir, "piped") });
    expect(summary).not.toHaveProperty("zip");
    expect(readFileSync(join(dir, "piped/SM_Post.glb")).equals(readFileSync(join(dir, "out/post/SM_Post.glb")))).toBe(true);
    expect(readFileSync(join(dir, "piped/SM_Post.pack.json")).equals(readFileSync(join(dir, "out/post/SM_Post.pack.json")))).toBe(true);
    expect(existsSync(join(dir, "piped.zip"))).toBe(false);
  });

  it("lets --dir and --zip win over the job, and writes only the archive when only that is asked for", async () => {
    const elsewhere = join(dir, "elsewhere/deep/post.zip");
    const { output: _output, ...job } = postJob;
    const only = await command(["pack", writeJob("zip-only.json", job), "--zip", elsewhere]);
    expect(only.code).toBe(0);
    expect(JSON.parse(only.out)).toMatchObject({ zip: elsewhere, files: [{ name: "SM_Post.glb" }, { name: "SM_Post.pack.json" }] });
    expect(JSON.parse(only.out)).not.toHaveProperty("dir");
    expect((JSON.parse(only.out) as { files: object[] }).files[0]).not.toHaveProperty("path");
    expect(readFileSync(elsewhere).equals(readFileSync(join(dir, "out/post.zip")))).toBe(true);
    const moved = await command(["pack", writeJob("post.json", postJob), "--dir", join(dir, "moved")]);
    expect(JSON.parse(moved.out)).toMatchObject({ dir: join(dir, "moved"), zip: join(dir, "out/post.zip") });
    expect(existsSync(join(dir, "moved/SM_Post.glb"))).toBe(true);
  });

  it("packs a family: one GLB for each row, named by the engine's pattern", async () => {
    const job = {
      name: "crate",
      source,
      rows: [
        { name: "small", bodies: [{ name: "Body", stl: "parts/crate-small.stl", color: "#8a5a2b", materialName: "Wood" }], provenance: { size: 400 } },
        { name: "large", bodies: [{ name: "Body", stl: "parts/crate-large.stl", color: "#8a5a2b", materialName: "Wood" }] },
      ],
      output: { dir: "out/crates" },
    };
    const godot = await command(["pack", writeJob("crates.json", job)]);
    expect(godot.err).toBe("");
    expect((JSON.parse(godot.out) as { files: { name: string }[] }).files.map((file) => file.name)).toEqual(["crate_small.glb", "crate_large.glb", "crate.pack.json"]);
    const unreal = await command(["pack", writeJob("crates-unreal.json", { ...job, profile: "unreal5", output: { dir: "out/crates-unreal" } })]);
    expect(readdirSync(join(dir, "out/crates-unreal")).sort()).toEqual(["SM_Crate.pack.json", "SM_Crate_Large.glb", "SM_Crate_Small.glb"]);
    expect(unreal.code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(dir, "out/crates/crate.pack.json"), "utf8")) as PackManifest;
    expect(manifest).toMatchObject({ kind: "family", name: "crate", materials: [{ name: "Wood", files: ["crate_small.glb", "crate_large.glb"] }] });
    expect(manifest.files.map((file) => [file.row, file.provenance])).toEqual([["small", { size: 400 }], ["large", undefined]]);
  });

  it("builds collision from the pieces a body was made from, each an STL file", async () => {
    const job = {
      name: "ell",
      source,
      bodies: [{ name: "Ell", stl: "parts/ell.stl", collisionPieces: [{ stl: "parts/ell-a.stl" }, { stl: "parts/ell-b.stl" }] }],
      output: { dir: "out/ell" },
    };
    const { code, out } = await command(["pack", writeJob("ell.json", job)]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ name: "ell", status: "pass" });
    const pack = readPack(readFileSync(join(dir, "out/ell/ell.glb")));
    expect(pack.facts!.bodies[0]!.collision).toMatchObject({ requested: "auto", shape: "pieces", pieces: 2, withinTolerance: true });
    expect(pack.facts!.bodies[0]!.collision!.nodes.map((node) => node.name)).toEqual(["ell_00-convcolonly", "ell_01-convcolonly"]);
    // Without the pieces the nearest shape is the hull, a sixth too much, and the check fails.
    const { collisionPieces: _pieces, ...bare } = job.bodies[0]!;
    const without = await command(["pack", writeJob("ell-bare.json", { ...job, bodies: [bare], output: { dir: "out/ell-bare" } })]);
    expect(JSON.parse(without.out)).toMatchObject({ status: "fail" });
    expect(without.code).toBe(0);
  });

  it('loads the kernel a job names, "manifold-3d", for a general convex decomposition', async () => {
    const job = { name: "ell", source, bodies: [{ name: "Ell", stl: "parts/ell.stl" }], kernel: "manifold-3d", output: { dir: "out/ell-kernel" } };
    const { code, out, err } = await command(["pack", writeJob("ell-kernel.json", job)]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ status: "pass" });
    const facts = readPack(readFileSync(join(dir, "out/ell-kernel/ell.glb"))).facts!;
    expect(facts.settings.collision).toMatchObject({ kernel: true });
    expect(facts.bodies[0]!.collision).toMatchObject({ shape: "decomposition", pieces: 2, withinTolerance: true });
    expect(facts.bodies[0]!.collision!.volume.error).toBeLessThan(1e-6);
    // A kernel passed to the function wins over the name, and every solid it made is given back.
    const counted = counting(await loadKernel());
    const result = await runPackJob({ ...job, output: undefined }, { base: dir, kernel: counted.kernel });
    expect(result.pack.manifest.files[0]!.facts.bodies[0]!.collision).toMatchObject({ shape: "decomposition", pieces: 2 });
    expect(counted.made()).toBeGreaterThan(0);
    expect(counted.freed()).toBe(counted.made());
    const refused = await command(["pack", writeJob("ell-kernel-bad.json", { ...job, kernel: "some-other-kernel" })]);
    expect(refused.code).toBe(1);
    expect(refused.err).toBe('corbelo-game-export: error [BAD_JOB]: "kernel" must be "manifold-3d", the one kernel a job can name. Got "some-other-kernel".\n');
  });

  it("can be called as a function, and writes nothing when given nowhere to write", async () => {
    const { output: _output, ...job } = postJob;
    const result = await runPackJob(job, { base: dir });
    expect(result).toMatchObject({ name: "SM_Post", status: "pass" });
    expect(result).not.toHaveProperty("dir");
    expect(result).not.toHaveProperty("zip");
    expect(result.files.map((file) => [file.name, file.bytes])).toEqual(result.pack.files.map((file) => [file.name, file.bytes.length]));
    expect(result.files[0]).not.toHaveProperty("path");
    expect(Buffer.from(result.pack.files[0]!.bytes).equals(readFileSync(join(dir, "out/post/SM_Post.glb")))).toBe(true);
    expect(Buffer.from(packToZip(result.pack)).equals(readFileSync(join(dir, "out/post.zip")))).toBe(true);
    // Paths in the job are relative to the working directory when no base is given.
    const absolute = { ...job, bodies: [{ name: "Post", stl: join(dir, "parts/post.stl") }] };
    expect((await runPackJob(absolute)).name).toBe("SM_Post");
  });

  it("needs somewhere to write when run as a command", async () => {
    const { output: _output, ...job } = postJob;
    const { code, out, err } = await command(["pack", writeJob("nowhere.json", job)]);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe('corbelo-game-export: error [BAD_JOB]: Nowhere to write the pack. Set "output.dir" or "output.zip" in the job, or pass --dir or --zip.\n');
  });

  it("refuses keys it does not know, so a typing mistake is not ignored", async () => {
    const refused = async (job: unknown): Promise<string> => {
      const { code, err } = await command(["pack", writeJob("typo.json", job)]);
      expect(code).toBe(1);
      return err;
    };
    const [body] = postJob.bodies;
    expect(await refused({ ...postJob, colision: "box" })).toContain('error [BAD_JOB]: The job has an unknown key "colision". Known keys: name, source, bodies, rows, profile,');
    expect(await refused({ ...postJob, bodies: [{ ...body, lod: [] }] })).toContain('Body 0 has an unknown key "lod". Known keys: name, stl, color, materialName, faceIds, faceColors, faceMaterialNames, refines, lods, collisionPieces, attachPoints.');
    expect(await refused({ ...postJob, bodies: [{ ...body, lods: [{ stl: "parts/post-lod1.stl", color: "#fff" }] }] })).toContain('Body "Post", detail level 1 has an unknown key "color". Known keys: stl, faceIds, faceColors.');
    expect(await refused({ ...postJob, bodies: [{ ...body, collisionPieces: [{ stl: "parts/ell-a.stl", name: "a" }] }] })).toContain('Body "Post", collision piece 0 has an unknown key "name". Known keys: stl.');
    expect(await refused({ ...postJob, output: { folder: "out" } })).toContain('"output" has an unknown key "folder". Known keys: dir, zip.');
    expect(await refused({ name: "crate", source, rows: [{ name: "small", bodies: [{ name: "Body", stl: "parts/crate-small.stl" }], size: 400 }], output: { dir: "x" } })).toContain('Row 0 has an unknown key "size". Known keys: name, bodies, provenance.');
  });

  it("refuses a job that is not valid, and says what is wrong", async () => {
    const refused = async (job: unknown): Promise<string> => {
      const { code, err, out } = await command(["pack", writeJob("bad.json", job)]);
      expect(code).toBe(1);
      expect(out).toBe("");
      return err;
    };
    const [body] = postJob.bodies;
    const { name: _name, ...nameless } = postJob;
    expect(await refused("{ not json")).toMatch(/error \[BAD_JOB\]: The job .*bad\.json is not valid JSON/);
    expect(await refused([])).toContain("error [BAD_JOB]: A pack job must be a JSON object.");
    expect(await refused(nameless)).toContain('The job needs a "name"');
    expect(await refused({ ...postJob, source: "mm" })).toContain('The job needs a "source" object');
    expect(await refused({ ...postJob, rows: [] })).toContain('The job needs "bodies" for one asset or "rows" for a family, and not both.');
    expect(await refused({ ...postJob, bodies: undefined })).toContain('The job needs "bodies" for one asset or "rows" for a family');
    expect(await refused({ ...postJob, bodies: [] })).toContain('The job needs a "bodies" list with at least one body.');
    expect(await refused({ ...postJob, bodies: undefined, rows: [] })).toContain('"rows" must be a list with at least one row.');
    expect(await refused({ ...postJob, bodies: undefined, rows: [{ name: "small", bodies: [] }] })).toContain('Row "small" needs a "bodies" list with at least one body.');
    expect(await refused({ ...postJob, bodies: undefined, rows: [{ bodies: [body] }] })).toContain('Row 0 needs a "name".');
    expect(await refused({ ...postJob, output: "out" })).toContain('"output" must be an object with "dir", "zip" or both.');
    expect(await refused({ ...postJob, output: { dir: 3 } })).toContain('"output.dir" must be a path.');
    expect(await refused({ ...postJob, bodies: [{ ...body, lods: "parts/post-lod1.stl" }] })).toContain('Body "Post": "lods" must be a list of { "stl" }');
    expect(await refused({ ...postJob, bodies: [{ ...body, lods: [{}] }] })).toContain('Body "Post", detail level 1 needs an "stl" file path.');
    expect(await refused({ ...postJob, bodies: [{ ...body, lods: [{ stl: "parts/gone.stl" }] }] })).toMatch(/error \[BAD_JOB\]: Cannot read STL file .*gone\.stl: ENOENT/);
    expect(await refused({ ...postJob, bodies: [{ ...body, lods: [{ stl: "parts/notes.stl" }] }] })).toMatch(/error \[BAD_STL\]: Body "Post", detail level 1 \(.*notes\.stl\)/);
    expect(await refused({ ...postJob, bodies: [{ ...body, collisionPieces: [{}] }] })).toContain('Body "Post", collision piece 0 needs an "stl" file path.');
    expect(await refused({ ...postJob, bodies: [{ ...body, collisionPieces: {} }] })).toContain('Body "Post": "collisionPieces" must be a list of { "stl" }.');
    // What the exporter refuses comes through with its own code.
    expect(await refused({ ...postJob, bodies: [{ ...body, attachPoints: [{ name: "Top" }] }] })).toContain("error [BAD_ATTACH_POINT]");
    expect(await refused({ ...postJob, collision: "sphere" })).toContain("error [BAD_OPTION]");
    expect(await refused({ ...postJob, naming: "{row}" })).toContain("error [BAD_NAME]");
    expect(await refused({ ...postJob, checks: { assetClass: "vehicle" } })).toContain("error [BAD_OPTION]");
    const piped = await command(["pack", "-", "--dir", join(dir, "never")], "{ not json");
    expect(piped.err).toContain("error [BAD_JOB]: The job on standard input is not valid JSON");
    expect((await command(["pack", join(dir, "no-such-job.json")])).err).toMatch(/error \[BAD_JOB\]: Cannot read job file .*no-such-job\.json: ENOENT/);
    expect(existsSync(join(dir, "never"))).toBe(false);
  });

  it("exits with 2 for a wrong command line", async () => {
    expect(await command(["pack"])).toEqual({ code: 2, out: "", err: "corbelo-game-export: pack needs a job file, or - for standard input. Try --help.\n" });
    expect(await command(["pack", "a.json", "b.json"])).toMatchObject({ code: 2, err: "corbelo-game-export: give pack exactly one job file, or - for standard input. Try --help.\n" });
    expect(await command(["pack", "a.json", "--dir"])).toMatchObject({ code: 2, err: "corbelo-game-export: --dir needs a path.\n" });
    expect(await command(["pack", "--fast", "a.json"])).toMatchObject({ code: 2, err: "corbelo-game-export: unknown option --fast for pack. Try --help.\n" });
  });
});

describe("check command", () => {
  const glbPath = (): string => join(dir, "out/post/SM_Post.glb");

  it("prints the report of the game checks as one line of JSON", async () => {
    const { code, out, err } = await command(["check", glbPath()]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out.trimEnd()).not.toContain("\n");
    const report = JSON.parse(out) as CheckReport;
    expect(report).toEqual(JSON.parse(JSON.stringify(checkGameAsset(readFileSync(glbPath())))));
    expect(report).toMatchObject({ schema: 1, profile: "unreal5", assetClass: "small-prop", status: "pass", player: { id: "unreal5-character" } });
    expect(checkFile(glbPath())).toEqual(checkGameAsset(readFileSync(glbPath())));
  });

  it("takes the class from --class and everything else from an options file", async () => {
    const kit = JSON.parse((await command(["check", glbPath(), "--class", "kit-piece"])).out) as CheckReport;
    expect(kit.assetClass).toBe("kit-piece");
    const options = writeJob("check-options.json", { assetClass: "large-prop", player: "godot4", budget: { maxTriangles: 100 } });
    const report = JSON.parse((await command(["check", glbPath(), "--options", options])).out) as CheckReport;
    expect(report).toMatchObject({ assetClass: "large-prop", status: "fail", budget: { maxTriangles: 100, maxVertices: 20000 }, player: { id: "godot4-character-body" } });
    // --class wins over the file.
    const both = JSON.parse((await command(["check", glbPath(), "--options", options, "--class", "kit-piece"])).out) as CheckReport;
    expect(both).toMatchObject({ assetClass: "kit-piece", budget: { maxTriangles: 100, maxVertices: 6000 } });
  });

  it("exits with 3 for a failing check only when asked to be strict", async () => {
    const options = writeJob("check-tight.json", { budget: { maxTriangles: 100 } });
    const lenient = await command(["check", glbPath(), "--options", options]);
    expect(lenient.code).toBe(0);
    const strict = await command(["check", glbPath(), "--options", options, "--strict"]);
    expect(strict.code).toBe(3);
    expect(strict.err).toBe("");
    // The report is printed either way.
    expect(strict.out).toBe(lenient.out);
    expect((await command(["check", glbPath(), "--strict"])).code).toBe(0);
    // A warning is not a failure.
    const warned = await command(["check", glbPath(), "--class", "large-prop", "--strict"]);
    expect((JSON.parse(warned.out) as CheckReport).status).toBe("warn");
    expect(warned.code).toBe(0);
  });

  it("refuses a file it cannot check and options it cannot read", async () => {
    const missing = await command(["check", join(dir, "gone.glb")]);
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toMatch(/^corbelo-game-export: error \[BAD_JOB\]: Cannot read GLB file .*gone\.glb: ENOENT\.\n$/);
    expect((await command(["check", join(dir, "parts/notes.stl")])).err).toContain("error [BAD_GLB]");
    expect((await command(["check", glbPath(), "--class", "vehicle"])).err).toContain("error [BAD_OPTION]");
    expect((await command(["check", glbPath(), "--options", writeJob("check-broken.json", "{ not json")])).err).toMatch(/error \[BAD_JOB\]: The options file .*check-broken\.json is not valid JSON/);
    expect((await command(["check", glbPath(), "--options", join(dir, "gone.json")])).err).toMatch(/error \[BAD_JOB\]: Cannot read options file .*gone\.json: ENOENT/);
    expect((await command(["check", glbPath(), "--options", writeJob("check-typo.json", { gridMeters: -1 })])).err).toContain("error [BAD_OPTION]");
  });

  it("exits with 2 for a wrong command line", async () => {
    expect(await command(["check"])).toEqual({ code: 2, out: "", err: "corbelo-game-export: check needs a GLB file. Try --help.\n" });
    expect(await command(["check", "a.glb", "b.glb"])).toMatchObject({ code: 2, err: "corbelo-game-export: give check exactly one GLB file. Try --help.\n" });
    expect(await command(["check", "a.glb", "--class"])).toMatchObject({ code: 2, err: "corbelo-game-export: --class needs one of small-prop, large-prop, kit-piece.\n" });
    expect(await command(["check", "a.glb", "--options"])).toMatchObject({ code: 2, err: "corbelo-game-export: --options needs the path of a JSON file.\n" });
    expect(await command(["check", "a.glb", "--fast"])).toMatchObject({ code: 2, err: "corbelo-game-export: unknown option --fast for check. Try --help.\n" });
  });
});

describe("the one command line", () => {
  it("still runs a plain job, prints help and its version", async () => {
    const job = { bodies: [{ name: "Post", stl: "parts/post.stl" }], source, output: { glb: "plain/post.glb" } };
    const plain = await command([writeJob("plain.json", job)]);
    expect(plain.err).toBe("");
    expect(plain.code).toBe(0);
    expect(JSON.parse(plain.out)).toMatchObject({ glb: join(dir, "plain/post.glb"), triangles: 192 });
    // A plain GLB has no collision: the checks say so, and still measure the rest.
    const report = JSON.parse((await command(["check", join(dir, "plain/post.glb")])).out) as CheckReport;
    expect(report.results.find((result) => result.id === "collision")).toMatchObject({ status: "not-measured" });
    expect(await command(["--version"])).toEqual({ code: 0, out: `${VERSION}\n`, err: "" });
    const help = await command(["--help"]);
    expect(help.code).toBe(0);
    for (const line of ["corbelo-game-export pack <job.json | ->", "corbelo-game-export check <file.glb>", '"collisionPieces"', '"attachPoints"', '"lods"', '"kernel": "manifold-3d"', "--strict"]) expect(help.out).toContain(line);
    expect(await command([])).toEqual({ code: 2, out: "", err: "corbelo-game-export: no job file given. Try --help.\n" });
  });
});

describe("built pack and check commands", () => {
  const bin = join(root, "dist/cli.js");

  it("reads a job from the real standard input and writes the same pack", () => {
    const { output: _output, ...job } = postJob;
    const result = spawnSync(process.execPath, [bin, "pack", "-", "--base", dir, "--dir", join(dir, "built")], { input: JSON.stringify(job), encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ name: "SM_Post", status: "pass", dir: join(dir, "built") });
    expect(readFileSync(join(dir, "built/SM_Post.glb")).equals(readFileSync(join(dir, "out/post/SM_Post.glb")))).toBe(true);
    expect(readFileSync(join(dir, "built/SM_Post.pack.json")).equals(readFileSync(join(dir, "out/post/SM_Post.pack.json")))).toBe(true);
  });

  it("checks a file, and exits with 3 on a failing check with --strict", () => {
    const options = writeJob("built-tight.json", { budget: { maxTriangles: 100 } });
    const strict = spawnSync(process.execPath, [bin, "check", join(dir, "out/post/SM_Post.glb"), "--options", options, "--strict"], { encoding: "utf8" });
    expect(strict.status).toBe(3);
    expect((JSON.parse(strict.stdout) as CheckReport).status).toBe("fail");
    const refused = spawnSync(process.execPath, [bin, "pack", "-"], { input: "{}", encoding: "utf8" });
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toMatch(/^corbelo-game-export: error \[BAD_JOB\]: The job needs a "name"/);
  });

  it("loads the kernel by name in the built program too", () => {
    const job = { name: "ell", source, bodies: [{ name: "Ell", stl: "parts/ell.stl" }], kernel: "manifold-3d" };
    const result = spawnSync(process.execPath, [bin, "pack", "-", "--base", dir, "--dir", join(dir, "built-kernel")], { input: JSON.stringify(job), encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(readFileSync(join(dir, "built-kernel/ell.glb")).equals(readFileSync(join(dir, "out/ell-kernel/ell.glb")))).toBe(true);
  });
});
