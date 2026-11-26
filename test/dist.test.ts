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

  it("bundles for a browser with no Node built-ins, and stays small", async () => {
    // A browser build fails outright if the main entry reaches for a Node module.
    const result = await build({ entryPoints: [join(root, "dist/index.js")], bundle: true, platform: "browser", format: "esm", minify: true, write: false, logLevel: "silent" });
    const code = result.outputFiles[0]!.text;
    expect(/["']node:|\brequire\(/.test(code)).toBe(false);
    expect(code.length).toBeLessThan(40_000);
  });
});
