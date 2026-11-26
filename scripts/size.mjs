// Prints how big the package is: the files in dist/ as shipped, and the main entry
// bundled into one minified ESM file the way a browser build would use it.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const scripts = readdirSync(dist).filter((file) => file.endsWith(".js"));
const shipped = scripts.reduce((total, file) => total + readFileSync(join(dist, file)).length, 0);

async function bundle(minify) {
  const result = await build({ entryPoints: [join(dist, "index.js")], bundle: true, platform: "browser", format: "esm", minify, write: false, logLevel: "silent" });
  return result.outputFiles[0].contents;
}

const plain = await bundle(false);
const minified = await bundle(true);

console.log(`dist/*.js as shipped:            ${shipped} bytes in ${scripts.length} files`);
console.log(`dist/index.js bundled:           ${plain.length} bytes`);
console.log(`dist/index.js bundled, minified: ${minified.length} bytes (${gzipSync(minified).length} bytes gzipped)`);
