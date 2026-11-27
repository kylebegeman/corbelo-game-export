import { planCollision, readCollisionSettings, type CollisionPiece } from "./collision.js";
import { forBody, refuse } from "./errors.js";
import { boundsOf, draftScene, finishScene, isArrayLike, measuredBox, readPivot, toEngine, type DraftBody, type DraftMesh } from "./export.js";
import { COMPONENT_FLOAT, COMPONENT_UNSIGNED_INT, COMPONENT_UNSIGNED_SHORT, MODE_TRIANGLES, NODE_VISIBILITY_EXTENSION, TARGET_ARRAY_BUFFER, TARGET_ELEMENT_ARRAY_BUFFER } from "./gltf.js";
import { meshDeviation } from "./lod.js";
import { clearName, uniqueName } from "./names.js";
import type { EngineProfile, NodeNameConvention, NodeRole } from "./profiles.js";
import { toGltfSpace } from "./space.js";
import type { AssetBodyInput, AssetInput, AttachPointFacts, CollisionFacts, CollisionNodeFacts, ExportResult, LodFacts, Vec3 } from "./types.js";
import { boxProject, DEFAULT_TILE_METERS } from "./uv.js";

function isPoint(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((part) => Number.isFinite(part));
}

/** Checks what a body has beyond a plain body. The meshes of detail levels are checked with the body's own. */
function checkAssetBody(body: AssetBodyInput): void {
  if (typeof body !== "object" || body === null) return;
  const label = `Body "${String(body.name)}"`;
  if (body.lods !== undefined && !Array.isArray(body.lods)) refuse("BAD_LOD", `${label}: lods must be a list of meshes, the nearest to full detail first.`);
  if (body.collisionPieces !== undefined) {
    if (!Array.isArray(body.collisionPieces)) refuse("BAD_COLLISION", `${label}: collisionPieces must be a list of { positions }.`);
    for (const [at, piece] of body.collisionPieces.entries()) {
      const where = `${label}, collision piece ${at}`;
      if (typeof piece !== "object" || piece === null || !isArrayLike(piece.positions)) refuse("BAD_COLLISION", `${where} needs positions: x, y, z for each point.`);
      if (piece.positions.length < 12 || piece.positions.length % 3 !== 0) refuse("BAD_COLLISION", `${where}: positions must hold x, y, z for at least four points.`);
      for (let n = 0; n < piece.positions.length; n += 1) {
        if (!Number.isFinite(piece.positions[n])) refuse("BAD_COLLISION", `${where}: point ${Math.floor(n / 3)} has a coordinate that is not a finite number.`);
      }
    }
  }
  if (body.attachPoints !== undefined) {
    if (!Array.isArray(body.attachPoints)) refuse("BAD_ATTACH_POINT", `${label}: attachPoints must be a list of { name, position }.`);
    for (const [at, point] of body.attachPoints.entries()) {
      const where = `${label}, attach point ${at}`;
      if (typeof point !== "object" || point === null) refuse("BAD_ATTACH_POINT", `${where} is not an object.`);
      if (typeof point.name !== "string" || point.name.trim() === "") refuse("BAD_ATTACH_POINT", `${where} needs a name.`);
      if (!isPoint(point.position)) refuse("BAD_ATTACH_POINT", `${where}: position must be three finite numbers [x, y, z] in source units.`);
      if (point.direction !== undefined && (!isPoint(point.direction) || Math.hypot(...point.direction) === 0)) {
        refuse("BAD_ATTACH_POINT", `${where}: direction must be three finite numbers [x, y, z] that are not all zero.`);
      }
    }
  }
}

/**
 * What an option gives each body: a list in the order of the bodies, or an object by body name.
 * Nothing for a body it leaves to the option of the whole asset.
 */
function perBody<T>(key: string, given: readonly (T | null | undefined)[] | Readonly<Record<string, T>> | undefined, bodies: readonly AssetBodyInput[]): (T | undefined)[] {
  if (given === undefined) return [];
  if (typeof given !== "object" || given === null) refuse("BAD_OPTION", `${key} must be a list in the order of the bodies, or an object with an entry for each body name.`);
  const list = Array.isArray(given) ? given : undefined;
  const names = list !== undefined ? [] : Object.keys(given);
  const missing = names.find((name) => !bodies.some((body) => body?.name === name));
  if (missing !== undefined) refuse("BAD_OPTION", `${key} has an entry for a body named "${missing}", and no body has that name.`);
  if (list !== undefined && list.length > bodies.length) refuse("BAD_OPTION", `${key} has ${list.length} entries, and there are ${bodies.length} bodies.`);
  return bodies.map((body, index) => (list !== undefined ? list[index] : names.includes(body?.name) ? (given as Readonly<Record<string, T>>)[body.name] : undefined) ?? undefined);
}

/** Fills in a profile's name pattern: `{name}`, `{n}` counted from 0, and `{nn}` the same with two digits. */
function fromPattern(pattern: string, name: string, n: number): string {
  return pattern.replaceAll("{name}", name).replaceAll("{nn}", String(n).padStart(2, "0")).replaceAll("{n}", String(n));
}

function rule(profile: EngineProfile, roles: readonly NodeRole[]): NodeNameConvention | undefined {
  for (const role of roles) {
    const found = profile.conventions.collision.find((convention) => convention.role === role);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The name of one collision node, the way the profile's engine reads it. A rule with no counter
 * of its own gets one in the name it wraps: `Crate_00-convcolonly`. A profile with no rule gets
 * `Crate_collision_00`.
 */
function collisionName(profile: EngineProfile, kind: CollisionPiece["kind"], body: string, n: number, used: Set<string>): { name: string; role: NodeRole | null } {
  // A box is written for the engine to hold as a box where it reads one, and as a convex shape otherwise.
  const found = rule(profile, kind === "box" ? ["collision-box", "collision-convex-only", "collision-convex"] : ["collision-convex-only", "collision-convex"]);
  const nn = String(n).padStart(2, "0");
  if (found === undefined) return { name: uniqueName(used, `${body}_collision_${nn}`), role: null };
  const counted = /\{nn?\}/.test(found.pattern);
  return { name: uniqueName(used, counted ? body : `${body}_${nn}`, (candidate) => fromPattern(found.pattern, candidate, n)), role: found.role };
}

/** The turn that takes +Z to a direction of length 1, by the shortest way, as a glTF quaternion [x, y, z, w]. */
function turnFromZ(direction: Vec3): [number, number, number, number] | undefined {
  const [x, y, z] = direction;
  if (z > 1 - 1e-12) return undefined;
  // Straight back: half a turn about +Y.
  if (z < -1 + 1e-12) return [0, 1, 0, 0];
  const length = Math.hypot(-y, x, 1 + z);
  return [-y / length + 0, x / length + 0, 0, (1 + z) / length];
}

/**
 * Turns bodies into one game asset: the GLB `exportGameGlb` writes, with a collision shape named
 * the way the profile's engine reads it, the lower detail levels the caller made, texture
 * coordinates on request and attach points as empty nodes. The facts say what was written.
 *
 * Detail levels are laid out for the engine. Where the profile has a rule for level names, the
 * body's node holds no mesh and every level is a child of it, named by the rule. Where it has
 * none, the body's node holds the full level and the lower levels are children of it, written
 * hidden with `KHR_node_visibility` so that they are not all drawn at once.
 *
 * Material slots come in the order of the material names, so they do not move from one
 * revision of a part to the next. The same input always gives the same bytes.
 */
export function exportGameAsset(input: AssetInput): ExportResult {
  if (typeof input !== "object" || input === null) refuse("NO_BODIES", "exportGameAsset needs { bodies, source }.");
  const collision = readCollisionSettings(input.collision);
  let tileMeters: number | undefined;
  if (input.texcoords !== undefined && input.texcoords !== false) {
    if (input.texcoords !== true && (typeof input.texcoords !== "object" || input.texcoords === null)) refuse("BAD_OPTION", "texcoords must be true, false or { tileMeters }.");
    tileMeters = (input.texcoords === true ? undefined : input.texcoords.tileMeters) ?? DEFAULT_TILE_METERS;
    if (!(Number.isFinite(tileMeters) && tileMeters > 0)) refuse("BAD_OPTION", `texcoords.tileMeters must be a positive number of metres. Got ${String(tileMeters)}.`);
  }
  if (input.kernel !== undefined && (typeof input.kernel !== "object" || input.kernel === null || typeof input.kernel.solid !== "function")) {
    refuse("BAD_OPTION", "kernel must be an object with a solid(positions, indices) function.");
  }
  const bodies: readonly AssetBodyInput[] = Array.isArray(input.bodies) ? input.bodies : [];
  for (const [index, body] of bodies.entries()) forBody(index, () => checkAssetBody(body));

  const pivots = perBody("pivots", input.pivots, bodies);
  for (const [index, pivot] of pivots.entries()) if (pivot !== undefined) forBody(index, () => readPivot(pivot, `The pivot of body "${bodies[index]!.name}"`));
  const tile = tileMeters;
  const draft = draftScene(input, {
    caller: "exportGameAsset",
    pivots,
    levels: bodies.map((body) => (typeof body === "object" && body !== null ? body.lods : undefined)),
    slotOrder: "name",
    ...(tile !== undefined ? { texture: (mesh, offset) => boxProject(mesh, offset, tile) } : {}),
  });
  const { json, binary, profile, conversion, facts } = draft;
  const nodes = json.nodes!;
  const meshes = json.meshes!;
  const accessors = json.accessors!;
  const used = new Set(draft.names.map((name) => name.toLowerCase()));
  const child = (parent: number, node: (typeof nodes)[number]): number => {
    nodes.push(node);
    (nodes[parent]!.children ??= []).push(nodes.length - 1);
    return nodes.length - 1;
  };

  facts.settings.collision = { ...collision, kernel: input.kernel !== undefined };
  if (tile !== undefined) facts.settings.texcoords = { projection: "box", tileMeters: tile };
  // An engine that reads detail levels from names wants every level as a child of one node.
  const levelRule = profile.conventions.lod.find((convention) => convention.role === "lod");
  if (draft.bodies.some((body) => body.levels.length > 0)) facts.settings.lodLayout = levelRule !== undefined ? "group" : "children";

  for (const [index, body] of bodies.entries()) {
    forBody(index, () => {
      const drafted: DraftBody = draft.bodies[index]!;
      const bodyFacts = facts.bodies[index]!;
      const name = draft.names[index]!;
      const { pivot, translation } = drafted;

      // Detail levels.
      if (drafted.levels.length > 0) {
        const levelName = (level: number): string => fromPattern(levelRule?.pattern ?? "{name}_LOD{n}", name, level);
        const diagonal = Math.hypot(...[0, 1, 2].map((axis) => drafted.local.max[axis]! - drafted.local.min[axis]!));
        const levelFacts = (level: number, written: DraftMesh, levelNode: number, writtenName: string, visible = true): LodFacts => {
          const meters = level === 0 ? 0 : meshDeviation(drafted.stored, drafted.mesh.indices, written.stored, written.mesh.indices);
          return {
            level,
            name: writtenName,
            node: levelNode,
            mesh: written.meshIndex,
            visible,
            triangles: written.mesh.triangles,
            vertices: written.slots.reduce((total, slot) => total + slot.vertices, 0),
            materialSlots: written.slots.length,
            materials: written.slots.map((slot) => slot.material),
            degenerateTrianglesDropped: written.mesh.degenerateTrianglesDropped,
            openEdges: written.mesh.openEdges,
            nonManifoldEdges: written.mesh.nonManifoldEdges,
            deviation: { meters, engine: meters / profile.unitMeters, share: diagonal > 0 ? meters / diagonal : 0 },
          };
        };
        const lods: LodFacts[] = [];
        if (levelRule !== undefined) {
          // The body's node becomes an empty node that holds every level, level 0 too.
          const fullName = uniqueName(used, levelName(0));
          delete nodes[index]!.mesh;
          meshes[drafted.meshIndex]!.name = fullName;
          lods.push(levelFacts(0, drafted, child(index, { name: fullName, mesh: drafted.meshIndex }), fullName));
        } else {
          lods.push(levelFacts(0, drafted, index, name));
        }
        for (const [at, level] of drafted.levels.entries()) {
          const lowerName = uniqueName(used, levelName(at + 1));
          meshes[level.meshIndex]!.name = lowerName;
          // An engine with no rule for level names would draw every level at once, one inside
          // the other. There the lower levels are written hidden, for the game to show in turn.
          const hidden = levelRule === undefined;
          if (hidden) json.extensionsUsed = [NODE_VISIBILITY_EXTENSION];
          const levelNode = child(index, { name: lowerName, mesh: level.meshIndex, ...(hidden ? { extensions: { [NODE_VISIBILITY_EXTENSION]: { visible: false } } } : {}) });
          lods.push(levelFacts(at + 1, level, levelNode, lowerName, !hidden));
        }
        bodyFacts.lods = lods;
      }

      // Collision, planned in the body's own frame: metres from its pivot.
      if (collision.shape !== "none") {
        const pieces = body.collisionPieces?.map((piece) => {
          const points = new Float64Array(piece.positions.length);
          toGltfSpace(piece.positions, conversion, points);
          for (let at = 0; at < points.length; at += 1) points[at] = points[at]! - pivot[at % 3]!;
          return points;
        });
        const plan = planCollision(
          { name: body.name, positions: drafted.stored, indices: drafted.mesh.indices, closed: drafted.mesh.openEdges === 0 && drafted.mesh.nonManifoldEdges === 0, pieces },
          collision,
          input.kernel,
        );
        const written: CollisionNodeFacts[] = (plan.chosen?.pieces ?? []).map((piece, n) => {
          const { name: pieceName, role } = collisionName(profile, piece.kind, name, n, used);
          const positions = Float32Array.from(piece.positions);
          const bounds = boundsOf(positions);
          const small = positions.length / 3 <= 65535;
          const indexData = small ? Uint16Array.from(piece.indices) : piece.indices;
          accessors.push(
            { bufferView: binary.add(indexData, TARGET_ELEMENT_ARRAY_BUFFER), componentType: small ? COMPONENT_UNSIGNED_SHORT : COMPONENT_UNSIGNED_INT, count: indexData.length, type: "SCALAR" },
            { bufferView: binary.add(positions, TARGET_ARRAY_BUFFER), componentType: COMPONENT_FLOAT, count: positions.length / 3, type: "VEC3", min: bounds.min, max: bounds.max },
          );
          // Positions only: a collision shape is never drawn, so it has no normals and no material.
          meshes.push({ name: pieceName, primitives: [{ attributes: { POSITION: accessors.length - 1 }, indices: accessors.length - 2, mode: MODE_TRIANGLES }] });
          const min: Vec3 = [bounds.min[0] + translation[0], bounds.min[1] + translation[1], bounds.min[2] + translation[2]];
          const max: Vec3 = [bounds.max[0] + translation[0], bounds.max[1] + translation[1], bounds.max[2] + translation[2]];
          return {
            name: pieceName,
            node: child(index, { name: pieceName, mesh: meshes.length - 1 }),
            mesh: meshes.length - 1,
            kind: piece.kind,
            role,
            vertices: positions.length / 3,
            triangles: piece.indices.length / 3,
            volume: piece.volume,
            capped: piece.capped,
            bounds: measuredBox(min, max, profile),
          };
        });
        const collisionFacts: CollisionFacts = {
          requested: plan.requested,
          shape: plan.chosen?.shape ?? "none",
          pieces: written.length,
          tolerance: collision.tolerance,
          volume: { visible: plan.visibleVolume, collision: plan.chosen?.volume ?? 0, error: plan.chosen?.error ?? null },
          withinTolerance: plan.chosen?.withinTolerance ?? null,
          nodes: written,
          tried: plan.tried.map((made) => ({ shape: made.shape, pieces: made.pieces.length, volume: made.volume, error: made.error, withinTolerance: made.withinTolerance })),
          notes: plan.notes,
        };
        bodyFacts.collision = collisionFacts;
      }

      // Attach points: empty nodes under the body, so they move with it.
      if (body.attachPoints !== undefined && body.attachPoints.length > 0) {
        const points: AttachPointFacts[] = body.attachPoints.map((point) => {
          const at = new Float64Array(3);
          toGltfSpace(point.position, conversion, at);
          const local: Vec3 = [at[0]! - pivot[0] + 0, at[1]! - pivot[1] + 0, at[2]! - pivot[2] + 0];
          const scene: Vec3 = [local[0] + translation[0], local[1] + translation[1], local[2] + translation[2]];
          const pointName = uniqueName(used, clearName(point.name, "attach"));
          const node: (typeof nodes)[number] = { name: pointName };
          if (local.some((value) => value !== 0)) node.translation = local;
          let direction: Vec3 | undefined;
          if (point.direction !== undefined) {
            const turned = new Float64Array(3);
            // A direction has no unit of its own: only the axes are converted, then the length set to 1.
            toGltfSpace(point.direction, { ...conversion, unit: 1 }, turned);
            const length = Math.hypot(turned[0]!, turned[1]!, turned[2]!);
            direction = [turned[0]! / length + 0, turned[1]! / length + 0, turned[2]! / length + 0];
            const rotation = turnFromZ(direction);
            if (rotation !== undefined) node.rotation = rotation;
          }
          return {
            name: pointName,
            sourceName: point.name,
            node: child(index, node),
            meters: scene,
            engine: toEngine(scene, profile),
            source: [point.position[0] + 0, point.position[1] + 0, point.position[2] + 0],
            ...(direction !== undefined ? { direction } : {}),
          };
        });
        bodyFacts.attachPoints = points;
      }
    });
  }
  return finishScene(draft);
}
