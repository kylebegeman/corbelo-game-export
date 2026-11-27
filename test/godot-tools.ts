// Running Godot 4 with no window, for the proofs that need a real engine.
//
// They need a `godot` 4 program on PATH (or its path in the GODOT environment variable).
// Without one they are skipped, and a line on standard error says why.
import { spawnSync } from "node:child_process";
import { expect } from "vitest";

export const GODOT = process.env["GODOT"] ?? "godot";
export const BEGIN = "CORBELO_GAME_EXPORT_JSON_BEGIN";
export const END = "CORBELO_GAME_EXPORT_JSON_END";

function godotVersion(): string | null {
  const result = spawnSync(GODOT, ["--version"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Whether Godot 4 is there. When it is not, says once on standard error that `what` is skipped. */
export function godotUsable(what: string): boolean {
  const version = godotVersion();
  const usable = version !== null && version.startsWith("4.");
  if (!usable) {
    console.warn(
      version === null
        ? `Skipping ${what}: no "${GODOT}" program was found. Install Godot 4 or set GODOT to its path.`
        : `Skipping ${what}: it needs Godot 4, but "${GODOT}" is version ${version}.`,
    );
  }
  return usable;
}

/** Runs Godot with no window in a project and returns what it printed. It has to end well. */
export function runGodot(project: string, args: readonly string[]): string {
  const result = spawnSync(GODOT, ["--headless", "--path", project, ...args], { encoding: "utf8", timeout: 180_000 });
  const output = `${result.stdout}\n${result.stderr}`;
  expect(result.status, `godot ${args.join(" ")} failed:\n${output}`).toBe(0);
  return output;
}

/** The JSON a script printed between the two marks. */
export function reportOf<T>(output: string): T {
  const start = output.indexOf(BEGIN);
  const end = output.indexOf(END);
  expect(start >= 0 && end > start, `the Godot script printed no report:\n${output}`).toBe(true);
  return JSON.parse(output.slice(start + BEGIN.length, end)) as T;
}
