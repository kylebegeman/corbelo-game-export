import type { BlockoutFacts } from "./blockout.js";
import { type AssetClass, type CheckOptions, type CheckReport, type GameBudget, type PlayerProfile } from "./checks.js";
import type { KitManifest } from "./kit-pack.js";
import type { AssetBodyInput, AssetOptions, JsonValue, PackFacts, SourceSpace } from "./types.js";
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
/** What the manifest says about a scene made of the pack's pieces: a layout of a kit, written by `exportBlockout`. */
export interface PackManifestScene {
    name: string;
    role: "blockout";
    mediaType: "model/gltf-binary";
    /** Size of the file. */
    bytes: number;
    /** SHA-256 of the file, as 64 small hexadecimal digits. */
    sha256: string;
    /** The layout's name. */
    layout: string;
    /** The same facts the GLB carries in its scene extras. */
    facts: BlockoutFacts;
}
export interface PackManifest {
    /** Version of this manifest layout. */
    schema: 1;
    /** `"asset"`: one GLB. `"family"`: one GLB for each row. `"kit"`: one GLB for each piece of a kit, from `exportKitPack`. */
    kind: "asset" | "family" | "kit";
    /** The pack's name: the asset's name, or the family's name by the pattern without a row. */
    name: string;
    generator: string;
    generatedAt?: string;
    revision?: string;
    /** Engine profile id. */
    profile: string;
    engine: {
        unit: string;
        unitMeters: number;
        up: "Y" | "Z";
    };
    naming: {
        pattern: string;
    };
    /** Only when checks ran: what they were run against. */
    assetClass?: AssetClass;
    budget?: GameBudget;
    player?: PlayerProfile;
    /** Only when checks ran: the worst status of any file. */
    status?: "pass" | "warn" | "fail";
    /** Every material of the pack by name, with the files that use it. A name means the same colour in every file. */
    materials: {
        name: string;
        color: string;
        baseColorFactor: [number, number, number, number];
        files: string[];
    }[];
    files: PackManifestFile[];
    /** Only in a kit pack written with its layouts: one scene for each layout, made of the pieces. */
    scenes?: PackManifestScene[];
    /** Only in a kit pack: the grid, the pieces with their sockets, the layouts, the checks and what a grid of tiles needs. */
    kit?: KitManifest;
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
export declare function manifestJson(value: unknown, indent?: string): string;
export declare const MANIFEST_MEDIA_TYPE = "application/json";
export declare const GLB_MEDIA_TYPE = "model/gltf-binary";
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
export declare function exportGamePack(input: PackInput): GamePack;
/** A pack as one ZIP archive: every file of it, stored. The same pack always gives the same bytes. */
export declare function packToZip(pack: Pick<GamePack, "files">): Uint8Array;
