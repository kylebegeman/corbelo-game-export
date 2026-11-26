// Fails when the committed dist/ is not what src/ builds to.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .sort();
}

const fresh = mkdtempSync(join(tmpdir(), "corbelo-game-export-dist-"));
try {
  execFileSync(process.execPath, [join(root, "scripts/build.mjs"), fresh], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  const expected = listFiles(fresh);
  const actual = listFiles(dist);
  const problems = [];
  for (const file of expected) {
    if (!actual.includes(file)) problems.push(`missing from dist: ${file}`);
    else if (!readFileSync(join(fresh, file)).equals(readFileSync(join(dist, file)))) problems.push(`out of date: ${file}`);
  }
  for (const file of actual) {
    if (!expected.includes(file)) problems.push(`no longer built: ${file}`);
  }
  if (problems.length > 0) {
    console.error(`dist/ is stale. Run "npm run build" and commit the result.\n${problems.map((line) => `  ${line}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`dist/ is up to date (${expected.length} files).`);
  }
} finally {
  rmSync(fresh, { recursive: true, force: true });
}
