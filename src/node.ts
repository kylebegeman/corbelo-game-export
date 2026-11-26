import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GameExportError, refuse } from "./errors.js";
import { exportGameGlb } from "./export.js";
import { readStl } from "./stl.js";
import type { BodyInput, ColorInput, ExportInput, ExportOptions, PackFacts, SourceSpace } from "./types.js";
import { VERSION } from "./version.js";

/** One body of a job: an STL file plus what the file cannot say about itself. */
export interface JobBody {
  name: string;
  /** Path to a binary or ASCII STL file, relative to the job file. */
  stl: string;
  color?: ColorInput;
  materialName?: string;
}

/** The JSON job file the command line reads. Options are the same as `exportGameGlb` takes. */
export interface JobFile extends ExportOptions {
  bodies: JobBody[];
  source: SourceSpace;
  /** Where to write, relative to the job file. Command-line flags win over these. */
  output?: { glb?: string; facts?: string };
}

export interface JobResult {
  /** Absolute path of the GLB written. */
  glb: string;
  /** Absolute path of the facts JSON written. */
  facts: string;
  /** Size of the GLB. */
  bytes: number;
  report: PackFacts;
}

const JOB_KEYS = ["bodies", "source", "profile", "pivot", "placement", "creaseAngle", "normals", "weldTolerance", "maxTriangles", "colorSpace", "provenance", "output"];
const BODY_KEYS = ["name", "stl", "color", "materialName"];
const OUTPUT_KEYS = ["glb", "facts"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refuseUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) refuse("BAD_JOB", `${where} has an unknown key "${key}". Known keys: ${allowed.join(", ")}.`);
  }
}

function readFile(path: string, what: string): Uint8Array {
  try {
    return readFileSync(path);
  } catch (error) {
    return refuse("BAD_JOB", `Cannot read ${what} ${path}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}.`);
  }
}

/**
 * Runs a job file: reads its STL bodies, exports them and writes the GLB and the facts JSON.
 * `overrides` replace the job's output paths and are taken relative to the working directory.
 */
export function runJob(jobPath: string, overrides: { glb?: string; facts?: string } = {}): JobResult {
  const jobFile = resolve(jobPath);
  const base = dirname(jobFile);
  let job: unknown;
  try {
    job = JSON.parse(new TextDecoder().decode(readFile(jobFile, "job file")));
  } catch (error) {
    if (error instanceof GameExportError) throw error;
    refuse("BAD_JOB", `The job file ${jobFile} is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(job)) refuse("BAD_JOB", "The job file must hold a JSON object.");
  refuseUnknownKeys(job, JOB_KEYS, "The job");
  if (!Array.isArray(job["bodies"]) || job["bodies"].length === 0) refuse("BAD_JOB", "The job needs a \"bodies\" list with at least one body.");
  if (!isRecord(job["source"])) refuse("BAD_JOB", "The job needs a \"source\" object, for example { \"unit\": 0.001, \"up\": \"Z\" }.");
  const output = job["output"] ?? {};
  if (!isRecord(output)) refuse("BAD_JOB", "\"output\" must be an object with \"glb\" and optionally \"facts\".");
  refuseUnknownKeys(output, OUTPUT_KEYS, "\"output\"");
  for (const key of OUTPUT_KEYS) {
    if (output[key] !== undefined && (typeof output[key] !== "string" || output[key] === "")) refuse("BAD_JOB", `"output.${key}" must be a file path.`);
  }

  const glb = overrides.glb !== undefined ? resolve(overrides.glb) : typeof output["glb"] === "string" ? resolve(base, output["glb"]) : undefined;
  if (glb === undefined) refuse("BAD_JOB", "Nowhere to write the GLB. Set \"output.glb\" in the job or pass --out.");
  const facts =
    overrides.facts !== undefined
      ? resolve(overrides.facts)
      : typeof output["facts"] === "string"
        ? resolve(base, output["facts"])
        : glb.replace(/\.glb$/i, "") + ".facts.json";

  const bodies: BodyInput[] = job["bodies"].map((entry: unknown, index: number) => {
    if (!isRecord(entry)) refuse("BAD_JOB", `Body ${index} must be an object with "name" and "stl".`);
    refuseUnknownKeys(entry, BODY_KEYS, `Body ${index}`);
    if (typeof entry["name"] !== "string" || entry["name"].trim() === "") refuse("BAD_JOB", `Body ${index} needs a "name".`);
    if (typeof entry["stl"] !== "string" || entry["stl"] === "") refuse("BAD_JOB", `Body "${entry["name"]}" needs an "stl" file path.`);
    const stlPath = resolve(base, entry["stl"]);
    let positions: Float32Array;
    try {
      positions = readStl(readFile(stlPath, "STL file")).positions;
    } catch (error) {
      if (error instanceof GameExportError && error.code === "BAD_STL") refuse("BAD_STL", `Body "${entry["name"]}" (${stlPath}): ${error.message}`);
      throw error;
    }
    const body: BodyInput = { name: entry["name"], positions };
    if (entry["color"] !== undefined) body.color = entry["color"] as ColorInput;
    if (entry["materialName"] !== undefined) body.materialName = entry["materialName"] as string;
    return body;
  });

  const { bodies: _bodies, output: _output, ...options } = job;
  const result = exportGameGlb({ ...(options as unknown as Omit<ExportInput, "bodies">), bodies });
  mkdirSync(dirname(glb), { recursive: true });
  writeFileSync(glb, result.glb);
  mkdirSync(dirname(facts), { recursive: true });
  writeFileSync(facts, `${JSON.stringify(result.facts, null, 2)}\n`);
  return { glb, facts, bytes: result.glb.length, report: result.facts };
}

const HELP = `corbelo-game-export ${VERSION}

Turns STL bodies into one game-engine-ready GLB and a facts JSON file.

Usage:
  corbelo-game-export <job.json> [--out <file.glb>] [--facts <file.json>]

The job file is JSON:
  {
    "bodies": [{ "name": "Block", "stl": "block.stl", "color": "#d98a3d" }],
    "source": { "unit": 0.001, "up": "Z" },
    "profile": "godot4",
    "pivot": "base-center",
    "output": { "glb": "block.glb" }
  }

Paths in the job are relative to the job file. --out and --facts are relative to the
working directory and win over the job. Without a facts path, the facts go next to the
GLB as <name>.facts.json.

On success one line of JSON is printed: the two paths, the GLB size and the totals.
On failure a line "corbelo-game-export: error [CODE]: message" goes to standard error
and the exit code is 1. A wrong command line exits with 2.
`;

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

/** The command line. Returns the exit code and never throws. */
export function runCli(argv: readonly string[], io: CliIo = { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text) }): number {
  let jobPath: string | undefined;
  const overrides: { glb?: string; facts?: string } = {};
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at]!;
    if (arg === "--help" || arg === "-h") {
      io.out(HELP);
      return 0;
    }
    if (arg === "--version" || arg === "-v") {
      io.out(`${VERSION}\n`);
      return 0;
    }
    if (arg === "--out" || arg === "--facts") {
      const value = argv[at + 1];
      if (value === undefined || value.startsWith("--")) {
        io.err(`corbelo-game-export: ${arg} needs a file path.\n`);
        return 2;
      }
      overrides[arg === "--out" ? "glb" : "facts"] = value;
      at += 1;
    } else if (arg.startsWith("-")) {
      io.err(`corbelo-game-export: unknown option ${arg}. Try --help.\n`);
      return 2;
    } else if (jobPath === undefined) {
      jobPath = arg;
    } else {
      io.err("corbelo-game-export: give exactly one job file. Try --help.\n");
      return 2;
    }
  }
  if (jobPath === undefined) {
    io.err("corbelo-game-export: no job file given. Try --help.\n");
    return 2;
  }
  try {
    const result = runJob(jobPath, overrides);
    const { bodies, triangles, vertices, materialSlots } = result.report.total;
    io.out(`${JSON.stringify({ glb: result.glb, facts: result.facts, bytes: result.bytes, bodies, triangles, vertices, materialSlots })}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof GameExportError ? error.code : "UNEXPECTED";
    io.err(`corbelo-game-export: error [${code}]: ${(error as Error).message}\n`);
    return 1;
  }
}
