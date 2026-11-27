import { badOption, notObject } from "./errors.js";
import { assertJson } from "./export.js";
import { readGlb } from "./glb-read.js";
import { encodeGlb } from "./glb-write.js";
import { EXTRAS_KEY, type GltfBufferView, type GltfJson, type GltfNode } from "./gltf.js";
import { cellSize, kitOf, layoutOf, placePoint, type Kit, type KitCell, type KitGrid, type KitInput, type KitLayoutInput } from "./kit.js";
import { uniqueName } from "./names.js";
import type { EngineProfile } from "./profiles.js";
import type { Box, JsonValue, PackExtras, Vec3 } from "./types.js";
import { GENERATOR } from "./version.js";

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
  meshes: { total: number; visible: number; collision: number };
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
  triangles: { stored: number; drawn: number };
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
  levels: { level: number; name: string; node: number; visible: boolean; deviationMeters: number }[];
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

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6 + 0;
}

function cellTag(cell: KitCell): string {
  return cell.map((part) => (part < 0 ? `n${-part}` : String(part))).join("_");
}

/** A point of glTF space turned by quarter turns about +Y. */
function turned(point: readonly number[], turn: number): Vec3 {
  let x = point[0]!;
  let z = point[2]!;
  for (let n = turn; n > 0; n -= 1) [x, z] = [z, -x];
  return [x + 0, point[1]!, z + 0];
}

const HALF = Math.SQRT1_2;
/** Quarter turns about +Y as glTF quaternions [x, y, z, w]. */
const TURNS: readonly (readonly [number, number, number, number])[] = [[0, 0, 0, 1], [0, HALF, 0, HALF], [0, 1, 0, 0], [0, -HALF, 0, HALF]];

/** One piece of the kit, copied into the scene's file once. */
interface Stored {
  json: GltfJson;
  profile: EngineProfile | null;
  /** Where each of the piece's meshes went. */
  meshes: number[];
  /** The piece's meshes that are collision shapes, by their index in the piece's own file. */
  collision: Set<number>;
  roots: number[];
  /** For every node of the piece, the name of the body it is, or is under. Empty for none. */
  bodyOf: string[];
  /** Triangles of every mesh of the piece. */
  triangles: number[];
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
export function exportBlockout(input: KitInput | Kit, layout: string | KitLayoutInput, options: BlockoutOptions = {}): BlockoutResult {
  if (notObject(options)) badOption("Blockout options must be an object.");
  if (options.provenance !== undefined) assertJson(options.provenance, "provenance", 0);
  const kit = kitOf(input);
  const placed = layoutOf(kit, layout);
  const { grid } = kit;

  const json: GltfJson = { asset: { version: "2.0", generator: GENERATOR }, scene: 0, scenes: [{ name: placed.name, nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const nodes = json.nodes!;
  const parts: Uint8Array[] = [];
  let length = 0;
  const materialAt = new Map<string, number>();
  const meshNames = new Set<string>();
  const extensions = new Set<string>();
  const stored = new Map<string, Stored>();
  const collisionMeshes = new Set<number>();

  const store = (name: string): Stored => {
    const known = stored.get(name);
    if (known !== undefined) return known;
    const piece = kit.pieces.find((one) => one.name === name)!;
    const document = readGlb(piece.glb);
    const source = document.json;
    for (const extension of source.extensionsUsed ?? []) extensions.add(extension);
    const views = (source.bufferViews ?? []).map((view) => {
      const copy: GltfBufferView = { ...view, buffer: 0, byteOffset: length };
      parts.push(document.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
      length += (view.byteLength + 3) & ~3;
      json.bufferViews!.push(copy);
      return json.bufferViews!.length - 1;
    });
    const accessors = (source.accessors ?? []).map((accessor) => {
      json.accessors!.push({ ...accessor, ...(accessor.bufferView !== undefined ? { bufferView: views[accessor.bufferView]! } : {}) });
      return json.accessors!.length - 1;
    });
    // A material that is the same in two pieces is one material here: the kit's pieces share their slots.
    const materials = (source.materials ?? []).map((material) => {
      const key = JSON.stringify(material);
      let at = materialAt.get(key);
      if (at === undefined) {
        json.materials!.push(material);
        at = json.materials!.length - 1;
        materialAt.set(key, at);
      }
      return at;
    });
    const triangles: number[] = [];
    const meshes = (source.meshes ?? []).map((mesh) => {
      let count = 0;
      const primitives = mesh.primitives.map((primitive) => {
        const position = primitive.attributes["POSITION"];
        count += (primitive.indices !== undefined ? source.accessors![primitive.indices]!.count : position !== undefined ? source.accessors![position]!.count : 0) / 3;
        return {
          ...primitive,
          attributes: Object.fromEntries(Object.entries(primitive.attributes).map(([key, accessor]) => [key, accessors[accessor]!])),
          ...(primitive.indices !== undefined ? { indices: accessors[primitive.indices]! } : {}),
          ...(primitive.material !== undefined ? { material: materials[primitive.material]! } : {}),
        };
      });
      triangles.push(count);
      json.meshes!.push({ ...mesh, ...(mesh.name !== undefined ? { name: uniqueName(meshNames, mesh.name) } : {}), primitives });
      return json.meshes!.length - 1;
    });
    const collision = new Set<number>();
    const bodyOf: string[] = (source.nodes ?? []).map(() => "");
    const under = (node: number, body: string): void => {
      bodyOf[node] = body;
      for (const child of source.nodes?.[node]?.children ?? []) under(child, body);
    };
    for (const body of piece.facts.bodies) {
      under(body.node, body.name);
      for (const node of body.collision?.nodes ?? []) {
        collision.add(node.mesh);
        collisionMeshes.add(meshes[node.mesh]!);
      }
    }
    const extras = source.scenes?.[source.scene ?? 0]?.extras?.[EXTRAS_KEY] as PackExtras | undefined;
    const made: Stored = { json: source, profile: extras?.profile ?? null, meshes, collision, roots: [...(source.scenes?.[source.scene ?? 0]?.nodes ?? [])], bodyOf, triangles };
    stored.set(name, made);
    return made;
  };
  // Pieces go into the file in the kit's order, so the order of the placements does not move the bytes about.
  for (const piece of kit.pieces) {
    if (placed.placements.some((placement) => placement.piece === piece.name)) store(piece.name);
  }

  const used = new Set<string>();
  const lods: BlockoutLodFacts[] = [];
  const placements: BlockoutPlacementFacts[] = [];
  const counts = { visible: 0, collision: 0, drawn: 0 };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const placement of placed.placements) {
    const piece = kit.pieces.find((one) => one.name === placement.piece)!;
    const from = store(piece.name);
    const tag = cellTag(placement.cell);
    // The piece's own origin, in its place: in the kit's frame, then in the file's.
    const at: Vec3 = [0, 0, 0];
    placePoint(piece.pivotMeters, placement, grid, at);
    const translation: Vec3 = [round(at[0]), round(at[2]), round(-at[1])];
    const rotation = TURNS[placement.turn]!;

    // Every node of the piece again, under names of this place. A name the engine reads a
    // collision shape or a detail level from keeps what the engine reads, around the new body name.
    const renamed = new Map<string, string>();
    const nameOf = (node: number): string => {
      const name = from.json.nodes![node]!.name ?? `node_${node}`;
      const body = from.bodyOf[node]!;
      if (body === "" || name === body) return uniqueName(used, `${name}_${tag}`);
      let bodyName = renamed.get(body);
      if (bodyName === undefined) renamed.set(body, (bodyName = uniqueName(used, `${body}_${tag}`)));
      const rules = [...(from.profile?.conventions.collision ?? []), ...(from.profile?.conventions.lod ?? [])];
      for (const prefix of ["", ...rules.map((rule) => rule.pattern.slice(0, Math.max(0, rule.pattern.indexOf("{name}"))))]) {
        if (name.startsWith(prefix + body)) return uniqueName(used, bodyName, (candidate) => `${prefix}${candidate}${name.slice(prefix.length + body.length)}`);
      }
      return uniqueName(used, `${name}_${tag}`);
    };
    const copied = new Map<number, number>();
    const copy = (node: number): number => {
      const source = from.json.nodes![node]!;
      const body = from.bodyOf[node]!;
      let name: string;
      if (source.name !== undefined && source.name === body) {
        name = renamed.get(body) ?? uniqueName(used, `${body}_${tag}`);
        renamed.set(body, name);
      } else {
        name = nameOf(node);
      }
      const made: GltfNode = { ...source, name };
      delete made.children;
      if (source.mesh !== undefined) {
        made.mesh = from.meshes[source.mesh]!;
        if (from.collision.has(source.mesh)) {
          counts.collision += 1;
        } else {
          counts.visible += 1;
          counts.drawn += from.triangles[source.mesh]!;
        }
      }
      nodes.push(made);
      const index = nodes.length - 1;
      copied.set(node, index);
      const children = (source.children ?? []).map(copy);
      if (children.length > 0) made.children = children;
      return index;
    };

    const only = from.roots.length === 1 ? from.json.nodes![from.roots[0]!]! : undefined;
    let holder: number;
    if (only !== undefined && only.rotation === undefined && only.scale === undefined && only.matrix === undefined) {
      // One body: its node is the node of the place.
      holder = copy(from.roots[0]!);
      const own = turned(only.translation ?? [0, 0, 0], placement.turn);
      nodes[holder]!.translation = [round(translation[0] + own[0]), round(translation[1] + own[1]), round(translation[2] + own[2])];
    } else {
      nodes.push({ name: uniqueName(used, `${piece.asset}_${tag}`) });
      holder = nodes.length - 1;
      nodes[holder]!.children = from.roots.map(copy);
      nodes[holder]!.translation = translation;
    }
    if (placement.turn !== 0) nodes[holder]!.rotation = [...rotation];
    json.scenes![0]!.nodes!.push(holder);
    placements.push({ piece: piece.name, asset: piece.asset, cell: placement.cell, turn: placement.turn, name: nodes[holder]!.name!, node: holder, translation, degrees: (placement.turn * 90) as 0 | 90 | 180 | 270 });
    for (const body of piece.facts.bodies) {
      if (body.lods === undefined || body.lods.length < 2) continue;
      lods.push({
        placement: placements.length - 1,
        body: nodes[copied.get(body.node)!]!.name!,
        levels: body.lods.map((level) => ({ level: level.level, name: nodes[copied.get(level.node)!]!.name!, node: copied.get(level.node)!, visible: level.visible, deviationMeters: level.deviation.meters })),
      });
    }

    const box = piece.facts.total.bounds.meters;
    for (const corner of [box.min, box.max]) {
      const point = turned(corner, placement.turn);
      for (const axis of [0, 1, 2] as const) {
        min[axis] = Math.min(min[axis], point[axis] + translation[axis]);
        max[axis] = Math.max(max[axis], point[axis] + translation[axis]);
      }
    }
  }

  const size = cellSize(grid);
  const visibleMeshes = json.meshes!.length - collisionMeshes.size;
  let storedTriangles = 0;
  for (const from of stored.values()) for (const [mesh, count] of from.triangles.entries()) if (!from.collision.has(mesh)) storedTriangles += count;
  const facts: BlockoutFacts = {
    schema: 1,
    generator: GENERATOR,
    kind: "blockout",
    kit: kit.name,
    layout: placed.name,
    origin: placed.origin,
    profile: kit.profile,
    grid,
    cellSize: [size[0], size[2], size[1]],
    placements,
    pieces: stored.size,
    meshes: { total: json.meshes!.length, visible: visibleMeshes, collision: collisionMeshes.size },
    nodes: { total: nodes.length, placements: placements.length, visible: counts.visible, collision: counts.collision },
    materials: json.materials!.length,
    triangles: { stored: storedTriangles, drawn: counts.drawn },
    bounds: { min: [round(min[0]), round(min[1]), round(min[2])], max: [round(max[0]), round(max[1]), round(max[2])], size: [round(max[0] - min[0]), round(max[1] - min[1]), round(max[2] - min[2])] },
    ...(lods.length > 0 ? { lods } : {}),
  };
  const extras: BlockoutExtras = { schema: 1, blockout: facts, ...(options.provenance !== undefined ? { provenance: options.provenance } : {}) };
  json.scenes![0]!.extras = { [EXTRAS_KEY]: extras };
  if (extensions.size > 0) json.extensionsUsed = [...extensions].sort();
  if (json.materials!.length === 0) delete json.materials;

  const bin = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bin.set(part, offset);
    offset += (part.length + 3) & ~3;
  }
  json.buffers = [{ byteLength: bin.length }];
  return { glb: encodeGlb(json, bin), facts };
}
