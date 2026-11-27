import { exportBlockout } from "./blockout.js";
import { checkGameAsset, type CheckOptions, type CheckReport } from "./checks.js";
import { refuse } from "./errors.js";
import { assertJson } from "./export.js";
import { checkKit, type KitCheckOptions, type KitCheckReport } from "./kit-checks.js";
import { cellSize, kitLayouts, resolveKit, type KitCell, type KitGrid, type KitInput, type KitLayout, type KitSocket } from "./kit.js";
import { assetName } from "./naming.js";
import { GLB_MEDIA_TYPE, MANIFEST_MEDIA_TYPE, manifestJson, type GamePack, type PackFile, type PackManifest, type PackManifestFile, type PackManifestScene } from "./pack.js";
import { resolveProfile } from "./profiles.js";
import { sha256Hex } from "./sha256.js";
import type { PackFacts, Vec3 } from "./types.js";
import { GENERATOR } from "./version.js";

export interface KitPackInput extends KitInput {
  /** Options for the kit checks, or `false` to run none. Default: checks with their own defaults. */
  checks?: false | Omit<KitCheckOptions, "grid">;
  /**
   * Options for the game checks run on every piece, or `false` to run none. Default: every
   * piece is checked as a `"kit-piece"`, with its pivot against the kit's module and with the
   * player of the kit checks. Each piece's report is stored whole, but its three player checks
   * do not count towards the pack's status: they judge a piece standing alone on a floor, and
   * the kit's Walkable check judges it in its place.
   */
  pieceChecks?: false | CheckOptions;
  /** `false` leaves the scenes of the layouts out of the pack. Default: one scene for each layout. */
  scenes?: boolean;
  /** A time to write into the manifest, as text. Nothing is written without it: the clock is never read. */
  generatedAt?: string;
  /** The caller's own name for this revision of the source. */
  revision?: string;
}

export interface KitManifestPiece {
  /** The piece's name in the kit. */
  name: string;
  /** Its asset name: the file name without `.glb`. */
  asset: string;
  file: string;
  /** How many cells it takes: along X, along Y, and storeys, in the kit's frame. */
  cells: KitCell;
  /** Where its own origin is from the lowest corner of its cells, in metres, in the kit's frame. */
  pivotMeters: Vec3;
  sockets: KitSocket[];
  /** Names of its bodies that are trim. */
  trim: string[];
}

/** What a grid of tiles needs: a mesh library with one item for each piece, at the kit's cell size. */
export interface KitMeshLibrary {
  /** One cell in the files' axes, in metres: along X, up, and along Z. */
  cellSize: Vec3;
  items: {
    /** The item's number in a new library: the piece's place in the kit. */
    id: number;
    /** The item's name: the piece's asset name. */
    name: string;
    piece: string;
    file: string;
    /** Where the piece's own origin is from the middle of its first cell, in metres, in the files' axes. */
    offset: Vec3;
  }[];
}

export interface KitManifest {
  /** The kit's frame against the files': both in metres, the kit's with Z up. */
  frame: { up: "Z"; toFile: "x, y, z in the kit is x, z, -y in the files" };
  grid: KitGrid;
  /** One cell in the files' axes, in metres: along X, up, and along Z. */
  cellSize: Vec3;
  /** Which socket type meets which, for every type that meets another than itself. */
  mates: Record<string, string>;
  pieces: KitManifestPiece[];
  /** Every layout: the test layouts built from the sockets, then the caller's own. `scene` names its file when the pack has one. */
  layouts: (KitLayout & { scene?: string })[];
  /** Test layouts the kit has no pieces for, and why. */
  skippedLayouts: { name: string; reason: string }[];
  /** Only when the kit checks ran. */
  checks?: KitCheckReport;
  meshLibrary: KitMeshLibrary;
}

/** The game checks that are about a player, which a kit answers with its Walkable check. */
const PLAYER_CHECKS: readonly string[] = ["player-openings", "player-steps", "player-ramps"];

const worse = (a: "pass" | "warn" | "fail", b: "pass" | "warn" | "fail"): "pass" | "warn" | "fail" => (a === "fail" || b === "fail" ? "fail" : a === "warn" || b === "warn" ? "warn" : "pass");

/**
 * Makes a kit pack: one GLB for each piece, named by the pattern, one scene for each layout,
 * and a manifest of kind `"kit"` that lists every file with its size and SHA-256 and holds the
 * kit's grid, its pieces with their sockets, its layouts, the results of the seven kit checks
 * and the items of a mesh library.
 *
 * A material name means one colour in every piece, and material slots are in the order of the
 * names, so the pieces share their slots. The same input always gives the same bytes.
 */
export function exportKitPack(input: KitPackInput): GamePack {
  if (typeof input !== "object" || input === null) refuse("BAD_KIT", "exportKitPack needs { name, source, grid, pieces }.");
  for (const key of ["generatedAt", "revision"] as const) {
    if (input[key] !== undefined && (typeof input[key] !== "string" || input[key] === "")) refuse("BAD_PACK", `${key} must be text.`);
  }
  for (const key of ["checks", "pieceChecks"] as const) {
    if (input[key] !== undefined && input[key] !== false && (typeof input[key] !== "object" || input[key] === null)) refuse("BAD_PACK", `${key} must be false or an object of options.`);
  }
  if (input.scenes !== undefined && typeof input.scenes !== "boolean") refuse("BAD_PACK", "scenes must be true or false.");
  if (input.provenance !== undefined) assertJson(input.provenance, "provenance", 0);
  if (input.checks !== undefined && input.checks !== false && (input.checks as KitCheckOptions).grid !== undefined) {
    refuse("BAD_PACK", "checks takes no grid: the pack is written for the kit's own grid. Give the kit another grid to write it for one.");
  }

  const { checks, pieceChecks, scenes, generatedAt, revision, ...kitInput } = input;
  const kit = resolveKit(kitInput);
  const profile = resolveProfile(input.profile);
  const generated = kitLayouts(kit);
  const layouts = [...generated.layouts, ...kit.layouts];

  const report = checks === false ? undefined : checkKit(kit, checks ?? {});
  const files: PackFile[] = [];
  const listed: PackManifestFile[] = [];
  const materials = new Map<string, PackManifest["materials"][number]>();
  const taken = new Set<string>();
  let facts: PackFacts | undefined;
  let pieceReport: CheckReport | undefined;
  let status: "pass" | "warn" | "fail" = report?.status ?? "pass";
  for (const piece of kit.pieces) {
    facts = piece.facts;
    const fileName = `${piece.asset}.glb`;
    taken.add(piece.asset.toLowerCase());
    for (const material of piece.facts.materials) {
      const known = materials.get(material.name);
      if (known === undefined) {
        materials.set(material.name, { name: material.name, color: material.color, baseColorFactor: material.baseColorFactor, files: [fileName] });
      } else if (known.color !== material.color) {
        refuse("MATERIAL_CONFLICT", `Material "${material.name}" is ${known.color} in ${known.files[0]!} and ${material.color} in ${fileName}. In a kit a material name means one colour.`);
      } else {
        known.files.push(fileName);
      }
    }
    const entry: PackManifestFile = { name: fileName, role: "model", mediaType: GLB_MEDIA_TYPE, bytes: piece.glb.length, sha256: sha256Hex(piece.glb), asset: piece.asset, row: piece.name, facts: piece.facts };
    if (pieceChecks !== false) {
      pieceReport = checkGameAsset(piece.glb, { assetClass: "kit-piece", gridMeters: kit.grid.moduleMeters, ...(report !== undefined ? { player: report.player } : {}), ...pieceChecks });
      entry.checks = pieceReport;
      // The pack's status leaves the three player checks of a piece out: they judge a piece
      // standing alone on a floor, and Walkable judges it in its place in the kit.
      for (const result of pieceReport.results) {
        if (!PLAYER_CHECKS.includes(result.id) && result.status !== "not-measured") status = worse(status, result.status);
      }
    }
    if (piece.provenance !== undefined) entry.provenance = piece.provenance;
    listed.push(entry);
    files.push({ name: fileName, mediaType: GLB_MEDIA_TYPE, bytes: piece.glb });
  }

  const sceneFiles: PackManifestScene[] = [];
  const sceneOf = new Map<string, string>();
  if (scenes !== false) {
    for (const layout of layouts) {
      const name = assetName(kit.naming, input.name, `layout ${layout.name}`);
      if (taken.has(name.toLowerCase())) refuse("BAD_KIT", `The scene of layout "${layout.name}" and another file of the pack both come out named "${name}". Give the layout or the piece another name.`);
      taken.add(name.toLowerCase());
      const scene = exportBlockout(kit, layout.name, input.provenance !== undefined ? { provenance: input.provenance } : {});
      const fileName = `${name}.glb`;
      sceneFiles.push({ name: fileName, role: "blockout", mediaType: GLB_MEDIA_TYPE, bytes: scene.glb.length, sha256: sha256Hex(scene.glb), layout: layout.name, facts: scene.facts });
      sceneOf.set(layout.name, fileName);
      files.push({ name: fileName, mediaType: GLB_MEDIA_TYPE, bytes: scene.glb });
    }
  }

  const size = cellSize(kit.grid);
  const fileSize: Vec3 = [size[0], size[2], size[1]];
  const manifest: PackManifest = {
    schema: 1,
    kind: "kit",
    name: kit.name,
    generator: GENERATOR,
    ...(generatedAt !== undefined ? { generatedAt } : {}),
    ...(revision !== undefined ? { revision } : {}),
    profile: profile.id,
    engine: facts!.engine,
    naming: { pattern: kit.naming },
    ...(pieceReport !== undefined ? { assetClass: pieceReport.assetClass, budget: pieceReport.budget, player: pieceReport.player } : {}),
    ...(pieceReport !== undefined || report !== undefined ? { status } : {}),
    materials: [...materials.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    files: listed,
    ...(sceneFiles.length > 0 ? { scenes: sceneFiles } : {}),
    kit: {
      frame: { up: "Z", toFile: "x, y, z in the kit is x, z, -y in the files" },
      grid: kit.grid,
      cellSize: fileSize,
      mates: kit.mates,
      pieces: kit.pieces.map((piece) => ({ name: piece.name, asset: piece.asset, file: `${piece.asset}.glb`, cells: piece.cells, pivotMeters: piece.pivotMeters, sockets: piece.sockets, trim: piece.trim })),
      layouts: layouts.map((layout) => ({ ...layout, ...(sceneOf.has(layout.name) ? { scene: sceneOf.get(layout.name)! } : {}) })),
      skippedLayouts: generated.skipped,
      ...(report !== undefined ? { checks: report } : {}),
      meshLibrary: {
        cellSize: fileSize,
        items: kit.pieces.map((piece, id) => {
          // From the middle of the first cell to the piece's own origin, in the kit's frame, then in the files'.
          const offset: Vec3 = [piece.pivotMeters[0] - size[0] / 2, piece.pivotMeters[1] - size[1] / 2, piece.pivotMeters[2] - size[2] / 2];
          return { id, name: piece.asset, piece: piece.name, file: `${piece.asset}.glb`, offset: [offset[0] + 0, offset[2] + 0, -offset[1] + 0] as Vec3 };
        }),
      },
    },
    ...(input.provenance !== undefined ? { provenance: input.provenance } : {}),
  };
  files.push({ name: `${kit.name}.pack.json`, mediaType: MANIFEST_MEDIA_TYPE, bytes: new TextEncoder().encode(`${manifestJson(manifest)}\n`) });
  return { name: kit.name, manifest, files };
}
