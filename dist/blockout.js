import { badOption, notObject } from "./errors.js";
import { assertJson } from "./export.js";
import { readGlb } from "./glb-read.js";
import { encodeGlb } from "./glb-write.js";
import { EXTRAS_KEY } from "./gltf.js";
import { cellSize, kitOf, layoutOf, placePoint } from "./kit.js";
import { uniqueName } from "./names.js";
import { GENERATOR } from "./version.js";
function round(value) {
    return Math.round(value * 1e6) / 1e6 + 0;
}
function cellTag(cell) {
    return cell.map((part) => (part < 0 ? `n${-part}` : String(part))).join("_");
}
/** A point of glTF space turned by quarter turns about +Y. */
function turned(point, turn) {
    let x = point[0];
    let z = point[2];
    for (let n = turn; n > 0; n -= 1)
        [x, z] = [z, -x];
    return [x + 0, point[1], z + 0];
}
const HALF = Math.SQRT1_2;
/** Quarter turns about +Y as glTF quaternions [x, y, z, w]. */
const TURNS = [[0, 0, 0, 1], [0, HALF, 0, HALF], [0, 1, 0, 0], [0, -HALF, 0, HALF]];
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
export function exportBlockout(input, layout, options = {}) {
    if (notObject(options))
        badOption("Blockout options must be an object.");
    if (options.provenance !== undefined)
        assertJson(options.provenance, "provenance", 0);
    const kit = kitOf(input);
    const placed = layoutOf(kit, layout);
    const { grid } = kit;
    const json = { asset: { version: "2.0", generator: GENERATOR }, scene: 0, scenes: [{ name: placed.name, nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
    const nodes = json.nodes;
    const parts = [];
    let length = 0;
    const materialAt = new Map();
    const meshNames = new Set();
    const extensions = new Set();
    const stored = new Map();
    const collisionMeshes = new Set();
    const store = (name) => {
        const known = stored.get(name);
        if (known !== undefined)
            return known;
        const piece = kit.pieces.find((one) => one.name === name);
        const document = readGlb(piece.glb);
        const source = document.json;
        for (const extension of source.extensionsUsed ?? [])
            extensions.add(extension);
        const views = (source.bufferViews ?? []).map((view) => {
            const copy = { ...view, buffer: 0, byteOffset: length };
            parts.push(document.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
            length += (view.byteLength + 3) & ~3;
            json.bufferViews.push(copy);
            return json.bufferViews.length - 1;
        });
        const accessors = (source.accessors ?? []).map((accessor) => {
            json.accessors.push({ ...accessor, ...(accessor.bufferView !== undefined ? { bufferView: views[accessor.bufferView] } : {}) });
            return json.accessors.length - 1;
        });
        // A material that is the same in two pieces is one material here: the kit's pieces share their slots.
        const materials = (source.materials ?? []).map((material) => {
            const key = JSON.stringify(material);
            let at = materialAt.get(key);
            if (at === undefined) {
                json.materials.push(material);
                at = json.materials.length - 1;
                materialAt.set(key, at);
            }
            return at;
        });
        const triangles = [];
        const meshes = (source.meshes ?? []).map((mesh) => {
            let count = 0;
            const primitives = mesh.primitives.map((primitive) => {
                const position = primitive.attributes["POSITION"];
                count += (primitive.indices !== undefined ? source.accessors[primitive.indices].count : position !== undefined ? source.accessors[position].count : 0) / 3;
                return {
                    ...primitive,
                    attributes: Object.fromEntries(Object.entries(primitive.attributes).map(([key, accessor]) => [key, accessors[accessor]])),
                    ...(primitive.indices !== undefined ? { indices: accessors[primitive.indices] } : {}),
                    ...(primitive.material !== undefined ? { material: materials[primitive.material] } : {}),
                };
            });
            triangles.push(count);
            json.meshes.push({ ...mesh, ...(mesh.name !== undefined ? { name: uniqueName(meshNames, mesh.name) } : {}), primitives });
            return json.meshes.length - 1;
        });
        const collision = new Set();
        const bodyOf = (source.nodes ?? []).map(() => "");
        const under = (node, body) => {
            bodyOf[node] = body;
            for (const child of source.nodes?.[node]?.children ?? [])
                under(child, body);
        };
        for (const body of piece.facts.bodies) {
            under(body.node, body.name);
            for (const node of body.collision?.nodes ?? []) {
                collision.add(node.mesh);
                collisionMeshes.add(meshes[node.mesh]);
            }
        }
        const extras = source.scenes?.[source.scene ?? 0]?.extras?.[EXTRAS_KEY];
        const made = { json: source, profile: extras?.profile ?? null, meshes, collision, roots: [...(source.scenes?.[source.scene ?? 0]?.nodes ?? [])], bodyOf, triangles };
        stored.set(name, made);
        return made;
    };
    // Pieces go into the file in the kit's order, so the order of the placements does not move the bytes about.
    for (const piece of kit.pieces) {
        if (placed.placements.some((placement) => placement.piece === piece.name))
            store(piece.name);
    }
    const used = new Set();
    const lods = [];
    const placements = [];
    const counts = { visible: 0, collision: 0, drawn: 0 };
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const placement of placed.placements) {
        const piece = kit.pieces.find((one) => one.name === placement.piece);
        const from = store(piece.name);
        const tag = cellTag(placement.cell);
        // The piece's own origin, in its place: in the kit's frame, then in the file's.
        const at = [0, 0, 0];
        placePoint(piece.pivotMeters, placement, grid, at);
        const translation = [round(at[0]), round(at[2]), round(-at[1])];
        const rotation = TURNS[placement.turn];
        // Every node of the piece again, under names of this place. A name the engine reads a
        // collision shape or a detail level from keeps what the engine reads, around the new body name.
        const renamed = new Map();
        const nameOf = (node) => {
            const name = from.json.nodes[node].name ?? `node_${node}`;
            const body = from.bodyOf[node];
            if (body === "" || name === body)
                return uniqueName(used, `${name}_${tag}`);
            let bodyName = renamed.get(body);
            if (bodyName === undefined)
                renamed.set(body, (bodyName = uniqueName(used, `${body}_${tag}`)));
            const rules = [...(from.profile?.conventions.collision ?? []), ...(from.profile?.conventions.lod ?? [])];
            for (const prefix of ["", ...rules.map((rule) => rule.pattern.slice(0, Math.max(0, rule.pattern.indexOf("{name}"))))]) {
                if (name.startsWith(prefix + body))
                    return uniqueName(used, bodyName, (candidate) => `${prefix}${candidate}${name.slice(prefix.length + body.length)}`);
            }
            return uniqueName(used, `${name}_${tag}`);
        };
        const copied = new Map();
        const copy = (node) => {
            const source = from.json.nodes[node];
            const body = from.bodyOf[node];
            let name;
            if (source.name !== undefined && source.name === body) {
                name = renamed.get(body) ?? uniqueName(used, `${body}_${tag}`);
                renamed.set(body, name);
            }
            else {
                name = nameOf(node);
            }
            const made = { ...source, name };
            delete made.children;
            if (source.mesh !== undefined) {
                made.mesh = from.meshes[source.mesh];
                if (from.collision.has(source.mesh)) {
                    counts.collision += 1;
                }
                else {
                    counts.visible += 1;
                    counts.drawn += from.triangles[source.mesh];
                }
            }
            nodes.push(made);
            const index = nodes.length - 1;
            copied.set(node, index);
            const children = (source.children ?? []).map(copy);
            if (children.length > 0)
                made.children = children;
            return index;
        };
        const only = from.roots.length === 1 ? from.json.nodes[from.roots[0]] : undefined;
        let holder;
        if (only !== undefined && only.rotation === undefined && only.scale === undefined && only.matrix === undefined) {
            // One body: its node is the node of the place.
            holder = copy(from.roots[0]);
            const own = turned(only.translation ?? [0, 0, 0], placement.turn);
            nodes[holder].translation = [round(translation[0] + own[0]), round(translation[1] + own[1]), round(translation[2] + own[2])];
        }
        else {
            nodes.push({ name: uniqueName(used, `${piece.asset}_${tag}`) });
            holder = nodes.length - 1;
            nodes[holder].children = from.roots.map(copy);
            nodes[holder].translation = translation;
        }
        if (placement.turn !== 0)
            nodes[holder].rotation = [...rotation];
        json.scenes[0].nodes.push(holder);
        placements.push({ piece: piece.name, asset: piece.asset, cell: placement.cell, turn: placement.turn, name: nodes[holder].name, node: holder, translation, degrees: (placement.turn * 90) });
        for (const body of piece.facts.bodies) {
            if (body.lods === undefined || body.lods.length < 2)
                continue;
            lods.push({
                placement: placements.length - 1,
                body: nodes[copied.get(body.node)].name,
                levels: body.lods.map((level) => ({ level: level.level, name: nodes[copied.get(level.node)].name, node: copied.get(level.node), visible: level.visible, deviationMeters: level.deviation.meters })),
            });
        }
        const box = piece.facts.total.bounds.meters;
        for (const corner of [box.min, box.max]) {
            const point = turned(corner, placement.turn);
            for (const axis of [0, 1, 2]) {
                min[axis] = Math.min(min[axis], point[axis] + translation[axis]);
                max[axis] = Math.max(max[axis], point[axis] + translation[axis]);
            }
        }
    }
    const size = cellSize(grid);
    const visibleMeshes = json.meshes.length - collisionMeshes.size;
    let storedTriangles = 0;
    for (const from of stored.values())
        for (const [mesh, count] of from.triangles.entries())
            if (!from.collision.has(mesh))
                storedTriangles += count;
    const facts = {
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
        meshes: { total: json.meshes.length, visible: visibleMeshes, collision: collisionMeshes.size },
        nodes: { total: nodes.length, placements: placements.length, visible: counts.visible, collision: counts.collision },
        materials: json.materials.length,
        triangles: { stored: storedTriangles, drawn: counts.drawn },
        bounds: { min: [round(min[0]), round(min[1]), round(min[2])], max: [round(max[0]), round(max[1]), round(max[2])], size: [round(max[0] - min[0]), round(max[1] - min[1]), round(max[2] - min[2])] },
        ...(lods.length > 0 ? { lods } : {}),
    };
    const extras = { schema: 1, blockout: facts, ...(options.provenance !== undefined ? { provenance: options.provenance } : {}) };
    json.scenes[0].extras = { [EXTRAS_KEY]: extras };
    if (extensions.size > 0)
        json.extensionsUsed = [...extensions].sort();
    if (json.materials.length === 0)
        delete json.materials;
    const bin = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        bin.set(part, offset);
        offset += (part.length + 3) & ~3;
    }
    json.buffers = [{ byteLength: bin.length }];
    return { glb: encodeGlb(json, bin), facts };
}
