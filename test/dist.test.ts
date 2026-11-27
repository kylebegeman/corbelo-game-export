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
    expect(code.length).toBeLessThan(100_000);
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
    for (const text of ["player-openings", "KHR_node_visibility", ".pack.json", "ZIP can hold", "maxHullVertices", "{family}", "TEXCOORD_1"]) expect(code.includes(text), text).toBe(false);
    // 29,100 bytes before game assets. The writer it shares with them can now also write
    // detail levels and texture coordinates, which is the difference.
    expect(code.length).toBeLessThan(32_000);
  });

  it("charges for each larger thing only what that thing needs", async () => {
    const reader = await bundle("readPack");
    expect(used(reader.modules)).toEqual(["errors", "glb-read", "gltf"]);
    expect(reader.code.length).toBeLessThan(6_000);
    // The checks read a file: they bring no exporter, no collision and no pack.
    const checks = await bundle("checkGameAsset");
    expect(used(checks.modules)).toEqual(["checks", "errors", "glb-read", "gltf", "profiles", "version"]);
    expect(checks.code.length).toBeLessThan(30_000);
    // An asset brings collision, detail levels and texture coordinates, and no checks, pack or archive.
    const asset = await bundle("exportGameAsset");
    for (const name of ["checks", "pack", "zip", "sha256", "naming", "glb-read", "stl"]) expect(asset.modules[name] ?? 0, name).toBe(0);
    for (const name of ["asset", "collision", "hull", "lod", "uv", "export"]) expect(asset.modules[name], name).toBeGreaterThan(0);
    expect(asset.code.length).toBeLessThan(56_000);
    // A pack is all of it but the STL reader.
    const pack = await bundle("exportGamePack");
    expect(pack.modules["stl"] ?? 0).toBe(0);
    expect(pack.code.length).toBeLessThan(92_000);
    // The small tools stand alone.
    expect(used((await bundle("writeZip")).modules)).toEqual(["errors", "zip"]);
    expect(used((await bundle("sha256Hex")).modules)).toEqual(["sha256"]);
    expect(used((await bundle("convexHull")).modules)).toEqual(["hull"]);
    expect(used((await bundle("assetName")).modules)).toEqual(["errors", "names", "naming"]);
  });
});
