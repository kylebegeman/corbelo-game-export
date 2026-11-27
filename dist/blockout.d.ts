import { type Kit, type KitCell, type KitGrid, type KitInput, type KitLayoutInput } from "./kit.js";
import type { Box, JsonValue, Vec3 } from "./types.js";
export interface BlockoutOptions {
    /** Opaque JSON stored next to the facts in the scene extras. */
    provenance?: JsonValue;
}
/** One piece in its place. */
export interface BlockoutPlacementFacts {
    /** The piece's name in the kit. */
    piece: string;
    /** The piece's asset name: its file name without `.glb`. */
    asset: string;
    cell: KitCell;
    turn: 0 | 1 | 2 | 3;
    /** The name of the node that holds the piece: the asset name and the cell. */
    name: string;
    /** Index of that node in the glTF `nodes` array. */
    node: number;
    /** Where the piece's own origin is in the scene: metres, +Y up. */
    translation: Vec3;
    /** The turn about +Y, in degrees. */
    degrees: 0 | 90 | 180 | 270;
}
export interface BlockoutFacts {
    /** Version of this facts layout. */
    schema: 1;
    generator: string;
    kind: "blockout";
    /** The kit's name. */
    kit: string;
    /** The layout's name. */
    layout: string;
    /** `"generated"` for a test layout built from the sockets, `"given"` for one the caller wrote. */
    origin: "generated" | "given";
    /** Engine profile id. */
    profile: string;
    grid: KitGrid;
    /** One cell in the file's axes, in metres: along X, up, and along Z. */
    cellSize: Vec3;
    placements: BlockoutPlacementFacts[];
    /** Distinct pieces of the kit in the layout. */
    pieces: number;
    /** Every mesh is stored once, however many nodes show it. */
    meshes: {
        total: number;
        visible: number;
        collision: number;
    };
    nodes: {
        total: number;
        /** Nodes that hold a piece: one for each placement. */
        placements: number;
        /** Nodes that show a mesh. */
        visible: number;
        /** Nodes that are a collision shape. */
        collision: number;
    };
    materials: number;
    /** Triangles of the meshes that are seen: as stored, and as drawn when every node shows its mesh. */
    triangles: {
        stored: number;
        drawn: number;
    };
    /** The box around every piece in its place, in metres. */
    bounds: Box;
    /** Only when a piece has detail levels: for each body with levels, in each place, the nodes that hold them. */
    lods?: BlockoutLodFacts[];
}
/** The detail levels of one body of a piece in one place of a blockout. */
export interface BlockoutLodFacts {
    /** Which placement, counted from 0. */
    placement: number;
    /** The body's node name in the scene. */
    body: string;
    /** Level 0 first. `node` is the node that holds the level and `deviationMeters` how far its outline is from level 0. */
    levels: {
        level: number;
        name: string;
        node: number;
        visible: boolean;
        deviationMeters: number;
    }[];
}
export interface BlockoutResult {
    glb: Uint8Array;
    facts: BlockoutFacts;
}
/** What `scenes[0].extras.corbeloGameExport` of a blockout holds. */
export interface BlockoutExtras {
    schema: 1;
    blockout: BlockoutFacts;
    provenance?: JsonValue;
}
/**
 * Writes a layout of kit pieces as one scene: one node for each placement, named after the
 * piece and its cell, with the piece's own nodes under it as its own file has them: collision
 * shapes, detail levels and attach points. Every mesh is stored once, and a piece placed many
 * times is one mesh shown by many nodes. Cell `[0, 0, 0]` has its lowest corner at the scene
 * origin.
 *
 * `layout` is the name of a test layout or of one of the kit's own, or a layout as data: piece,
 * cell and quarter turn. The same input always gives the same bytes.
 */
export declare function exportBlockout(input: KitInput | Kit, layout: string | KitLayoutInput, options?: BlockoutOptions): BlockoutResult;
