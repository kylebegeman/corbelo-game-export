import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; dependencies?: Record<string, string> };

describe("package", () => {
  it("has a committed dist/ that matches the source", () => {
    const result = spawnSync(process.execPath, [join(root, "scripts/check-dist.mjs")], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("says the same version in the code and in package.json", () => {
    expect(VERSION).toBe(manifest.version);
  });

  it("has no runtime dependencies", () => {
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  /** Bundles a file that imports one name from the main entry, or all of it, the way a browser build would. */
  async function bundle(name: string | null): Promise<{ code: string; modules: Record<string, number> }> {
    const entry = JSON.stringify(join(root, "dist/index.js"));
    const contents = name === null ? `export * from ${entry};` : `import { ${name} } from ${entry};\nglobalThis.use = ${name};`;
    const result = await build({ stdin: { contents, resolveDir: root, loader: "js" }, bundle: true, platform: "browser", format: "esm", minify: true, write: false, metafile: true, logLevel: "silent" });
    const inputs = Object.values(result.metafile.outputs)[0]!.inputs;
    // The bytes each module of dist/ put into the bundle, by its file name without ".js".
    const modules = Object.fromEntries(Object.entries(inputs).filter(([file]) => file.includes("dist/")).map(([file, input]) => [file.slice(file.lastIndexOf("/") + 1, -3), input.bytesInOutput]));
    return { code: result.outputFiles[0]!.text, modules };
  }

  const used = (modules: Record<string, number>): string[] => Object.keys(modules).filter((name) => modules[name]! > 0).sort();

  it("bundles for a browser with no Node built-ins, and stays small", async () => {
    // A browser build fails outright if the main entry reaches for a Node module.
    const { code } = await bundle(null);
    expect(/["']node:|\brequire\(/.test(code)).toBe(false);
    // 90,673 bytes before kits. Kits, their checks, blockouts and installs are the difference.
    expect(code.length).toBeLessThan(165_000);
  });

  it("does no work when it is imported, so a bundler may drop what is not used", async () => {
    expect((JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { sideEffects?: boolean }).sideEffects).toBe(false);
    // Importing the entry and using nothing leaves nothing.
    const entry = JSON.stringify(join(root, "dist/index.js"));
    const result = await build({ stdin: { contents: `import ${entry};`, resolveDir: root, loader: "js" }, bundle: true, platform: "browser", format: "esm", minify: true, write: false, logLevel: "silent" });
    expect(result.outputFiles[0]!.text.trim()).toBe("");
  });

  it("charges a consumer that only writes a GLB nothing for assets, checks, collision or packs", async () => {
    const { code, modules } = await bundle("exportGameGlb");
    expect(used(modules)).toEqual(["errors", "export", "glb-write", "gltf", "materials", "mesh", "names", "profiles", "space", "version"]);
    for (const text of ["player-openings", "KHR_node_visibility", ".pack.json", "ZIP can hold", "maxHullVertices", "{family}", "TEXCOORD_1", "collision-tiles", "blockout", ".lock.json", "moduleMeters"]) expect(code.includes(text), text).toBe(false);
    // 29,100 bytes before game assets. The writer it shares with them can now also write
    // detail levels and texture coordinates, which is the difference. Kits added nothing to it.
    expect(code.length).toBeLessThan(32_000);
  });

  it("charges for each larger thing only what that thing needs", async () => {
    const reader = await bundle("readPack");
    expect(used(reader.modules)).toEqual(["errors", "glb-read", "gltf"]);
    expect(reader.code.length).toBeLessThan(6_000);
    // The checks read a file: they bring no exporter, no collision and no pack.
    const checks = await bundle("checkGameAsset");
    expect(used(checks.modules)).toEqual(["checks", "errors", "glb-read", "gltf", "version"]);
    expect(checks.code.length).toBeLessThan(30_000);
    // An asset brings collision, detail levels and texture coordinates, and no checks, pack or archive.
    const asset = await bundle("exportGameAsset");
    for (const name of ["checks", "pack", "zip", "sha256", "naming", "glb-read", "stl"]) expect(asset.modules[name] ?? 0, name).toBe(0);
    for (const name of ["asset", "collision", "hull", "lod", "uv", "export"]) expect(asset.modules[name], name).toBeGreaterThan(0);
    expect(asset.code.length).toBeLessThan(56_000);
    // A pack is all of that but the STL reader, and nothing of kits or installs.
    const pack = await bundle("exportGamePack");
    for (const name of ["stl", "kit", "kit-checks", "kit-pack", "blockout", "lock", "unzip", "zip"]) expect(pack.modules[name] ?? 0, name).toBe(0);
    expect(pack.code.length).toBeLessThan(92_000);
    // The small tools stand alone.
    expect(used((await bundle("writeZip")).modules)).toEqual(["errors", "zip"]);
    expect(used((await bundle("sha256Hex")).modules)).toEqual(["sha256"]);
    expect(used((await bundle("convexHull")).modules)).toEqual(["hull"]);
    expect(used((await bundle("assetName")).modules)).toEqual(["errors", "names", "naming"]);
  });

  it("keeps the catalog of messages out of the main entry, as an entry of its own", async () => {
    // A result carries its key and its English text. The templates and the function that fills
    // one are for a caller that says the checks in other words, and for no one else.
    for (const name of ["checkGameAsset", "exportGamePack", "checkKit", "exportKitPack", null]) {
      const { code, modules } = await bundle(name);
      for (const file of ["messages", "message-catalog", "message-fill"]) expect(modules[file] ?? 0, `${String(name)}: ${file}`).toBe(0);
      for (const text of [", plural, ", ", select, ", "PluralRules"]) expect(code.includes(text), `${String(name)}: ${text}`).toBe(false);
    }
    const entry = JSON.stringify(join(root, "dist/messages.js"));
    const contents = `import { ENGLISH_MESSAGES, fillMessage, fillReason, fillTemplate, MESSAGE_KEYS, missingMessageKeys } from ${entry};\nglobalThis.use = [ENGLISH_MESSAGES, fillMessage, fillReason, fillTemplate, MESSAGE_KEYS, missingMessageKeys];`;
    const result = await build({ stdin: { contents, resolveDir: root, loader: "js" }, bundle: true, platform: "browser", format: "esm", minify: true, write: false, metafile: true, logLevel: "silent" });
    const inputs = Object.entries(Object.values(result.metafile.outputs)[0]!.inputs).filter(([file, input]) => file.includes("dist/") && input.bytesInOutput > 0).map(([file]) => file);
    // It stands alone: the catalog brings no check, no reader and no exporter with it.
    expect(inputs.map((file) => file.slice(file.lastIndexOf("/") + 1)).sort()).toEqual(["message-catalog.js", "message-fill.js"]);
    const code = result.outputFiles[0]!.text;
    expect(/["']node:|\brequire\(/.test(code)).toBe(false);
    expect(code.length).toBeLessThan(17_000);
    // A caller with a catalog of its own carries the functions that fill, and not the English catalog.
    const filler = await build({ stdin: { contents: `import { fillMessage, fillReason, fillTemplate } from ${entry};\nglobalThis.use = [fillMessage, fillReason, fillTemplate];`, resolveDir: root, loader: "js" }, bundle: true, platform: "browser", format: "esm", minify: true, write: false, logLevel: "silent" });
    expect(filler.outputFiles[0]!.text.includes("longest side")).toBe(false);
    expect(filler.outputFiles[0]!.text.length).toBeLessThan(2_000);
  });

  it("is found by the name of the package, with the catalog under its own name", () => {
    const script = [
      'const main = await import("corbelo-game-export");',
      'const messages = await import("corbelo-game-export/messages");',
      'const report = main.checkGameAsset(main.exportGameGlb({ bodies: [{ name: "Block", positions: [0,0,0, 1,0,0, 0,1,0, 0,0,0, 0,0,1, 1,0,0, 0,0,0, 0,1,0, 0,0,1, 1,0,0, 0,0,1, 0,1,0] }], source: { unit: 1, up: "Z" } }).glb);',
      "const same = report.results.every((result) => messages.fillMessage(result, messages.ENGLISH_MESSAGES) === result.message && messages.fillReason(result, messages.ENGLISH_MESSAGES) === result.reason);",
      'console.log(JSON.stringify({ main: Object.keys(main).filter((name) => /message|MESSAGE/i.test(name)), messages: Object.keys(messages).sort(), keys: messages.MESSAGE_KEYS.length, missing: messages.missingMessageKeys(messages.ENGLISH_MESSAGES).length, same }));',
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: root, encoding: "utf8" });
    expect(result.stderr).toBe("");
    const said = JSON.parse(result.stdout) as { main: string[]; messages: string[]; keys: number; missing: number; same: boolean };
    expect(said.main).toEqual([]);
    expect(said.messages).toEqual(["ENGLISH_MESSAGES", "MESSAGE_KEYS", "fillMessage", "fillReason", "fillTemplate", "missingMessageKeys"]);
    expect(said.keys).toBeGreaterThan(100);
    expect(said.missing).toBe(0);
    expect(said.same).toBe(true);
  });

  it("charges for kits, blockouts and installs only where they are used", async () => {
    // Installing is reading an archive, checking a pack and planning: no exporter and no kit.
    const unzip = await bundle("readZip");
    expect(used(unzip.modules)).toEqual(["errors", "unzip", "zip"]);
    expect(unzip.code.length).toBeLessThan(5_000);
    const verify = await bundle("verifyPack");
    expect(used(verify.modules)).toEqual(["errors", "lock", "sha256"]);
    expect(verify.code.length).toBeLessThan(7_000);
    const plan = await bundle("planInstall");
    expect(used(plan.modules)).toEqual(["errors", "lock"]);
    expect(plan.code.length).toBeLessThan(5_000);
    expect(used((await bundle("lockJson")).modules)).toEqual(["lock"]);
    expect(used((await bundle("kitLayouts")).modules)).toEqual(["kit"]);
    // The kit checks write each piece as an asset to measure it: no pack, scene, archive or lock file.
    const checks = await bundle("checkKit");
    for (const name of ["pack", "kit-pack", "blockout", "zip", "unzip", "lock", "sha256", "stl"]) expect(checks.modules[name] ?? 0, name).toBe(0);
    for (const name of ["kit", "kit-checks", "asset"]) expect(checks.modules[name], name).toBeGreaterThan(0);
    expect(checks.code.length).toBeLessThan(112_000);
    // A blockout is the pieces in a scene: no checks of either kind.
    const blockout = await bundle("exportBlockout");
    for (const name of ["checks", "kit-checks", "pack", "kit-pack", "zip", "unzip", "lock", "sha256", "stl"]) expect(blockout.modules[name] ?? 0, name).toBe(0);
    expect(blockout.code.length).toBeLessThan(84_000);
    // A kit pack is all of it but the readers of archives and STL, and the lock file.
    const kitPack = await bundle("exportKitPack");
    for (const name of ["stl", "unzip", "lock"]) expect(kitPack.modules[name] ?? 0, name).toBe(0);
    expect(kitPack.code.length).toBeLessThan(140_000);
  });
});
