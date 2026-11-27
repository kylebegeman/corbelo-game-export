// Prints how big the package is: the files in dist/ as shipped, and what a browser build
// pays for each thing it can import from the main entry, bundled into one minified ESM file
// with everything it does not use shaken off.
//
// With --json the same numbers are printed as one JSON object.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

/** What a consumer might import, smallest need first. `null` is the whole entry. */
export const ENTRIES = [
  ["exportGameGlb", "the plain export: a GLB and its facts"],
  ["readPack", "reading a GLB back"],
  ["exportGameAsset", "a game asset: collision, detail levels, texture coordinates, attach points"],
  ["checkGameAsset", "the game checks"],
  ["exportGamePack", "a pack: assets, checks and the manifest"],
  ["readZip", "reading an archive"],
  ["verifyPack", "checking a pack against its manifest"],
  ["planInstall", "the plan of an install, and the lock file after it"],
  ["checkKit", "a kit and its seven checks"],
  ["exportBlockout", "a layout of kit pieces as one scene"],
  ["exportKitPack", "a kit pack: pieces, checks, scenes and the manifest"],
  [null, "everything the main entry exports"],
];

/** What a consumer might import from `corbelo-game-export/messages`, which no import of the main entry carries. */
export const MESSAGE_ENTRIES = [
  ["fillMessage, fillReason, fillTemplate", "saying a result from a catalog of your own"],
  [null, "that and the English catalog"],
];

/** Bundles a file that imports `name` from an entry, or all of it, for a browser. Several names go with commas between. */
export async function bundleOf(name, minify = true, file = "index.js") {
  const entry = JSON.stringify(join(dist, file));
  const contents = name === null ? `export * from ${entry};` : `import { ${name} } from ${entry};\nglobalThis.use = ${name.includes(",") ? `[${name}]` : name};`;
  const result = await build({ stdin: { contents, resolveDir: root, loader: "js" }, bundle: true, platform: "browser", format: "esm", minify, write: false, logLevel: "silent" });
  return result.outputFiles[0].contents;
}

async function measure() {
  const scripts = readdirSync(dist).filter((file) => file.endsWith(".js"));
  const shipped = scripts.reduce((total, file) => total + readFileSync(join(dist, file)).length, 0);
  const entries = [];
  for (const [name, what] of ENTRIES) {
    const minified = await bundleOf(name);
    entries.push({ import: name ?? "*", what, minified: minified.length, gzipped: gzipSync(minified).length });
  }
  const messages = [];
  for (const [name, what] of MESSAGE_ENTRIES) {
    const minified = await bundleOf(name, true, "messages.js");
    messages.push({ import: name ?? "*", what, minified: minified.length, gzipped: gzipSync(minified).length });
  }
  return { shipped: { bytes: shipped, files: scripts.length }, entries, messages };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sizes = await measure();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(sizes));
  } else {
    console.log(`dist/*.js as shipped: ${sizes.shipped.bytes} bytes in ${sizes.shipped.files} files`);
    console.log("Bundled for a browser, minified, with what is not used shaken off:");
    const wide = Math.max(...sizes.entries.map((entry) => entry.import.length));
    for (const entry of sizes.entries) {
      console.log(`  ${entry.import.padEnd(wide)}  ${String(entry.minified).padStart(7)} bytes  ${String(entry.gzipped).padStart(6)} gzipped  ${entry.what}`);
    }
    console.log("From corbelo-game-export/messages, which none of those carry:");
    const wider = Math.max(...sizes.messages.map((entry) => entry.import.length));
    for (const entry of sizes.messages) {
      console.log(`  ${entry.import.padEnd(wider)}  ${String(entry.minified).padStart(7)} bytes  ${String(entry.gzipped).padStart(6)} gzipped  ${entry.what}`);
    }
  }
}
