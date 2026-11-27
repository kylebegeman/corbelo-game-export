import { type CheckOptions } from "./checks.js";
import { type KitCheckOptions, type KitCheckReport } from "./kit-checks.js";
import { type KitCell, type KitGrid, type KitInput, type KitLayout, type KitSocket } from "./kit.js";
import { type GamePack } from "./pack.js";
import type { Vec3 } from "./types.js";
export interface KitPackInput extends KitInput {
    /**
     * Options for the kit checks, or `false` to run none. Default: checks with their own
     * defaults, and with the kit's own `kernel` when it has one.
     */
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
    frame: {
        up: "Z";
        toFile: "x, y, z in the kit is x, z, -y in the files";
    };
    grid: KitGrid;
    /** One cell in the files' axes, in metres: along X, up, and along Z. */
    cellSize: Vec3;
    /** Which socket type meets which, for every type that meets another than itself. */
    mates: Record<string, string>;
    pieces: KitManifestPiece[];
    /** Every layout: the test layouts built from the sockets, then the caller's own. `scene` names its file when the pack has one. */
    layouts: (KitLayout & {
        scene?: string;
    })[];
    /** Test layouts the kit has no pieces for, and why. */
    skippedLayouts: {
        name: string;
        reason: string;
    }[];
    /** Only when the kit checks ran. */
    checks?: KitCheckReport;
    meshLibrary: KitMeshLibrary;
}
/**
 * Makes a kit pack: one GLB for each piece, named by the pattern, one scene for each layout,
 * and a manifest of kind `"kit"` that lists every file with its size and SHA-256 and holds the
 * kit's grid, its pieces with their sockets, its layouts, the results of the seven kit checks
 * and the items of a mesh library.
 *
 * A material name means one colour in every piece, and material slots are in the order of the
 * names, so the pieces share their slots. The same input always gives the same bytes.
 */
export declare function exportKitPack(input: KitPackInput): GamePack;
