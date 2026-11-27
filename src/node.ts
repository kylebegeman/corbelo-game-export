import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ASSET_BUDGETS, checkGameAsset, type AssetClass, type CheckOptions, type CheckReport } from "./checks.js";
import { manifoldKernel, type CollisionKernel } from "./collision.js";
import { GameExportError, refuse } from "./errors.js";
import { exportGameGlb } from "./export.js";
import { installPack, pinProject, projectStatus, type InstallResult, type ProjectStatus } from "./install.js";
import { LOCK_FILE_NAME } from "./lock.js";
import { exportKitPack, type KitPackInput } from "./kit-pack.js";
import type { KitPieceInput } from "./kit.js";
import { exportGamePack, packToZip, type GamePack, type PackInput } from "./pack.js";
import { readStl } from "./stl.js";
import type {
  AssetBodyInput,
  AssetOptions,
  AttachPointInput,
  BodyInput,
  ColorInput,
  ExportInput,
  ExportOptions,
  JsonValue,
  LodInput,
  PackFacts,
  SourceSpace,
  SurfaceMesh,
} from "./types.js";
import { VERSION } from "./version.js";

export { installPack, pinProject, projectStatus, readPackFiles, readPackFrom, type InstallResult, type ProjectStatus } from "./install.js";

/** One body of a job: an STL file plus what the file cannot say about itself. */
export interface JobBody {
  name: string;
  /** Path to a binary or ASCII STL file, relative to the job file. */
  stl: string;
  color?: ColorInput;
  materialName?: string;
  /**
   * Path to a JSON file, relative to the job file, holding one whole number per triangle of the
   * STL in the file's own order: the CAD face each triangle came from. STL cannot say this itself.
   */
  faceIds?: string;
  /**
   * Path to a JSON file, relative to the job file, holding one entry per triangle of the STL in
   * the file's own order: the colour of that triangle, or `null` for the body's own colour.
   */
  faceColors?: string;
  /** Names for the materials of face colours: `{ "#3a7bd5": "Blue" }`. */
  faceMaterialNames?: Record<string, string>;
  /** The meshes the STL is a finer cut of, to take the shading from. */
  refines?: JobRefinement;
}

/** `refines` of a body in a job. Every path is relative to the job file. */
export interface JobRefinement {
  /** Each an STL file, and optionally a JSON file with one face id per triangle of it. */
  surfaces: { stl: string; faceIds?: string }[];
  /** Path to a JSON file: for each triangle of the body's STL, a triangle of its surface it lies in. */
  triangleOf: string;
  /** Path to a JSON file: for each triangle of the body's STL, the surface it lies in. Needed with more than one surface. */
  surfaceOf?: string;
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
const BODY_KEYS = ["name", "stl", "color", "materialName", "faceIds", "faceColors", "faceMaterialNames", "refines"];
const REFINES_KEYS = ["surfaces", "triangleOf", "surfaceOf"];
const SURFACE_KEYS = ["stl", "faceIds"];
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

interface ListKind {
  what: string;
  holds: string;
  array: string;
  code: "BAD_FACE_IDS" | "BAD_FACE_COLORS" | "BAD_REFINEMENT";
}

const FACE_IDS: ListKind = { what: "face id", holds: "one whole number per triangle", array: "whole numbers", code: "BAD_FACE_IDS" };
const FACE_COLORS: ListKind = { what: "face colour", holds: "one colour, or null, per triangle", array: "colours", code: "BAD_FACE_COLORS" };
const TRIANGLE_OF: ListKind = { what: "refinement", holds: "one whole number per triangle", array: "whole numbers", code: "BAD_REFINEMENT" };
const SURFACE_OF: ListKind = { what: "refinement", holds: "one whole number per triangle", array: "whole numbers", code: "BAD_REFINEMENT" };

/**
 * Reads the JSON array a job names under `key`: something per triangle that an STL file cannot
 * hold. What is in the array, and how many entries it needs, is for the exporter to check.
 * `where` starts the message of a refusal and `key` is the key as the job spells it.
 */
function readList(value: unknown, key: string, where: string, base: string, kind: ListKind): unknown[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value === "") {
    refuse("BAD_JOB", `${where}: "${key}" must be the path of a JSON file holding ${kind.holds}.`);
  }
  const path = resolve(base, value);
  let list: unknown;
  try {
    list = JSON.parse(new TextDecoder().decode(readFile(path, `${kind.what} file`)));
  } catch (error) {
    if (error instanceof GameExportError) throw error;
    refuse(kind.code, `${where} (${path}): the ${kind.what} file is not valid JSON.`);
  }
  if (!Array.isArray(list)) refuse(kind.code, `${where} (${path}): the ${kind.what} file must hold one JSON array of ${kind.array}.`);
  return list;
}

/** Reads an STL file a job names. `where` starts the message of a refusal. */
function readStlFile(path: string, where: string): Float32Array {
  try {
    return readStl(readFile(path, "STL file")).positions;
  } catch (error) {
    if (error instanceof GameExportError && error.code === "BAD_STL") refuse("BAD_STL", `${where} (${path}): ${error.message}`);
    throw error;
  }
}

/** Reads `refines` of a body or of a lower detail level: the STL of each surface and the lists that say where each triangle lies. */
function readRefines(value: unknown, where: string, base: string): BodyInput["refines"] {
  if (!isRecord(value)) refuse("BAD_JOB", `${where}: "refines" must be an object with "surfaces" and "triangleOf".`);
  refuseUnknownKeys(value, REFINES_KEYS, `${where}: "refines"`);
  const listed = value["surfaces"];
  if (!Array.isArray(listed) || listed.length === 0) refuse("BAD_JOB", `${where}: "refines.surfaces" must be a list with at least one surface.`);
  const surfaces = listed.map((entry: unknown, at: number) => {
    const surfaceWhere = `${where}, surface ${at} of "refines"`;
    if (!isRecord(entry)) refuse("BAD_JOB", `${surfaceWhere} must be an object with "stl".`);
    refuseUnknownKeys(entry, SURFACE_KEYS, surfaceWhere);
    if (typeof entry["stl"] !== "string" || entry["stl"] === "") refuse("BAD_JOB", `${surfaceWhere} needs an "stl" file path.`);
    const surface: SurfaceMesh = { positions: readStlFile(resolve(base, entry["stl"]), surfaceWhere) };
    const faceIds = readList(entry["faceIds"], "faceIds", surfaceWhere, base, FACE_IDS);
    if (faceIds !== undefined) surface.faceIds = faceIds as number[];
    return surface;
  });
  const triangleOf = readList(value["triangleOf"], "refines.triangleOf", where, base, TRIANGLE_OF);
  if (triangleOf === undefined) refuse("BAD_JOB", `${where}: "refines" needs "triangleOf", the path of a JSON file holding ${TRIANGLE_OF.holds}.`);
  const surfaceOf = readList(value["surfaceOf"], "refines.surfaceOf", where, base, SURFACE_OF);
  return { surfaces, triangleOf: triangleOf as number[], ...(surfaceOf !== undefined ? { surfaceOf: surfaceOf as number[] } : {}) };
}

/**
 * Reads one body of a job: its STL file and the files that say what an STL cannot. `label` names
 * the body before its own name is known. Returns the entry too, for what a pack job adds to it.
 */
function readBody(entry: unknown, label: string, base: string, keys: readonly string[]): { body: BodyInput; entry: Record<string, unknown>; where: string } {
  if (!isRecord(entry)) refuse("BAD_JOB", `${label} must be an object with "name" and "stl".`);
  refuseUnknownKeys(entry, keys, label);
  if (typeof entry["name"] !== "string" || entry["name"].trim() === "") refuse("BAD_JOB", `${label} needs a "name".`);
  if (typeof entry["stl"] !== "string" || entry["stl"] === "") refuse("BAD_JOB", `Body "${entry["name"]}" needs an "stl" file path.`);
  const where = `Body "${entry["name"]}"`;
  const body: BodyInput = { name: entry["name"], positions: readStlFile(resolve(base, entry["stl"]), where) };
  if (entry["color"] !== undefined) body.color = entry["color"] as ColorInput;
  if (entry["materialName"] !== undefined) body.materialName = entry["materialName"] as string;
  // The exporter checks each list's length against the triangles, and what the entries are.
  const faceIds = readList(entry["faceIds"], "faceIds", where, base, FACE_IDS);
  if (faceIds !== undefined) body.faceIds = faceIds as number[];
  const faceColors = readList(entry["faceColors"], "faceColors", where, base, FACE_COLORS);
  if (faceColors !== undefined) body.faceColors = faceColors as (ColorInput | null)[];
  // Written into the job itself: a name for each colour is short. The exporter checks it.
  if (entry["faceMaterialNames"] !== undefined) body.faceMaterialNames = entry["faceMaterialNames"] as Record<string, string>;
  if (entry["refines"] !== undefined) body.refines = readRefines(entry["refines"], where, base);
  return { body, entry, where };
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

  const bodies: BodyInput[] = job["bodies"].map((entry: unknown, index: number) => readBody(entry, `Body ${index}`, base, BODY_KEYS).body);

  const { bodies: _bodies, output: _output, ...options } = job;
  const result = exportGameGlb({ ...(options as unknown as Omit<ExportInput, "bodies">), bodies });
  mkdirSync(dirname(glb), { recursive: true });
  writeFileSync(glb, result.glb);
  mkdirSync(dirname(facts), { recursive: true });
  writeFileSync(facts, `${JSON.stringify(result.facts, null, 2)}\n`);
  return { glb, facts, bytes: result.glb.length, report: result.facts };
}

/** A lower detail level of a body in a pack job. Every path is relative to the job's folder. */
export interface PackJobLod {
  stl: string;
  /** Path to a JSON file with one face id per triangle of the STL. */
  faceIds?: string;
  /** Path to a JSON file with one colour, or null, per triangle of the STL. */
  faceColors?: string;
  /** What the level was cut from, as `refines` of a body. */
  refines?: JobRefinement;
}

/** One body of a pack job: a body of a job, and what a game asset has around it. */
export interface PackJobBody extends JobBody {
  /** Lower detail levels, the nearest to full detail first. */
  lods?: PackJobLod[];
  /** The pieces the body was made from, each an STL file. Only their points are used. */
  collisionPieces?: { stl: string }[];
  /** The rest of the body beside its pieces, as one closed STL: what a decomposition cuts up in place of the whole body. */
  collisionRemainder?: { stl: string };
  attachPoints?: AttachPointInput[];
}

/**
 * The JSON job the `pack` command reads. Options are the ones `exportGamePack` takes, with
 * files in place of numbers and the name of a kernel in place of the kernel.
 */
export interface PackJob extends Omit<AssetOptions, "kernel"> {
  name: string;
  source: SourceSpace;
  bodies?: PackJobBody[];
  rows?: { name: string; bodies: PackJobBody[]; provenance?: JsonValue }[];
  naming?: string;
  checks?: false | CheckOptions;
  generatedAt?: string;
  revision?: string;
  /** `"manifold-3d"` loads that package, which must be installed, for general convex decomposition. */
  kernel?: "manifold-3d";
  /** Where to write, relative to the job's folder: every file into `dir`, one archive at `zip`, or both. */
  output?: { dir?: string; zip?: string };
}

/** One piece of a kit job: its bodies as a pack job gives them, or a GLB this package wrote, as a file. */
export interface KitJobPiece extends Omit<KitPieceInput, "bodies" | "glb"> {
  bodies?: PackJobBody[];
  /** Path to a GLB this package wrote, relative to the job's folder. */
  glb?: string;
}

/**
 * The JSON job the `pack` command reads for a kit: what `exportKitPack` takes, with files in
 * place of numbers and the name of a kernel in place of the kernel. A job with `pieces` is a kit.
 */
export interface KitJob extends Omit<KitPackInput, "kernel" | "pieces" | "checks"> {
  pieces: KitJobPiece[];
  /** Options for the kit checks, without a kernel: the one the job names is used. */
  checks?: false | Omit<NonNullable<Exclude<KitPackInput["checks"], false>>, "kernel">;
  /** `"manifold-3d"` loads that package, which must be installed: for general convex decomposition, and to measure what two pieces both fill. */
  kernel?: "manifold-3d";
  output?: { dir?: string; zip?: string };
}

export interface PackJobOptions {
  /** The folder paths in the job are relative to. Default: the working directory. */
  base?: string;
  /** Replace the job's output paths. Relative to the working directory. */
  dir?: string;
  zip?: string;
  /** A kernel to use in place of the one the job names. */
  kernel?: CollisionKernel;
}

export interface PackJobResult {
  /** The pack's name. */
  name: string;
  /** The worst result of the game checks, when they ran. */
  status?: "pass" | "warn" | "fail";
  /** Absolute path of the folder the files were written into, when one was asked for. */
  dir?: string;
  /** Absolute path of the archive, when one was asked for. */
  zip?: string;
  /** Every file of the pack. `path` is where it was written, when a folder was asked for. */
  files: { name: string; mediaType: string; bytes: number; sha256?: string; path?: string }[];
  pack: GamePack;
}

const PACK_JOB_KEYS = [
  "name",
  "source",
  "bodies",
  "rows",
  "profile",
  "pivot",
  "pivots",
  "placement",
  "creaseAngle",
  "normals",
  "weldTolerance",
  "maxTriangles",
  "colorSpace",
  "provenance",
  "collision",
  "collisions",
  "texcoords",
  "kernel",
  "naming",
  "checks",
  "generatedAt",
  "revision",
  "output",
];
const KIT_JOB_KEYS = [...PACK_JOB_KEYS.filter((key) => key !== "bodies" && key !== "rows" && key !== "pivot" && key !== "pivots" && key !== "placement" && key !== "collisions"), "grid", "pieces", "mates", "layouts", "pieceChecks", "scenes"];
const KIT_PIECE_KEYS = ["name", "bodies", "glb", "cells", "origin", "pivot", "sockets", "trim", "provenance"];
const PACK_BODY_KEYS = [...BODY_KEYS, "lods", "collisionPieces", "collisionRemainder", "attachPoints"];
const LOD_KEYS = ["stl", "faceIds", "faceColors", "refines"];
const PIECE_KEYS = ["stl"];
const ROW_KEYS = ["name", "bodies", "provenance"];
const PACK_OUTPUT_KEYS = ["dir", "zip"];
/** The kernel a job may name, and so the only package the command line ever loads by name. */
const KERNEL_PACKAGE = "manifold-3d";

function readPackBody(value: unknown, label: string, base: string): AssetBodyInput {
  const { body, entry, where } = readBody(value, label, base, PACK_BODY_KEYS);
  const asset: AssetBodyInput = body;
  if (entry["lods"] !== undefined) {
    if (!Array.isArray(entry["lods"])) refuse("BAD_JOB", `${where}: "lods" must be a list of { "stl" }, the nearest to full detail first.`);
    asset.lods = entry["lods"].map((level: unknown, at: number) => {
      const levelWhere = `${where}, detail level ${at + 1}`;
      if (!isRecord(level)) refuse("BAD_JOB", `${levelWhere} must be an object with "stl".`);
      refuseUnknownKeys(level, LOD_KEYS, levelWhere);
      if (typeof level["stl"] !== "string" || level["stl"] === "") refuse("BAD_JOB", `${levelWhere} needs an "stl" file path.`);
      const lod: { -readonly [key in keyof LodInput]: LodInput[key] } = { positions: readStlFile(resolve(base, level["stl"]), levelWhere) };
      const faceIds = readList(level["faceIds"], "faceIds", levelWhere, base, FACE_IDS);
      if (faceIds !== undefined) lod.faceIds = faceIds as number[];
      const faceColors = readList(level["faceColors"], "faceColors", levelWhere, base, FACE_COLORS);
      if (faceColors !== undefined) lod.faceColors = faceColors as (ColorInput | null)[];
      if (level["refines"] !== undefined) lod.refines = readRefines(level["refines"], levelWhere, base);
      return lod;
    });
  }
  if (entry["collisionPieces"] !== undefined) {
    if (!Array.isArray(entry["collisionPieces"])) refuse("BAD_JOB", `${where}: "collisionPieces" must be a list of { "stl" }.`);
    asset.collisionPieces = entry["collisionPieces"].map((piece: unknown, at: number) => {
      const pieceWhere = `${where}, collision piece ${at}`;
      if (!isRecord(piece)) refuse("BAD_JOB", `${pieceWhere} must be an object with "stl".`);
      refuseUnknownKeys(piece, PIECE_KEYS, pieceWhere);
      if (typeof piece["stl"] !== "string" || piece["stl"] === "") refuse("BAD_JOB", `${pieceWhere} needs an "stl" file path.`);
      return { positions: readStlFile(resolve(base, piece["stl"]), pieceWhere) };
    });
  }
  const rest = entry["collisionRemainder"];
  if (rest !== undefined) {
    const restWhere = `${where}, collision remainder`;
    if (!isRecord(rest)) refuse("BAD_JOB", `${restWhere} must be an object with "stl".`);
    refuseUnknownKeys(rest, PIECE_KEYS, restWhere);
    if (typeof rest["stl"] !== "string" || rest["stl"] === "") refuse("BAD_JOB", `${restWhere} needs an "stl" file path.`);
    asset.collisionRemainder = { positions: readStlFile(resolve(base, rest["stl"]), restWhere) };
  }
  // Written into the job itself. The exporter checks them.
  if (entry["attachPoints"] !== undefined) asset.attachPoints = entry["attachPoints"] as AttachPointInput[];
  return asset;
}

function readPackBodies(value: unknown, owner: string, base: string): AssetBodyInput[] {
  if (!Array.isArray(value) || value.length === 0) refuse("BAD_JOB", `${owner} needs a "bodies" list with at least one body.`);
  return value.map((entry: unknown, index: number) => readPackBody(entry, `${owner === "The job" ? "Body" : `${owner}, body`} ${index}`, base));
}

async function loadKernel(): Promise<CollisionKernel> {
  // The name is held in a variable so that bundlers and the compiler leave the import alone.
  const name = KERNEL_PACKAGE;
  let loaded: { default: () => Promise<{ setup: () => void } & Parameters<typeof manifoldKernel>[0]> };
  try {
    loaded = (await import(name)) as typeof loaded;
  } catch {
    return refuse("BAD_JOB", `The job asks for the kernel "${KERNEL_PACKAGE}", and that package is not installed. Install it next to this one: npm install ${KERNEL_PACKAGE}.`);
  }
  const module = await loaded.default();
  module.setup();
  return manifoldKernel(module);
}

/**
 * Runs a pack job: reads the STL files it names, makes the pack and writes it where the job
 * says, as a folder of files, as one ZIP archive, or both. With nowhere to write, nothing is
 * written and the pack is only returned.
 */
export async function runPackJob(job: unknown, options: PackJobOptions = {}): Promise<PackJobResult> {
  const base = resolve(options.base ?? ".");
  if (!isRecord(job)) refuse("BAD_JOB", "A pack job must be a JSON object.");
  const isKit = job["pieces"] !== undefined;
  refuseUnknownKeys(job, isKit ? KIT_JOB_KEYS : PACK_JOB_KEYS, "The job");
  if (typeof job["name"] !== "string" || job["name"].trim() === "") refuse("BAD_JOB", "The job needs a \"name\": the asset's name, the family's, or the kit's.");
  if (!isRecord(job["source"])) refuse("BAD_JOB", "The job needs a \"source\" object, for example { \"unit\": 0.001, \"up\": \"Z\" }.");
  if (!isKit && (job["bodies"] !== undefined) === (job["rows"] !== undefined)) refuse("BAD_JOB", "The job needs \"bodies\" for one asset, \"rows\" for a family or \"pieces\" for a kit, and only one of them.");
  const output = job["output"] ?? {};
  if (!isRecord(output)) refuse("BAD_JOB", "\"output\" must be an object with \"dir\", \"zip\" or both.");
  refuseUnknownKeys(output, PACK_OUTPUT_KEYS, "\"output\"");
  for (const key of PACK_OUTPUT_KEYS) {
    if (output[key] !== undefined && (typeof output[key] !== "string" || output[key] === "")) refuse("BAD_JOB", `"output.${key}" must be a path.`);
  }
  if (job["kernel"] !== undefined && job["kernel"] !== KERNEL_PACKAGE) refuse("BAD_JOB", `"kernel" must be "${KERNEL_PACKAGE}", the one kernel a job can name. Got ${JSON.stringify(job["kernel"])}.`);

  const { bodies: _bodies, rows: _rows, pieces: _pieces, output: _output, kernel: _kernel, ...rest } = job;
  const kernel = options.kernel ?? (job["kernel"] === KERNEL_PACKAGE ? await loadKernel() : undefined);
  let pack: GamePack;
  if (isKit) {
    if (!Array.isArray(job["pieces"]) || job["pieces"].length === 0) refuse("BAD_JOB", "\"pieces\" must be a list with at least one piece.");
    const pieces = job["pieces"].map((piece: unknown, at: number): KitPieceInput => {
      if (!isRecord(piece)) refuse("BAD_JOB", `Piece ${at} must be an object with "name" and "bodies" or "glb".`);
      refuseUnknownKeys(piece, KIT_PIECE_KEYS, `Piece ${at}`);
      if (typeof piece["name"] !== "string" || piece["name"].trim() === "") refuse("BAD_JOB", `Piece ${at} needs a "name".`);
      const where = `Piece "${piece["name"]}"`;
      if ((piece["bodies"] !== undefined) === (piece["glb"] !== undefined)) refuse("BAD_JOB", `${where} needs "bodies" or "glb", and not both.`);
      const { bodies: _pieceBodies, glb: _glb, ...given } = piece;
      if (piece["glb"] !== undefined) {
        if (typeof piece["glb"] !== "string" || piece["glb"] === "") refuse("BAD_JOB", `${where}: "glb" must be the path of a GLB this package wrote.`);
        return { ...(given as unknown as KitPieceInput), glb: readFile(resolve(base, piece["glb"]), "GLB file") };
      }
      return { ...(given as unknown as KitPieceInput), bodies: readPackBodies(piece["bodies"], where, base) };
    });
    const kitInput = { ...rest, pieces } as unknown as KitPackInput;
    // The kit checks measure what two pieces both fill with the same kernel.
    if (kernel !== undefined) kitInput.kernel = kernel;
    pack = exportKitPack(kitInput);
    return writePack(pack, output, options, base);
  }
  const input = { ...rest } as unknown as PackInput;
  if (job["bodies"] !== undefined) {
    input.bodies = readPackBodies(job["bodies"], "The job", base);
  } else {
    if (!Array.isArray(job["rows"]) || job["rows"].length === 0) refuse("BAD_JOB", "\"rows\" must be a list with at least one row.");
    input.rows = job["rows"].map((row: unknown, at: number) => {
      if (!isRecord(row)) refuse("BAD_JOB", `Row ${at} must be an object with "name" and "bodies".`);
      refuseUnknownKeys(row, ROW_KEYS, `Row ${at}`);
      if (typeof row["name"] !== "string" || row["name"].trim() === "") refuse("BAD_JOB", `Row ${at} needs a "name".`);
      const bodies = readPackBodies(row["bodies"], `Row "${row["name"]}"`, base);
      return { name: row["name"], bodies, ...(row["provenance"] !== undefined ? { provenance: row["provenance"] as JsonValue } : {}) };
    });
  }
  if (kernel !== undefined) input.kernel = kernel;
  pack = exportGamePack(input);
  return writePack(pack, output, options, base);
}

/** Writes a pack where the job and the options say, and says what was written. */
function writePack(pack: GamePack, output: Record<string, unknown>, options: PackJobOptions, base: string): PackJobResult {
  const dir = options.dir !== undefined ? resolve(options.dir) : typeof output["dir"] === "string" ? resolve(base, output["dir"]) : undefined;
  const zip = options.zip !== undefined ? resolve(options.zip) : typeof output["zip"] === "string" ? resolve(base, output["zip"]) : undefined;
  const hashes = new Map([...pack.manifest.files, ...(pack.manifest.scenes ?? [])].map((file) => [file.name, file.sha256]));
  const files = pack.files.map((file) => {
    const sha256 = hashes.get(file.name);
    return { name: file.name, mediaType: file.mediaType, bytes: file.bytes.length, ...(sha256 !== undefined ? { sha256 } : {}), ...(dir !== undefined ? { path: join(dir, file.name) } : {}) };
  });
  if (dir !== undefined) {
    mkdirSync(dir, { recursive: true });
    for (const file of pack.files) writeFileSync(join(dir, file.name), file.bytes);
  }
  if (zip !== undefined) {
    mkdirSync(dirname(zip), { recursive: true });
    writeFileSync(zip, packToZip(pack));
  }
  return {
    name: pack.name,
    ...(pack.manifest.status !== undefined ? { status: pack.manifest.status } : {}),
    ...(dir !== undefined ? { dir } : {}),
    ...(zip !== undefined ? { zip } : {}),
    files,
    pack,
  };
}

/** Reads a GLB this package wrote from a file and runs the game checks on it. */
export function checkFile(path: string, options: CheckOptions = {}): CheckReport {
  return checkGameAsset(readFile(resolve(path), "GLB file"), options);
}

const HELP = `corbelo-game-export ${VERSION}

Turns STL bodies into one game-engine-ready GLB and a facts JSON file.

Usage:
  corbelo-game-export <job.json> [--out <file.glb>] [--facts <file.json>]
  corbelo-game-export pack <job.json | -> [--dir <folder>] [--zip <file.zip>] [--base <folder>]
  corbelo-game-export check <file.glb> [--class <class>] [--options <file.json>] [--strict]
  corbelo-game-export install <pack.zip | folder> --project <dir> [--into <folder>] [--pin] [--force] [--dry-run] [--text]
  corbelo-game-export status [--project <dir>] [--strict] [--text]
  corbelo-game-export pin [<pack name>] --project <dir> [--text]

The job file is JSON:
  {
    "bodies": [{ "name": "Block", "stl": "block.stl", "color": "#d98a3d" }],
    "source": { "unit": 0.001, "up": "Z" },
    "profile": "godot4",
    "pivot": "base-center",
    "output": { "glb": "block.glb" }
  }

A body may also name two JSON files, each an array with one entry per triangle of its
STL: "faceIds", the exact face each triangle came from, and "faceColors", the colour of
each triangle, or null for the body's own colour.

"faceMaterialNames" names the materials of face colours: { "#3a7bd5": "Blue" }.

"refines" takes the shading from the meshes the STL is a finer cut of:
  { "surfaces": [{ "stl": "uncut.stl" }], "triangleOf": "triangle-of.json" }
"triangleOf" is a JSON file with one whole number per triangle of the body's STL: a
triangle of the surface it lies in. With more than one surface, "surfaceOf" is a file
of the same kind that says which surface. A surface may name a "faceIds" file too.
A lower detail level of a pack job takes "refines" the same way, for its own STL.

Paths in the job are relative to the job file. --out and --facts are relative to the
working directory and win over the job. Without a facts path, the facts go next to the
GLB as <name>.facts.json.

On success one line of JSON is printed: the two paths, the GLB size and the totals.
On failure a line "corbelo-game-export: error [CODE]: message" goes to standard error
and the exit code is 1. A wrong command line exits with 2.

pack makes a game asset or a family of them: GLBs with collision, detail levels,
texture coordinates and attach points, and a manifest with the facts and the game
checks. The job is JSON, from a file or from standard input with "-":
  {
    "name": "crate",
    "source": { "unit": 0.001, "up": "Z" },
    "profile": "unreal5",
    "bodies": [{
      "name": "Crate", "stl": "crate.stl",
      "lods": [{ "stl": "crate-lod1.stl" }],
      "collisionPieces": [{ "stl": "crate-side.stl" }],
      "attachPoints": [{ "name": "lid", "position": [0, 0, 500], "direction": [0, 0, 1] }]
    }],
    "collision": "auto",
    "texcoords": { "tileMeters": 1 },
    "checks": { "assetClass": "small-prop" },
    "output": { "dir": "out", "zip": "out/crate.zip" }
  }
A family has "rows" in place of "bodies": [{ "name": "small", "bodies": [...] }].
"kernel": "manifold-3d" loads that package, which must be installed, for a general
convex decomposition. Paths in the job are relative to the job file, or with "-" to
--base, or else to the working directory. --dir and --zip are relative to the working
directory and win over the job. One line of JSON is printed: the pack's name, the
status of the checks, where it was written and each file's size and SHA-256.

A kit has "grid" and "pieces" in place of "bodies": pieces that share a grid and meet at
sockets. The pack holds a GLB for each piece, a scene for each layout, and a manifest
with the grid, the sockets, the seven kit checks and the items of a mesh library:
  {
    "name": "corridor",
    "source": { "unit": 0.001, "up": "Z" },
    "grid": { "moduleMeters": 3, "storeyMeters": 3 },
    "collision": "pieces",
    "pieces": [{
      "name": "straight",
      "bodies": [{ "name": "straight", "stl": "straight.stl", "collisionPieces": [{ "stl": "floor.stl" }] }],
      "sockets": [{ "type": "corridor", "side": "+x", "passage": true }, { "type": "corridor", "side": "-x", "passage": true }]
    }],
    "layouts": [{ "name": "hall", "placements": [{ "piece": "straight", "cell": [0, 0, 0] }, { "piece": "straight", "cell": [1, 0, 0] }] }],
    "output": { "zip": "corridor.zip" }
  }
A piece may name a "glb" this package wrote in place of "bodies". "checks" are options
for the kit checks and "pieceChecks" for the game checks of each piece; false runs none.
"scenes": false leaves the scenes out. With "kernel": "manifold-3d" the kit checks also
measure what a piece's trim and the piece next to it both fill.

check runs the game checks on a GLB this package wrote and prints the report as one
line of JSON. --class is small-prop, large-prop or kit-piece. --options names a JSON
file with the options of checkGameAsset. With --strict a failing check exits with 3.

install puts a pack, a ZIP archive or a folder, into a game project. Its files go into
<project>/<into>/<pack name>/, with --into "assets" unless given or already recorded,
and ${LOCK_FILE_NAME} at the project's root records each file's SHA-256, the
provenance the pack carries, the revision installed and the revision in the build.
Installing a newer pack replaces the files in place under the same names, takes away
files only the older one had, and leaves the revision in the build alone unless --pin
is given. A first install sets it. One line of JSON says what was added, changed,
unchanged, removed and kept; --text prints that for a person and --dry-run writes
nothing. Refused, with nothing written: a pack whose files are not the ones its manifest
lists (PACK_MISMATCH), a path that leaves the project as written or through a link
(OUTSIDE_PROJECT), and a file in the way that no install put there or that was changed
since (FILE_IN_THE_WAY, or replaced with --force).

status compares a project with its lock file and prints, for each pack, the files that
have other bytes or are missing and whether the installed revision is the one in the
build. --project is the working directory unless given. With --strict anything that
does not match exits with 3.

pin moves "in the build" to the installed revision, for one pack by name or for all.
`;

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  /** Reads all of standard input. Default: the process's own. */
  stdin?: () => Uint8Array;
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

/** Reads the value of an option that needs one. Returns undefined, after saying why, when it is missing. */
function valueOf(argv: readonly string[], at: number, io: CliIo, what: string): string | undefined {
  const value = argv[at + 1];
  if (value === undefined || value.startsWith("--")) {
    io.err(`corbelo-game-export: ${argv[at]!} needs ${what}.\n`);
    return undefined;
  }
  return value;
}

async function packCommand(argv: readonly string[], io: CliIo): Promise<number> {
  let jobPath: string | undefined;
  const options: PackJobOptions = {};
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at]!;
    if (arg === "--dir" || arg === "--zip" || arg === "--base") {
      const value = valueOf(argv, at, io, "a path");
      if (value === undefined) return 2;
      options[arg === "--dir" ? "dir" : arg === "--zip" ? "zip" : "base"] = value;
      at += 1;
    } else if (arg !== "-" && arg.startsWith("-")) {
      io.err(`corbelo-game-export: unknown option ${arg} for pack. Try --help.\n`);
      return 2;
    } else if (jobPath === undefined) {
      jobPath = arg;
    } else {
      io.err("corbelo-game-export: give pack exactly one job file, or - for standard input. Try --help.\n");
      return 2;
    }
  }
  if (jobPath === undefined) {
    io.err("corbelo-game-export: pack needs a job file, or - for standard input. Try --help.\n");
    return 2;
  }
  const fromStdin = jobPath === "-";
  const text = new TextDecoder().decode(fromStdin ? (io.stdin ?? (() => readFileSync(0)))() : readFile(resolve(jobPath), "job file"));
  let job: unknown;
  try {
    job = JSON.parse(text);
  } catch (error) {
    refuse("BAD_JOB", `The job ${fromStdin ? "on standard input" : resolve(jobPath)} is not valid JSON: ${(error as Error).message}`);
  }
  if (options.base === undefined && !fromStdin) options.base = dirname(resolve(jobPath));
  const result = await runPackJob(job, options);
  if (result.dir === undefined && result.zip === undefined) refuse("BAD_JOB", "Nowhere to write the pack. Set \"output.dir\" or \"output.zip\" in the job, or pass --dir or --zip.");
  const { pack: _pack, ...summary } = result;
  io.out(`${JSON.stringify(summary)}\n`);
  return 0;
}

function checkCommand(argv: readonly string[], io: CliIo): number {
  let file: string | undefined;
  let options: CheckOptions = {};
  let assetClass: string | undefined;
  let strict = false;
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at]!;
    if (arg === "--strict") {
      strict = true;
    } else if (arg === "--class") {
      assetClass = valueOf(argv, at, io, `one of ${Object.keys(ASSET_BUDGETS).join(", ")}`);
      if (assetClass === undefined) return 2;
      at += 1;
    } else if (arg === "--options") {
      const value = valueOf(argv, at, io, "the path of a JSON file");
      if (value === undefined) return 2;
      try {
        options = JSON.parse(new TextDecoder().decode(readFile(resolve(value), "options file"))) as CheckOptions;
      } catch (error) {
        if (error instanceof GameExportError) throw error;
        refuse("BAD_JOB", `The options file ${resolve(value)} is not valid JSON: ${(error as Error).message}`);
      }
      at += 1;
    } else if (arg.startsWith("-")) {
      io.err(`corbelo-game-export: unknown option ${arg} for check. Try --help.\n`);
      return 2;
    } else if (file === undefined) {
      file = arg;
    } else {
      io.err("corbelo-game-export: give check exactly one GLB file. Try --help.\n");
      return 2;
    }
  }
  if (file === undefined) {
    io.err("corbelo-game-export: check needs a GLB file. Try --help.\n");
    return 2;
  }
  const report = checkFile(file, assetClass !== undefined ? { ...options, assetClass: assetClass as AssetClass } : options);
  io.out(`${JSON.stringify(report)}\n`);
  return strict && report.status === "fail" ? 3 : 0;
}

/** The name of a revision for a person: the caller's own name for it, and the start of its digest. */
function revisionText(revision: { revision?: string; digest: string }): string {
  return revision.revision !== undefined ? `${revision.revision} (${revision.digest.slice(0, 12)})` : revision.digest.slice(0, 12);
}

function installText(result: InstallResult): string {
  const lines = [`${result.dryRun === true ? "Would install" : "Installed"} ${result.pack} (${result.kind}) into ${result.into}: ${result.from !== undefined && result.from.digest !== result.to.digest ? `${revisionText(result.from)} -> ` : ""}${revisionText(result.to)}`];
  for (const change of result.changes) {
    if (change.change !== "unchanged") lines.push(`  ${change.change.padEnd(9)} ${change.path}${change.forced === true ? " (forced)" : ""}`);
  }
  if (result.counts.unchanged > 0) lines.push(`  unchanged ${result.counts.unchanged} file${result.counts.unchanged === 1 ? "" : "s"}`);
  for (const name of result.ignored) lines.push(`  ignored   ${name} (not in the manifest)`);
  lines.push(result.pinned ? `In the build: ${revisionText(result.inTheBuild)}, the revision installed.` : `In the build: ${revisionText(result.inTheBuild)}. Installed is ${revisionText(result.to)}: run pin to put it in the build.`);
  return `${lines.join("\n")}\n`;
}

function statusText(status: ProjectStatus): string {
  const lines: string[] = [];
  for (const pack of status.packs) {
    lines.push(`${pack.name} (${pack.kind}) in ${pack.into}: ${revisionText(pack.installed)}, ${pack.matches ? `${pack.counts.same} file${pack.counts.same === 1 ? "" : "s"} as installed` : `${pack.counts.changed} changed, ${pack.counts.missing} missing`}`);
    for (const path of pack.changed) lines.push(`  changed   ${path}`);
    for (const path of pack.missing) lines.push(`  missing   ${path}`);
    lines.push(pack.pinned ? "  in the build: the revision installed" : `  in the build: ${revisionText(pack.inTheBuild)}, not the revision installed`);
  }
  if (status.packs.length === 0) lines.push("No packs are installed.");
  return `${lines.join("\n")}\n`;
}

/** Reads the flags the commands about a project share. Returns the exit code 2, after saying why, for a wrong command line. */
function projectArgs(command: string, argv: readonly string[], io: CliIo, flags: readonly string[], positional: string | undefined): { project?: string; into?: string; given?: string; set: Set<string> } | 2 {
  const read: { project?: string; into?: string; given?: string; set: Set<string> } = { set: new Set() };
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at]!;
    if (arg === "--project" || (arg === "--into" && flags.includes("--into"))) {
      const value = valueOf(argv, at, io, "a folder");
      if (value === undefined) return 2;
      read[arg === "--project" ? "project" : "into"] = value;
      at += 1;
    } else if (flags.includes(arg)) {
      read.set.add(arg);
    } else if (arg.startsWith("-")) {
      io.err(`corbelo-game-export: unknown option ${arg} for ${command}. Try --help.\n`);
      return 2;
    } else if (positional !== undefined && read.given === undefined) {
      read.given = arg;
    } else {
      io.err(`corbelo-game-export: ${command} takes ${positional === undefined ? "no name or path" : `one ${positional}`}. Try --help.\n`);
      return 2;
    }
  }
  return read;
}

function installCommand(argv: readonly string[], io: CliIo): number {
  const args = projectArgs("install", argv, io, ["--into", "--pin", "--force", "--dry-run", "--text"], "pack, a ZIP archive or a folder");
  if (args === 2) return 2;
  if (args.given === undefined) {
    io.err("corbelo-game-export: install needs a pack, a ZIP archive or a folder. Try --help.\n");
    return 2;
  }
  if (args.project === undefined) {
    io.err("corbelo-game-export: install needs --project, the game project's folder. Try --help.\n");
    return 2;
  }
  const result = installPack(args.given, args.project, {
    ...(args.into !== undefined ? { into: args.into } : {}),
    pin: args.set.has("--pin"),
    force: args.set.has("--force"),
    dryRun: args.set.has("--dry-run"),
  });
  io.out(args.set.has("--text") ? installText(result) : `${JSON.stringify(result)}\n`);
  return 0;
}

function statusCommand(argv: readonly string[], io: CliIo): number {
  const args = projectArgs("status", argv, io, ["--strict", "--text"], undefined);
  if (args === 2) return 2;
  const status = projectStatus(args.project ?? ".");
  io.out(args.set.has("--text") ? statusText(status) : `${JSON.stringify(status)}\n`);
  return args.set.has("--strict") && !status.ok ? 3 : 0;
}

function pinCommand(argv: readonly string[], io: CliIo): number {
  const args = projectArgs("pin", argv, io, ["--text"], "pack name");
  if (args === 2) return 2;
  if (args.project === undefined) {
    io.err("corbelo-game-export: pin needs --project, the game project's folder. Try --help.\n");
    return 2;
  }
  const status = pinProject(args.project, args.given);
  io.out(args.set.has("--text") ? statusText(status) : `${JSON.stringify(status)}\n`);
  return 0;
}

/**
 * The whole command line: `pack`, `check`, `install`, `status`, `pin`, and everything `runCli`
 * does. Returns the exit code and never throws.
 */
export async function runCommand(argv: readonly string[], io: CliIo = { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text) }): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "pack":
        return await packCommand(rest, io);
      case "check":
        return checkCommand(rest, io);
      case "install":
        return installCommand(rest, io);
      case "status":
        return statusCommand(rest, io);
      case "pin":
        return pinCommand(rest, io);
      default:
        return runCli(argv, io);
    }
  } catch (error) {
    const code = error instanceof GameExportError ? error.code : "UNEXPECTED";
    io.err(`corbelo-game-export: error [${code}]: ${(error as Error).message}\n`);
    return 1;
  }
}
