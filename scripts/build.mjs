// Builds dist/ from src/ with the TypeScript compiler. Pass a directory to build somewhere else.
import { execFileSync } from "node:child_process";
import { chmodSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(process.argv[2] ?? join(root, "dist"));

rmSync(outDir, { recursive: true, force: true });
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", join(root, "tsconfig.build.json"), "--outDir", outDir], {
  cwd: root,
  stdio: "inherit",
});
chmodSync(join(outDir, "cli.js"), 0o755);
