import { exportGameAsset } from "./asset.js";
import { checkGameAsset } from "./checks.js";
import { refuse } from "./errors.js";
import { assertJson } from "./export.js";
import { assetName, DEFAULT_NAME_PATTERNS } from "./naming.js";
import { resolveProfile } from "./profiles.js";
import { sha256Hex } from "./sha256.js";
import { GENERATOR } from "./version.js";
import { writeZip } from "./zip.js";
/**
 * JSON for people as well as programs: two spaces a level, and a list of plain values, like a
 * point or a list of names, on one line.
 */
export function manifestJson(value, indent = "") {
    if (Array.isArray(value)) {
        if (value.every((item) => typeof item !== "object" || item === null))
            return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
        return `[\n${value.map((item) => `${indent}  ${manifestJson(item, `${indent}  `)}`).join(",\n")}\n${indent}]`;
    }
    if (typeof value === "object" && value !== null) {
        const entries = Object.entries(value).filter(([, item]) => item !== undefined);
        if (entries.length === 0)
            return "{}";
        return `{\n${entries.map(([key, item]) => `${indent}  ${JSON.stringify(key)}: ${manifestJson(item, `${indent}  `)}`).join(",\n")}\n${indent}}`;
    }
    return JSON.stringify(value);
}
export const MANIFEST_MEDIA_TYPE = "application/json";
export const GLB_MEDIA_TYPE = "model/gltf-binary";
const PACK_ONLY_KEYS = ["name", "bodies", "rows", "naming", "checks", "generatedAt", "revision", "provenance"];
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
export function exportGamePack(input) {
    if (typeof input !== "object" || input === null)
        refuse("BAD_PACK", "exportGamePack needs { name, source, bodies } or { name, source, rows }.");
    const hasBodies = input.bodies !== undefined;
    const hasRows = input.rows !== undefined;
    if (hasBodies === hasRows)
        refuse("BAD_PACK", "A pack is one asset or a family: give bodies or rows, and not both.");
    if (hasRows && (!Array.isArray(input.rows) || input.rows.length === 0))
        refuse("BAD_PACK", "rows must be a list with at least one row.");
    for (const key of ["generatedAt", "revision"]) {
        if (input[key] !== undefined && (typeof input[key] !== "string" || input[key] === ""))
            refuse("BAD_PACK", `${key} must be text.`);
    }
    if (input.checks !== undefined && input.checks !== false && (typeof input.checks !== "object" || input.checks === null)) {
        refuse("BAD_PACK", "checks must be false or the options of checkGameAsset.");
    }
    if (input.provenance !== undefined)
        assertJson(input.provenance, "provenance", 0);
    const profile = resolveProfile(input.profile);
    const pattern = input.naming ?? (Object.hasOwn(DEFAULT_NAME_PATTERNS, profile.id) ? DEFAULT_NAME_PATTERNS[profile.id] : DEFAULT_NAME_PATTERNS.godot4);
    const packName = assetName(pattern, input.name);
    const options = {};
    for (const [key, value] of Object.entries(input)) {
        if (!PACK_ONLY_KEYS.includes(key))
            options[key] = value;
    }
    const rows = hasRows
        ? input.rows.map((row, at) => {
            if (typeof row !== "object" || row === null)
                refuse("BAD_PACK", `Row ${at} must be { name, bodies }.`);
            if (typeof row.name !== "string")
                refuse("BAD_PACK", `Row ${at} needs a name.`);
            if (row.provenance !== undefined)
                assertJson(row.provenance, `rows[${at}].provenance`, 0);
            return { row: row.name, asset: assetName(pattern, input.name, row.name), bodies: row.bodies, ...(row.provenance !== undefined ? { provenance: row.provenance } : {}) };
        })
        : [{ asset: packName, bodies: input.bodies }];
    const taken = new Map();
    for (const { row, asset } of rows) {
        const key = asset.toLowerCase();
        if (taken.has(key))
            refuse("BAD_PACK", `Rows "${String(taken.get(key))}" and "${String(row)}" both come out named "${asset}". Rows need names that differ in their letters and digits.`);
        taken.set(key, row);
    }
    const files = [];
    const listed = [];
    const materials = new Map();
    let facts;
    let report;
    let status = "pass";
    for (const { row, asset, bodies, provenance } of rows) {
        const where = row === undefined ? "The asset" : `Row "${row}"`;
        if (!Array.isArray(bodies) || bodies.length === 0)
            refuse("NO_BODIES", `${where} needs at least one body.`);
        // One body is the asset: it takes the asset's name. Several keep their own.
        const named = bodies.length === 1 && typeof bodies[0] === "object" && bodies[0] !== null ? [{ ...bodies[0], name: asset }] : bodies;
        const stored = provenance ?? input.provenance;
        const result = exportGameAsset({ ...options, source: input.source, bodies: named, ...(stored !== undefined ? { provenance: stored } : {}) });
        facts = result.facts;
        const fileName = `${asset}.glb`;
        for (const material of result.facts.materials) {
            const known = materials.get(material.name);
            if (known === undefined) {
                materials.set(material.name, { name: material.name, color: material.color, baseColorFactor: material.baseColorFactor, files: [fileName] });
            }
            else if (known.color !== material.color) {
                refuse("MATERIAL_CONFLICT", `Material "${material.name}" is ${known.color} in ${known.files[0]} and ${material.color} in ${fileName}. In a family a material name means one colour.`);
            }
            else {
                known.files.push(fileName);
            }
        }
        const entry = { name: fileName, role: "model", mediaType: GLB_MEDIA_TYPE, bytes: result.glb.length, sha256: sha256Hex(result.glb), asset, ...(row !== undefined ? { row } : {}), facts: result.facts };
        if (input.checks !== false) {
            report = checkGameAsset(result.glb, input.checks ?? {});
            entry.checks = report;
            if (report.status === "fail" || (report.status === "warn" && status === "pass"))
                status = report.status;
        }
        if (provenance !== undefined)
            entry.provenance = provenance;
        listed.push(entry);
        files.push({ name: fileName, mediaType: GLB_MEDIA_TYPE, bytes: result.glb });
    }
    const manifest = {
        schema: 1,
        kind: hasRows ? "family" : "asset",
        name: packName,
        generator: GENERATOR,
        ...(input.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
        ...(input.revision !== undefined ? { revision: input.revision } : {}),
        profile: facts.profile,
        engine: facts.engine,
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
export function packToZip(pack) {
    if (typeof pack !== "object" || pack === null || !Array.isArray(pack.files))
        refuse("BAD_PACK", "packToZip needs what exportGamePack returned.");
    return writeZip(pack.files.map((file) => ({ name: file.name, bytes: file.bytes })));
}
