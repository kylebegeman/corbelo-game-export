import type { MessageValues } from "./messages.js";
import type { AssetBodyInput, AssetOptions, JsonValue, PackFacts, SourceSpace, Vec3 } from "./types.js";
/**
 * A side of a cell, in the kit's own frame: X to the right, Y away and Z up, right-handed. For
 * a source that is Z up and right-handed, these are the source's own axes. In glTF space the
 * kit's X is X, its Y is -Z and its Z is Y.
 */
export type KitSide = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";
export declare const KIT_SIDES: readonly KitSide[];
/** How far trim may reach past a piece's cells, in metres, when the grid does not say. */
export declare const DEFAULT_TRIM_METERS = 0.1;
/** A plane that is turned more than this many degrees from every axis is not a socket. */
export declare const SOCKET_AXIS_DEGREES = 1;
export interface KitGridInput {
    /** The side of one cell on the ground, in metres. */
    moduleMeters: number;
    /** The height of one cell, in metres. */
    storeyMeters: number;
    /** How far a body declared as trim may reach past its piece's cells, in metres. Default 0.1. */
    trimMeters?: number;
}
export interface KitGrid {
    moduleMeters: number;
    storeyMeters: number;
    trimMeters: number;
}
/** A cell by number: along X, along Y, and the storey. */
export type KitCell = [number, number, number];
/**
 * A face where the piece meets another piece. Give `side`, with the cell when the piece has
 * more than one, or give `plane` as a point and a normal, the way a face a person clicked comes.
 */
export interface KitSocketInput {
    /** Default: the side and the cell, like `"+x"` or `"+x@1,0,0"`. */
    name?: string;
    /** What meets what: sockets of one type meet each other, or the type `mates` names. */
    type: string;
    side?: KitSide;
    /** Which cell of the piece the socket is a face of. Default `[0, 0, 0]`. */
    cell?: readonly [number, number, number];
    /** In the piece's units and axes. The normal points out of the piece. */
    plane?: {
        point: readonly [number, number, number];
        normal: readonly [number, number, number];
    };
    /** The outline of the part of the face that meets, as points on the plane in the piece's units and axes. Default: the whole face of the cell. */
    region?: readonly (readonly [number, number, number])[];
    /** True when the player walks through this socket. Default false. */
    passage?: boolean;
}
export interface KitPieceInput {
    /** What tells this piece from the others: "straight", "corner". Goes into its file name by the pattern. */
    name: string;
    /** The piece as bodies, in the kit's source space. Give this or `glb`. */
    bodies?: readonly AssetBodyInput[];
    /**
     * The piece as an asset this package already wrote. Its own origin is the piece's pivot, and
     * its `origin`, planes and regions are read in glTF space: metres, +Y up.
     */
    glb?: Uint8Array;
    /** How many cells the piece takes: along X, along Y, and storeys. Default `[1, 1, 1]`. */
    cells?: readonly [number, number, number];
    /** The corner of the piece's cells that is lowest along every kit axis, in the piece's units and axes. Default `[0, 0, 0]`. */
    origin?: readonly [number, number, number];
    /** The piece's own origin in the engine, in the piece's units and axes. Default: `origin`. Not for a `glb` piece. */
    pivot?: readonly [number, number, number];
    sockets?: readonly KitSocketInput[];
    /** Names of bodies that are trim: declared to overlap what is next to the piece. */
    trim?: readonly string[];
    /** Opaque JSON about this piece. Stored in its GLB and in the manifest. */
    provenance?: JsonValue;
}
export interface KitPlacementInput {
    piece: string;
    /** The cell the piece's first cell, `[0, 0, 0]`, lands on. */
    cell: readonly [number, number, number];
    /** Quarter turns about the up axis, anticlockwise seen from above, about the middle of the piece's first cell. Default 0. */
    turn?: number;
}
export interface KitPlacement {
    piece: string;
    cell: KitCell;
    turn: 0 | 1 | 2 | 3;
}
export interface KitLayoutInput {
    name: string;
    placements: readonly KitPlacementInput[];
}
export interface KitLayout {
    name: string;
    /** `"generated"` for a test layout built from the sockets, `"given"` for one the caller wrote. */
    origin: "generated" | "given";
    placements: KitPlacement[];
}
export interface KitInput extends Omit<AssetOptions, "pivot" | "pivots" | "placement" | "collisions"> {
    /** The kit's name: "corridor". */
    name: string;
    source: SourceSpace;
    grid: KitGridInput;
    /** The pieces, or a function that makes them for a grid, so that another module size is one call. */
    pieces: readonly KitPieceInput[] | ((grid: KitGrid) => readonly KitPieceInput[]);
    /** Socket types that meet a type other than their own: `{ "plug": "hole" }`. It reads both ways. */
    mates?: Readonly<Record<string, string>>;
    /** Layouts of the caller's own, checked and exported with the test layouts. */
    layouts?: readonly KitLayoutInput[];
    /** The name pattern, as `assetName` reads it, with the kit as the family and the piece as the row. */
    naming?: string;
}
export interface KitSocket {
    /** Unique in its piece. */
    name: string;
    type: string;
    side: KitSide;
    cell: KitCell;
    passage: boolean;
    /** How far the plane given is from the face of the cell, along the normal, in metres. Zero for a socket given by side. */
    offsetMeters: number;
    /** The outline in the socket's own frame, in metres from the middle of the face. Null for the whole face. */
    region: [number, number][] | null;
}
export interface KitPiece {
    /** As given. */
    name: string;
    /** The file's name without `.glb`. */
    asset: string;
    cells: KitCell;
    /** The pivot, from the low corner of the piece's cells, in the kit frame, in metres. */
    pivotMeters: Vec3;
    sockets: KitSocket[];
    trim: string[];
    glb: Uint8Array;
    facts: PackFacts;
    provenance?: JsonValue;
}
/** A kit with every piece written and every socket placed on its cell. */
export interface Kit {
    name: string;
    /** Engine profile id. */
    profile: string;
    grid: KitGrid;
    naming: string;
    /** Every type and the type it meets, both ways. */
    mates: Record<string, string>;
    pieces: KitPiece[];
    /** The caller's own layouts. */
    layouts: KitLayout[];
}
/** The axis a side faces along: 0, 1 or 2. */
export declare function sideAxis(side: KitSide): 0 | 1 | 2;
/** 1 for a side that faces along its axis, -1 for one that faces against it. */
export declare function sideSign(side: KitSide): 1 | -1;
export declare function oppositeSide(side: KitSide): KitSide;
/** A side after quarter turns about the up axis, anticlockwise seen from above. */
export declare function turnSide(side: KitSide, turn: number): KitSide;
/** A cell of a piece after quarter turns about the middle of the piece's first cell. */
export declare function turnCell(cell: readonly number[], turn: number): KitCell;
/** The size of one cell in metres: along X, along Y and up. */
export declare function cellSize(grid: KitGrid): Vec3;
/**
 * Where a point of a piece ends up when the piece is placed. The point is in metres from the
 * low corner of the piece's cells, in the kit frame, and so is the result, from the low corner
 * of cell `[0, 0, 0]` of the layout.
 */
export declare function placePoint(point: ArrayLike<number>, placement: KitPlacement, grid: KitGrid, out?: number[] | Float64Array, at?: number): void;
/** The type a socket type meets. */
export declare function mateOf(kit: Pick<Kit, "mates">, type: string): string;
export declare function readGrid(grid: KitGridInput): KitGrid;
/**
 * A socket's own frame: the middle of its face, in metres from the low corner of the piece's
 * cells, the two axes across the face, and half the face's size along each. Two sockets that
 * meet see each other mirrored: a point at `(u, v)` of one is at `(-u, v)` of the other.
 */
export declare function socketFrame(socket: Pick<KitSocket, "side" | "cell">, grid: KitGrid): {
    center: Vec3;
    u: Vec3;
    v: Vec3;
    halfU: number;
    halfV: number;
};
/** Checks a layout the caller wrote against the pieces there are. */
export declare function readLayout(layout: KitLayoutInput, pieces: readonly {
    name: string;
}[]): KitLayout;
/**
 * Reads a kit: checks what was given, writes every piece as a game asset with its pivot at the
 * scene origin, and puts every socket on a face of a cell. `grid` replaces the kit's own grid,
 * so a kit whose pieces are a function of the grid is rebuilt for another module in one call.
 *
 * The same input always gives the same bytes.
 */
export declare function resolveKit(input: KitInput, grid?: KitGridInput): Kit;
/** True for a kit `resolveKit` returned, false for one as it is given. */
export declare function isKit(value: KitInput | Kit): value is Kit;
/** A kit as `resolveKit` returns it, from that or from a kit as it is given. */
export declare function kitOf(input: KitInput | Kit, grid?: KitGridInput): Kit;
/** A layout by name, among the test layouts and the kit's own, or a layout as given. */
export declare function layoutOf(kit: Kit, layout: string | KitLayoutInput): KitLayout;
/** One socket of one placed piece: where its face is in the layout. */
export interface PlacedSocket {
    /** Index into the layout's placements. */
    placement: number;
    /** Index into the piece's sockets. */
    socket: number;
    piece: string;
    name: string;
    type: string;
    cell: KitCell;
    side: KitSide;
}
export interface LayoutJoint {
    a: PlacedSocket;
    b: PlacedSocket;
}
export interface LayoutJoints {
    /** Two sockets face to face whose types meet. */
    joints: LayoutJoint[];
    /** Sockets that face a cell nothing is in. */
    open: PlacedSocket[];
    /** Sockets that face a cell of a piece that has no socket there. */
    blocked: PlacedSocket[];
    /** Two sockets face to face whose types do not meet. */
    mismatched: LayoutJoint[];
    /** Cells more than one piece is in. */
    doubled: {
        cell: KitCell;
        pieces: string[];
    }[];
    /** How many cells the layout fills. */
    cells: number;
}
/** Works out what meets what in a layout: from the cells and the sockets alone, no geometry. */
export declare function layoutJoints(kit: Pick<Kit, "pieces" | "mates">, layout: Pick<KitLayout, "name" | "placements">): LayoutJoints;
/** The names of the test layouts, in the order they come. */
export declare const KIT_LAYOUT_NAMES: readonly ["run", "corner", "tee", "cross", "rise", "room"];
/** A test layout the kit has no pieces for, and why: in English, and as a key of the message catalog with the values that fill it. */
export interface SkippedLayout {
    name: string;
    reason: string;
    /** Not on a report written before version 0.1.8. */
    reasonKey?: string;
    reasonValues?: MessageValues;
}
/**
 * Builds the test layouts from the sockets alone: a straight run, a corner, a tee, a crossing,
 * a rise from one storey to the next and a closed room. A layout the kit has no pieces for is
 * left out, with the reason.
 *
 * A piece is read by its sockets on the four sides. One: an end. Two on opposite sides of one
 * storey: a through piece. Two at a right angle: a bend. Two on different storeys: a rise.
 * Three and four: a tee and a crossing.
 */
export declare function kitLayouts(kit: Pick<Kit, "pieces" | "mates">): {
    layouts: KitLayout[];
    skipped: SkippedLayout[];
};
