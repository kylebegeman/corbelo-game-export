// A corridor kit built from plain boxes, in millimetres with Z up: seven pieces that share a
// grid and one socket type. Every open end shows the same outline, a floor slab with a wall on
// each side, with the same corners, so any two ends meet.
import type { AssetBodyInput, KitGrid, KitPackInput, KitPieceInput, KitSide, KitSocketInput } from "../src/index.js";
import { box, joined, MM_Z_UP, type Point, type Shape } from "./fixtures.js";

/** Thickness of the floor slab, in millimetres. */
export const SLAB = 200;
/** Thickness of a wall. */
export const WALL = 200;
/** The doorway: 1.4 m wide and 2.3 m tall. */
export const DOOR_WIDTH = 1400;
export const DOOR_HEIGHT = 2300;
/** The flat part at each end of the stairs. */
export const LANDING = 750;
export const STEPS = 15;

export const CORRIDOR_GRID = { moduleMeters: 3, storeyMeters: 3 } as const;

export const PIECE_NAMES = ["straight", "corner", "tee", "cross", "doorway", "endcap", "stairs"] as const;

type Boxes = [Point, Point][];

/** A prism along X: a flat outline in Y and Z, anticlockwise seen from +X, from `x0` to `x1`. Closed. */
export function prismX(outline: [number, number][], x0: number, x1: number): Shape {
  const positions: number[] = [];
  const faceIds: number[] = [];
  const count = outline.length;
  for (let k = 1; k + 1 < count; k += 1) {
    // Seen from +X the outline goes anticlockwise, so this end faces +X and the other is turned over.
    positions.push(x1, ...outline[0]!, x1, ...outline[k]!, x1, ...outline[k + 1]!);
    faceIds.push(0);
    positions.push(x0, ...outline[0]!, x0, ...outline[k + 1]!, x0, ...outline[k]!);
    faceIds.push(1);
  }
  for (let k = 0; k < count; k += 1) {
    const a = outline[k]!;
    const b = outline[(k + 1) % count]!;
    positions.push(x0, ...a, x0, ...b, x1, ...b, x0, ...a, x1, ...b, x1, ...a);
    faceIds.push(2 + k, 2 + k);
  }
  return { positions: Float32Array.from(positions), faceIds: Uint32Array.from(faceIds) };
}

/** One body from boxes: the boxes joined as what is seen, and each box a collision piece. */
export function bodyOf(name: string, boxes: Boxes, options: { color?: string; materialName?: string; visible?: Shape; collision?: Shape[] } = {}): AssetBodyInput {
  const shapes = boxes.map(([min, max]) => box(min, max));
  const visible = options.visible ?? joined(...shapes);
  return {
    name,
    positions: visible.positions,
    faceIds: visible.faceIds,
    color: options.color ?? "#8a8f98",
    materialName: options.materialName ?? "Concrete",
    collisionPieces: (options.collision ?? shapes).map((shape) => ({ positions: shape.positions })),
  };
}

function sizes(grid: KitGrid): { M: number; S: number } {
  return { M: Math.round(grid.moduleMeters * 1000), S: Math.round(grid.storeyMeters * 1000) };
}

/**
 * The boxes of a piece of one cell: a floor slab, a wall on every side that is not open, and a
 * post in every corner no wall fills. Walls along Y sides run the whole length; walls along X
 * sides fit between them.
 */
export function flatBoxes(grid: KitGrid, open: readonly KitSide[], wall = WALL): Boxes {
  const { M, S } = sizes(grid);
  const boxes: Boxes = [[[0, 0, 0], [M, M, SLAB]]];
  const closed = (side: KitSide): boolean => !open.includes(side);
  if (closed("-y")) boxes.push([[0, 0, SLAB], [M, wall, S]]);
  if (closed("+y")) boxes.push([[0, M - wall, SLAB], [M, M, S]]);
  if (closed("-x")) boxes.push([[0, wall, SLAB], [wall, M - wall, S]]);
  if (closed("+x")) boxes.push([[M - wall, wall, SLAB], [M, M - wall, S]]);
  for (const x of [0, M - wall]) {
    if (!closed("-y")) boxes.push([[x, 0, SLAB], [x + wall, wall, S]]);
    if (!closed("+y")) boxes.push([[x, M - wall, SLAB], [x + wall, M, S]]);
  }
  return boxes;
}

function sockets(open: readonly KitSide[]): KitSocketInput[] {
  return open.map((side) => ({ type: "corridor", side, passage: true }));
}

/** The frame in the middle of the doorway piece: two posts and what is over the door. */
export function doorBoxes(grid: KitGrid, doorWidth = DOOR_WIDTH): Boxes {
  const { M, S } = sizes(grid);
  const post = (M - 2 * WALL - doorWidth) / 2;
  const x: [number, number] = [M / 2 - 100, M / 2 + 100];
  return [
    [[x[0], WALL, SLAB], [x[1], WALL + post, S]],
    [[x[0], M - WALL - post, SLAB], [x[1], M - WALL, S]],
    [[x[0], WALL + post, SLAB + DOOR_HEIGHT], [x[1], M - WALL - post, S]],
  ];
}

/**
 * The stairs: two cells long and two storeys tall, in at the low end of the lower storey and
 * out at the high end of the upper one. What is seen has steps; what is walked on is a slope,
 * as games do it, so a character that climbs no steps goes up.
 */
export function stairsPiece(grid: KitGrid, options: { steps?: "slope" | "steps" } = {}): KitPieceInput {
  const { M, S } = sizes(grid);
  const boxes: Boxes = [[[0, 0, 0], [2 * M, M, SLAB]], [[2 * M - LANDING, 0, S], [2 * M, M, S + SLAB]]];
  for (const y of [0, M - WALL]) {
    boxes.push([[0, y, SLAB], [2 * M, y + WALL, S]]);
    boxes.push([[0, y, S], [2 * M - LANDING, y + WALL, S + SLAB]]);
    boxes.push([[0, y, S + SLAB], [2 * M, y + WALL, 2 * S]]);
  }
  const run = (2 * M - 2 * LANDING) / STEPS;
  const rise = S / STEPS;
  const steps: Boxes = Array.from({ length: STEPS }, (_, k) => [[LANDING + k * run, WALL, SLAB], [LANDING + (k + 1) * run, M - WALL, SLAB + (k + 1) * rise]]);
  // The slope under the steps: a wedge from the foot of the first step to the top of the last.
  const slope = prismX([[LANDING, SLAB], [2 * M - LANDING, SLAB], [2 * M - LANDING, SLAB + S]], WALL, M - WALL);
  const wedge: Shape = { positions: slope.positions.map((_, at) => (at % 3 === 0 ? slope.positions[at + 1]! : at % 3 === 1 ? slope.positions[at - 1]! : slope.positions[at]!)), faceIds: slope.faceIds };
  const shapes = boxes.map(([min, max]) => box(min, max));
  const stepShapes = steps.map(([min, max]) => box(min, max));
  return {
    name: "stairs",
    cells: [2, 1, 2],
    bodies: [bodyOf("stairs", [], { visible: joined(...shapes, ...stepShapes), collision: options.steps === "steps" ? [...shapes, ...stepShapes] : [...shapes, wedge] })],
    sockets: [
      { type: "corridor", side: "-x", cell: [0, 0, 0], passage: true },
      { type: "corridor", side: "+x", cell: [1, 0, 1], passage: true },
    ],
  };
}

export function piece(name: string, grid: KitGrid, open: readonly KitSide[], extra: Boxes = []): KitPieceInput {
  return { name, bodies: [bodyOf(name, [...flatBoxes(grid, open), ...extra])], sockets: sockets(open) };
}

/** The seven pieces for a grid. */
export function corridorPieces(grid: KitGrid): KitPieceInput[] {
  return [
    piece("straight", grid, ["+x", "-x"]),
    piece("corner", grid, ["+x", "+y"]),
    piece("tee", grid, ["+x", "-x", "+y"]),
    piece("cross", grid, ["+x", "-x", "+y", "-y"]),
    piece("doorway", grid, ["+x", "-x"], doorBoxes(grid)),
    piece("endcap", grid, ["+x"]),
    stairsPiece(grid),
  ];
}

/**
 * The kit as given to this package. `change` gets the pieces of the grid and returns the ones
 * to use, which is how the tests put one wrong piece in.
 */
export function corridorKit(change: (pieces: KitPieceInput[], grid: KitGrid) => KitPieceInput[] = (pieces) => pieces, more: Partial<KitPackInput> = {}): KitPackInput {
  return {
    name: "corridor",
    source: MM_Z_UP,
    grid: CORRIDOR_GRID,
    collision: "pieces",
    pieces: (grid) => change(corridorPieces(grid), grid),
    ...more,
  };
}

/** Puts `wrong` in the place of the piece of the same name. */
export function swap(wrong: (grid: KitGrid) => KitPieceInput): (pieces: KitPieceInput[], grid: KitGrid) => KitPieceInput[] {
  return (pieces, grid) => {
    const made = wrong(grid);
    return pieces.map((one) => (one.name === made.name ? made : one));
  };
}
