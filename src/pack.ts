import { exportGameAsset } from "./asset.js";
import { checkGameAsset, type AssetClass, type CheckOptions, type CheckReport, type GameBudget, type PlayerProfile } from "./checks.js";
import { refuse } from "./errors.js";
import { assertJson } from "./export.js";
import { assetName, DEFAULT_NAME_PATTERNS } from "./naming.js";
import { resolveProfile, type EngineProfileId } from "./profiles.js";
import { sha256Hex } from "./sha256.js";
import type { AssetBodyInput, AssetOptions, JsonValue, PackFacts, SourceSpace } from "./types.js";
import { GENERATOR } from "./version.js";
import { writeZip } from "./zip.js";

/** One asset of a family: a row of the table the family was made from. */
export interface PackRowInput {
  /** What tells this row from the others: "small", "2x4", "left". Goes into the asset's name by the pattern. */
  name: string;
  bodies: readonly AssetBodyInput[];
  /** Opaque JSON about this row, like the values of its parameters. Stored in its GLB and in the manifest. */
  provenance?: JsonValue;
}

export interface PackInput extends AssetOptions {
  /** The asset's name, or the family's: "crate". */
  name: string;
  source: SourceSpace;
  /** One asset. Give this or `rows`, not both. */
  bodies?: readonly AssetBodyInput[];
  /** A family: one asset for each row, all written with the same settings. */
  rows?: readonly PackRowInput[];
  /**
   * The name pattern, as `assetName` reads it. Default: the pattern of the engine in
   * `DEFAULT_NAME_PATTERNS`, and `"{family}_{row}"` for a custom profile.
   */
  naming?: string;
  /** Options for the game checks run on every asset, or `false` to run none. Default: checks with their own defaults. */
  checks?: false | CheckOptions;
  /** A time to write into the manifest, as text. Nothing is written without it: the clock is never read. */
  generatedAt?: string;
  /** The caller's own name for this revision of the source. */
  revision?: string;
}

export interface PackFile {
  /** The file's name in the pack. */
  name: string;
  mediaType: string;
  bytes: Uint8Array;
}

/** What the manifest says about one GLB of the pack. */
export interface PackManifestFile {
  name: string;
  role: "model";
  mediaType: "model/gltf-binary";
  /** Size of the file. */
  bytes: number;
  /** SHA-256 of the file, as 64 small hexadecimal digits. */
  sha256: string;
  /** The asset's name: the file name without `.glb`. */
  asset: string;
  /** Only in a family: the row's name as given. */
  row?: string;
  /** The same facts the GLB carries in its scene extras. */
  facts: PackFacts;
  /** Only when checks ran. */
  checks?: CheckReport;
  /** Only for a row given provenance. */
  provenance?: JsonValue;
}

export interface PackManifest {
  /** Version of this manifest layout. */
  schema: 1;
  /** `"asset"`: one GLB. `"family"`: one GLB for each row. */
  kind: "asset" | "family";
  /** The pack's name: the asset's name, or the family's name by the pattern without a row. */
  name: string;
  generator: string;
  generatedAt?: string;
  revision?: string;
  /** Engine profile id. */
  profile: string;
  engine: { unit: string; unitMeters: number; up: "Y" | "Z" };
  naming: { pattern: string };
  /** Only when checks ran: what they were run against. */
  assetClass?: AssetClass;
  budget?: GameBudget;
  player?: PlayerProfile;
  /** Only when checks ran: the worst status of any file. */
  status?: "pass" | "warn" | "fail";
  /** Every material of the pack by name, with the files that use it. A name means the same colour in every file. */
  materials: { name: string; color: string; baseColorFactor: [number, number, number, number]; files: string[] }[];
  files: PackManifestFile[];
  /** The pack's own provenance, as given. */
  provenance?: JsonValue;
}

export interface GamePack {
  /** The pack's name, safe to use as a file or folder name. */
  name: string;
  manifest: PackManifest;
  /** Every GLB in the order of the rows, then the manifest as `<name>.pack.json`. */
  files: PackFile[];
}

/**
 * JSON for people as well as programs: two spaces a level, and a list of plain values, like a
 * point or a list of names, on one line.
 */
function manifestJson(value: unknown, indent = ""): string {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item !== "object" || item === null)) return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    return `[\n${value.map((item) => `${indent}  ${manifestJson(item, `${indent}  `)}`).join(",\n")}\n${indent}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([key, item]) => `${indent}  ${JSON.stringify(key)}: ${manifestJson(item, `${indent}  `)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

export const MANIFEST_MEDIA_TYPE = "application/json";
export const GLB_MEDIA_TYPE = "model/gltf-binary";

const PACK_ONLY_KEYS: readonly string[] = ["name", "bodies", "rows", "naming", "checks", "generatedAt", "revision", "provenance"];

/**
 * Makes a pack: one GLB for an asset, or one for each row of a family, and a JSON manifest that
 * lists every file with its size, its SHA-256, its facts and the results of the game checks.
 *
 * In a family, an asset with one body gives that body the asset's own name, so the node and
 * the mesh are named as the file is. Material slots are in the order of the material names in
 * every file, and a material name that means two colours in two rows is refused.
 *
 * The same input always gives the same bytes: nothing is read from the clock or the machine.
 */
export function exportGamePack(input: PackInput): GamePack {
  if (typeof input !== "object" || input === null) refuse("BAD_PACK", "exportGamePack needs { name, source, bodies } or { name, source, rows }.");
  const hasBodies = input.bodies !== undefined;
  const hasRows = input.rows !== undefined;
  if (hasBodies === hasRows) refuse("BAD_PACK", "A pack is one asset or a family: give bodies or rows, and not both.");
  if (hasRows && (!Array.isArray(input.rows) || input.rows.length === 0)) refuse("BAD_PACK", "rows must be a list with at least one row.");
  for (const key of ["generatedAt", "revision"] as const) {
    if (input[key] !== undefined && (typeof input[key] !== "string" || input[key] === "")) refuse("BAD_PACK", `${key} must be text.`);
  }
  if (input.checks !== undefined && input.checks !== false && (typeof input.checks !== "object" || input.checks === null)) {
    refuse("BAD_PACK", "checks must be false or the options of checkGameAsset.");
  }
  if (input.provenance !== undefined) assertJson(input.provenance, "provenance", 0);

  const profile = resolveProfile(input.profile);
  const pattern = input.naming ?? (Object.hasOwn(DEFAULT_NAME_PATTERNS, profile.id) ? DEFAULT_NAME_PATTERNS[profile.id as EngineProfileId] : DEFAULT_NAME_PATTERNS.godot4);
  const packName = assetName(pattern, input.name);

  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!PACK_ONLY_KEYS.includes(key)) options[key] = value;
  }
  const rows: readonly { row?: string; asset: string; bodies: readonly AssetBodyInput[]; provenance?: JsonValue }[] = hasRows
    ? input.rows!.map((row, at) => {
        if (typeof row !== "object" || row === null) refuse("BAD_PACK", `Row ${at} must be { name, bodies }.`);
        if (typeof row.name !== "string") refuse("BAD_PACK", `Row ${at} needs a name.`);
        if (row.provenance !== undefined) assertJson(row.provenance, `rows[${at}].provenance`, 0);
        return { row: row.name, asset: assetName(pattern, input.name, row.name), bodies: row.bodies, ...(row.provenance !== undefined ? { provenance: row.provenance } : {}) };
      })
    : [{ asset: packName, bodies: input.bodies! }];
  const taken = new Map<string, string | undefined>();
  for (const { row, asset } of rows) {
    const key = asset.toLowerCase();
    if (taken.has(key)) refuse("BAD_PACK", `Rows "${String(taken.get(key))}" and "${String(row)}" both come out named "${asset}". Rows need names that differ in their letters and digits.`);
    taken.set(key, row);
  }

  const files: PackFile[] = [];
  const listed: PackManifestFile[] = [];
  const materials = new Map<string, PackManifest["materials"][number]>();
  let facts: PackFacts | undefined;
  let report: CheckReport | undefined;
  let status: "pass" | "warn" | "fail" = "pass";
  for (const { row, asset, bodies, provenance } of rows) {
    const where = row === undefined ? "The asset" : `Row "${row}"`;
    if (!Array.isArray(bodies) || bodies.length === 0) refuse("NO_BODIES", `${where} needs at least one body.`);
    // One body is the asset: it takes the asset's name. Several keep their own.
    const named = bodies.length === 1 && typeof bodies[0] === "object" && bodies[0] !== null ? [{ ...bodies[0], name: asset }] : bodies;
    const stored = provenance ?? input.provenance;
    const result = exportGameAsset({ ...(options as unknown as AssetOptions), source: input.source, bodies: named, ...(stored !== undefined ? { provenance: stored } : {}) });
    facts = result.facts;
    const fileName = `${asset}.glb`;
    for (const material of result.facts.materials) {
      const known = materials.get(material.name);
      if (known === undefined) {
        materials.set(material.name, { name: material.name, color: material.color, baseColorFactor: material.baseColorFactor, files: [fileName] });
      } else if (known.color !== material.color) {
        refuse("MATERIAL_CONFLICT", `Material "${material.name}" is ${known.color} in ${known.files[0]!} and ${material.color} in ${fileName}. In a family a material name means one colour.`);
      } else {
        known.files.push(fileName);
      }
    }
    const entry: PackManifestFile = { name: fileName, role: "model", mediaType: GLB_MEDIA_TYPE, bytes: result.glb.length, sha256: sha256Hex(result.glb), asset, ...(row !== undefined ? { row } : {}), facts: result.facts };
    if (input.checks !== false) {
      report = checkGameAsset(result.glb, input.checks ?? {});
      entry.checks = report;
      if (report.status === "fail" || (report.status === "warn" && status === "pass")) status = report.status;
    }
    if (provenance !== undefined) entry.provenance = provenance;
    listed.push(entry);
    files.push({ name: fileName, mediaType: GLB_MEDIA_TYPE, bytes: result.glb });
  }

  const manifest: PackManifest = {
    schema: 1,
    kind: hasRows ? "family" : "asset",
    name: packName,
    generator: GENERATOR,
    ...(input.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
    ...(input.revision !== undefined ? { revision: input.revision } : {}),
    profile: facts!.profile,
    engine: facts!.engine,
    naming: { pattern },
    ...(report !== undefined ? { assetClass: report.assetClass, budget: report.budget, player: report.player, status } : {}),
    materials: [...materials.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    files: listed,
    ...(input.provenance !== undefined ? { provenance: input.provenance } : {}),
  };
  files.push({ name: `${packName}.pack.json`, mediaType: MANIFEST_MEDIA_TYPE, bytes: new TextEncoder().encode(`${manifestJson(manifest)}\n`) });
  return { name: packName, manifest, files };
}

/** A pack as one ZIP archive: every file of it, stored. The same pack always gives the same bytes. */
export function packToZip(pack: Pick<GamePack, "files">): Uint8Array {
  if (typeof pack !== "object" || pack === null || !Array.isArray(pack.files)) refuse("BAD_PACK", "packToZip needs what exportGamePack returned.");
  return writeZip(pack.files.map((file) => ({ name: file.name, bytes: file.bytes })));
}
