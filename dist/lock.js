import { refuse } from "./errors.js";
import { sha256Hex } from "./sha256.js";
/** The lock file's name. It sits at the root of the game project. */
export const LOCK_FILE_NAME = "corbelo-game-export.lock.json";
/** The folder of the project a pack's own folder goes into, unless another is named. */
export const DEFAULT_INSTALL_FOLDER = "assets";
const KINDS = ["asset", "family", "kit"];
const ROLES = ["model", "blockout", "manifest"];
const SHA256 = /^[0-9a-f]{64}$/;
const MANIFEST_SUFFIX = ".pack.json";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Whether a path stays in the folder it is taken from: parts with `/` between, none of them empty, `.` or `..`. */
function isSafePath(path) {
    if (typeof path !== "string" || path === "" || path.includes("\\") || path.includes(":") || /[\u0000-\u001f]/.test(path))
        return false;
    return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
/**
 * Checks a pack against its own manifest. `files` are the files of the pack, from a folder or
 * from an archive read with `readZip`; they may all sit in one folder of their own.
 *
 * Refused as `BAD_PACK`: no manifest or more than one, and a manifest that is not one. Refused
 * as `PACK_MISMATCH`: a file the manifest lists that is missing, has another size, or has
 * another SHA-256. Files the manifest does not list are named in `ignored` and left out.
 */
export function verifyPack(files) {
    if (!Array.isArray(files))
        refuse("BAD_PACK", "verifyPack needs the pack's files as a list of { name, bytes }.");
    for (const [at, file] of files.entries()) {
        if (!isRecord(file) || typeof file["name"] !== "string" || !(file["bytes"] instanceof Uint8Array))
            refuse("BAD_PACK", `File ${at} of the pack must be { name, bytes } with bytes as a Uint8Array.`);
    }
    const manifests = files.filter((file) => file.name.endsWith(MANIFEST_SUFFIX));
    if (manifests.length === 0)
        refuse("BAD_PACK", `This is not a pack: it holds no manifest, a file named <name>${MANIFEST_SUFFIX}.`);
    if (manifests.length > 1)
        refuse("BAD_PACK", `This holds ${manifests.length} manifests (${manifests.map((file) => file.name).join(", ")}). Give one pack at a time.`);
    const manifestFile = manifests[0];
    const folder = manifestFile.name.slice(0, manifestFile.name.lastIndexOf("/") + 1);
    const manifestName = manifestFile.name.slice(folder.length);
    let manifest;
    try {
        manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestFile.bytes));
    }
    catch (error) {
        return refuse("BAD_PACK", `The manifest ${manifestName} is not valid JSON: ${error.message}`);
    }
    if (!isRecord(manifest) || manifest["schema"] !== 1)
        refuse("BAD_PACK", `The manifest ${manifestName} is not a pack manifest of this package: "schema" must be 1.`);
    const name = manifest["name"];
    if (!isSafePath(name) || name.includes("/") || name.startsWith("."))
        refuse("BAD_PACK", `The manifest's "name" must be a name that is safe as a folder. Got ${JSON.stringify(name)}.`);
    if (manifestName !== `${name}${MANIFEST_SUFFIX}`)
        refuse("BAD_PACK", `The manifest of the pack "${name}" must be named ${name}${MANIFEST_SUFFIX}. Got ${manifestName}.`);
    if (!KINDS.includes(manifest["kind"]))
        refuse("BAD_PACK", `The manifest's "kind" must be one of ${KINDS.join(", ")}. Got ${JSON.stringify(manifest["kind"])}.`);
    for (const key of ["generator", "profile"]) {
        if (typeof manifest[key] !== "string" || manifest[key] === "")
            refuse("BAD_PACK", `The manifest needs "${key}" as text.`);
    }
    for (const key of ["generatedAt", "revision"]) {
        if (manifest[key] !== undefined && (typeof manifest[key] !== "string" || manifest[key] === ""))
            refuse("BAD_PACK", `The manifest's "${key}" must be text.`);
    }
    if (!Array.isArray(manifest["files"]) || manifest["files"].length === 0)
        refuse("BAD_PACK", "The manifest needs \"files\" with at least one file.");
    if (manifest["scenes"] !== undefined && !Array.isArray(manifest["scenes"]))
        refuse("BAD_PACK", "The manifest's \"scenes\" must be a list.");
    const given = new Map(files.map((file) => [file.name, file.bytes]));
    const listed = [];
    const seen = new Set([manifestName.toLowerCase()]);
    const wrong = [];
    for (const entry of [...manifest["files"], ...(manifest["scenes"] ?? [])]) {
        if (!isRecord(entry) || !isSafePath(entry["name"]))
            return refuse("BAD_PACK", `The manifest lists a file whose name is not a path that stays in the pack's folder: ${JSON.stringify(isRecord(entry) ? entry["name"] : entry)}.`);
        const path = entry["name"];
        if (entry["role"] !== "model" && entry["role"] !== "blockout")
            refuse("BAD_PACK", `The manifest lists ${path} with a role that is not known here: ${JSON.stringify(entry["role"])}.`);
        if (typeof entry["sha256"] !== "string" || !SHA256.test(entry["sha256"]) || typeof entry["bytes"] !== "number")
            refuse("BAD_PACK", `The manifest lists ${path} without its size and SHA-256.`);
        if (seen.has(path.toLowerCase()))
            refuse("BAD_PACK", `The manifest lists two files named ${path}.`);
        seen.add(path.toLowerCase());
        const bytes = given.get(folder + path);
        if (bytes === undefined) {
            wrong.push(`${path} is missing`);
            continue;
        }
        if (bytes.length !== entry["bytes"]) {
            wrong.push(`${path} is ${bytes.length} bytes and the manifest says ${entry["bytes"]}`);
            continue;
        }
        const sha256 = sha256Hex(bytes);
        if (sha256 !== entry["sha256"]) {
            wrong.push(`${path} has SHA-256 ${sha256} and the manifest says ${entry["sha256"]}`);
            continue;
        }
        listed.push({
            path,
            role: entry["role"],
            bytes,
            sha256,
            ...(typeof entry["asset"] === "string" ? { asset: entry["asset"] } : {}),
            ...(typeof entry["row"] === "string" ? { row: entry["row"] } : {}),
            ...(typeof entry["layout"] === "string" ? { layout: entry["layout"] } : {}),
            ...(entry["provenance"] !== undefined ? { provenance: entry["provenance"] } : {}),
        });
    }
    if (wrong.length > 0) {
        refuse("PACK_MISMATCH", `The pack "${name}" is not the one its manifest describes: ${wrong.slice(0, 5).join("; ")}${wrong.length > 5 ? `; and ${wrong.length - 5} more` : ""}.`);
    }
    const digest = sha256Hex(manifestFile.bytes);
    listed.push({ path: manifestName, role: "manifest", bytes: manifestFile.bytes, sha256: digest });
    const ignored = files.filter((file) => !file.name.startsWith(folder) || !seen.has(file.name.slice(folder.length).toLowerCase())).map((file) => file.name);
    return { name, manifest: manifest, manifestName, digest, files: listed, ignored: ignored.sort(byText) };
}
/** The keys of the lock file, in the order they are written. */
const LOCK_KEYS = ["schema", "packs"];
const PACK_KEYS = ["name", "kind", "into", "manifest", "generator", "profile", "generatedAt", "revision", "digest", "inTheBuild", "provenance", "files"];
const FILE_KEYS = ["path", "role", "bytes", "sha256", "asset", "row", "layout", "provenance"];
const REVISION_KEYS = ["revision", "digest"];
/** One level of the lock file on one line, with spaces a person reads easily. */
function inline(value) {
    if (Array.isArray(value))
        return `[${value.map(inline).join(", ")}]`;
    if (isRecord(value)) {
        const entries = Object.entries(value).filter(([, item]) => item !== undefined);
        return entries.length === 0 ? "{}" : `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${inline(item)}`).join(", ")} }`;
    }
    return JSON.stringify(value);
}
/**
 * The lock file as text. A pack's own facts are one to a line, and each of its files is one
 * line, so a new revision of a pack changes one line for each file that changed and a few
 * lines above them. The same lock always gives the same text.
 */
export function lockJson(lock) {
    const lines = ["{", `  "schema": ${lock.schema},`];
    if (lock.packs.length === 0) {
        lines.push("  \"packs\": []");
    }
    else {
        lines.push("  \"packs\": [");
        lock.packs.forEach((pack, at) => {
            const facts = pack;
            lines.push("    {");
            for (const key of PACK_KEYS) {
                if (key !== "files" && facts[key] !== undefined)
                    lines.push(`      ${JSON.stringify(key)}: ${inline(facts[key])},`);
            }
            lines.push("      \"files\": [");
            const files = pack.files.map((file) => Object.fromEntries(FILE_KEYS.map((key) => [key, file[key]])));
            files.forEach((file, index) => lines.push(`        ${inline(file)}${index + 1 < files.length ? "," : ""}`));
            lines.push("      ]");
            lines.push(`    }${at + 1 < lock.packs.length ? "," : ""}`);
        });
        lines.push("  ]");
    }
    lines.push("}");
    return `${lines.join("\n")}\n`;
}
function knownKeys(value, allowed, where) {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key))
            refuse("BAD_LOCK", `${where} has an unknown key "${key}". Known keys: ${allowed.join(", ")}.`);
    }
}
function textOf(value, key, where, optional = false) {
    if (optional && value[key] === undefined)
        return;
    if (typeof value[key] !== "string" || value[key] === "")
        refuse("BAD_LOCK", `${where} needs "${key}" as text.`);
}
/**
 * Reads a lock file. Refused as `BAD_LOCK`: what is not JSON, a layout other than this one, a
 * key that is not known, and a path that would leave the project.
 */
export function parseLock(text) {
    let lock;
    try {
        lock = JSON.parse(text);
    }
    catch (error) {
        return refuse("BAD_LOCK", `The lock file is not valid JSON: ${error.message}`);
    }
    if (!isRecord(lock))
        return refuse("BAD_LOCK", "The lock file must hold a JSON object.");
    if (lock["schema"] !== 1)
        refuse("BAD_LOCK", `The lock file's "schema" must be 1. Got ${JSON.stringify(lock["schema"])}: it was written by a newer version, or by something else.`);
    knownKeys(lock, LOCK_KEYS, "The lock file");
    if (!Array.isArray(lock["packs"]))
        return refuse("BAD_LOCK", "The lock file needs \"packs\" as a list.");
    const names = new Set();
    for (const [at, pack] of lock["packs"].entries()) {
        if (!isRecord(pack))
            return refuse("BAD_LOCK", `Pack ${at} of the lock file must be an object.`);
        textOf(pack, "name", `Pack ${at} of the lock file`);
        const where = `Pack "${pack["name"]}" of the lock file`;
        knownKeys(pack, PACK_KEYS, where);
        if (names.has(pack["name"]))
            refuse("BAD_LOCK", `The lock file lists the pack "${pack["name"]}" twice.`);
        names.add(pack["name"]);
        if (!KINDS.includes(pack["kind"]))
            refuse("BAD_LOCK", `${where}: "kind" must be one of ${KINDS.join(", ")}.`);
        if (!isSafePath(pack["into"]))
            refuse("BAD_LOCK", `${where}: "into" must be a folder inside the project, with "/" between folders. Got ${JSON.stringify(pack["into"])}.`);
        for (const key of ["manifest", "generator", "profile"])
            textOf(pack, key, where);
        for (const key of ["generatedAt", "revision"])
            textOf(pack, key, where, true);
        if (typeof pack["digest"] !== "string" || !SHA256.test(pack["digest"]))
            refuse("BAD_LOCK", `${where}: "digest" must be a SHA-256 as 64 small hexadecimal digits.`);
        const pinned = pack["inTheBuild"];
        if (!isRecord(pinned) || typeof pinned["digest"] !== "string" || !SHA256.test(pinned["digest"]))
            return refuse("BAD_LOCK", `${where}: "inTheBuild" must be { "revision", "digest" } with the digest as a SHA-256.`);
        knownKeys(pinned, REVISION_KEYS, `${where}: "inTheBuild"`);
        textOf(pinned, "revision", `${where}: "inTheBuild"`, true);
        if (!Array.isArray(pack["files"]))
            return refuse("BAD_LOCK", `${where} needs "files" as a list.`);
        const paths = new Set();
        for (const [index, file] of pack["files"].entries()) {
            if (!isRecord(file) || !isSafePath(file["path"]))
                return refuse("BAD_LOCK", `${where}: file ${index} needs "path" as a path inside the pack's folder, with "/" between folders.`);
            const fileWhere = `${where}: ${file["path"]}`;
            knownKeys(file, FILE_KEYS, fileWhere);
            if (paths.has(file["path"].toLowerCase()))
                refuse("BAD_LOCK", `${where} lists ${file["path"]} twice.`);
            paths.add(file["path"].toLowerCase());
            if (!ROLES.includes(file["role"]))
                refuse("BAD_LOCK", `${fileWhere}: "role" must be one of ${ROLES.join(", ")}.`);
            if (typeof file["bytes"] !== "number" || !Number.isInteger(file["bytes"]) || file["bytes"] < 0)
                refuse("BAD_LOCK", `${fileWhere}: "bytes" must be a whole number.`);
            if (typeof file["sha256"] !== "string" || !SHA256.test(file["sha256"]))
                refuse("BAD_LOCK", `${fileWhere}: "sha256" must be 64 small hexadecimal digits.`);
            for (const key of ["asset", "row", "layout"])
                textOf(file, key, fileWhere, true);
        }
    }
    return lock;
}
/** Reads `into` as a folder of the project. */
function folderOf(into) {
    if (typeof into !== "string")
        refuse("BAD_OPTION", "into must be a folder of the project, as text.");
    const path = into.split("\\").join("/").replace(/\/+$/, "");
    if (path === "" || path === ".")
        return "";
    if (path.startsWith("/") || /^[A-Za-z]:/.test(path))
        refuse("OUTSIDE_PROJECT", `into must be a folder inside the project, from its root. Got ${JSON.stringify(into)}.`);
    if (!isSafePath(path))
        refuse("OUTSIDE_PROJECT", `into must stay inside the project: no "..", "." or empty part. Got ${JSON.stringify(into)}.`);
    return path;
}
/**
 * Plans the install of a pack into a project, and writes nothing: the files to write, the
 * files to take away, what changes, and the lock file after. `present` says what is in the
 * project now: the SHA-256 of the file at a path from the project's root, or `undefined`
 * when nothing is there.
 *
 * The pack goes into its own folder, `<into>/<pack name>`. Installing a pack again replaces
 * its files in place and takes away the files only the revision before had. A file that is in
 * the way, one that nothing installed or one changed in the project since it was installed, is
 * refused as `FILE_IN_THE_WAY` unless `force` is set.
 */
export function planInstall(pack, lock, present, options = {}) {
    const before = lock?.packs.find((one) => one.name === pack.name);
    const parent = options.into !== undefined ? folderOf(options.into) : before !== undefined ? before.into.slice(0, Math.max(0, before.into.length - pack.name.length - 1)) : DEFAULT_INSTALL_FOLDER;
    const into = parent === "" ? pack.name : `${parent}/${pack.name}`;
    for (const other of lock?.packs ?? []) {
        if (other.name !== pack.name && other.into.toLowerCase() === into.toLowerCase())
            refuse("FILE_IN_THE_WAY", `The pack "${other.name}" is already installed in ${into}.`);
    }
    const owned = new Map((before?.files ?? []).map((file) => [`${before.into}/${file.path}`, file.sha256]));
    const changes = [];
    const write = [];
    const remove = [];
    const inTheWay = [];
    const next = new Set();
    for (const file of pack.files) {
        const path = `${into}/${file.path}`;
        next.add(path);
        const there = present(path);
        if (there === file.sha256) {
            changes.push({ path, change: "unchanged", from: there, to: there });
            continue;
        }
        if (there === undefined) {
            changes.push({ path, change: "added", to: file.sha256 });
        }
        else if (owned.get(path) === there) {
            changes.push({ path, change: "changed", from: there, to: file.sha256 });
        }
        else if (options.force === true) {
            changes.push({ path, change: "changed", from: there, to: file.sha256, forced: true });
        }
        else {
            inTheWay.push(owned.has(path) ? `${path} was changed in the project since it was installed` : `${path} is already in the project and no installed pack put it there`);
            continue;
        }
        write.push({ path, bytes: file.bytes });
    }
    if (inTheWay.length > 0) {
        refuse("FILE_IN_THE_WAY", `Nothing was installed: ${inTheWay.slice(0, 5).join("; ")}${inTheWay.length > 5 ? `; and ${inTheWay.length - 5} more` : ""}. Move what is in the way, or install with force to replace it.`);
    }
    for (const [path, sha256] of owned) {
        if (next.has(path))
            continue;
        const there = present(path);
        if (there === undefined) {
            changes.push({ path, change: "removed" });
        }
        else if (there === sha256 || options.force === true) {
            changes.push({ path, change: "removed", from: there, ...(there !== sha256 ? { forced: true } : {}) });
            remove.push(path);
        }
        else {
            changes.push({ path, change: "kept", from: there, to: there });
        }
    }
    changes.sort((a, b) => byText(a.path, b.path));
    const { manifest } = pack;
    const to = { ...(manifest.revision !== undefined ? { revision: manifest.revision } : {}), digest: pack.digest };
    const from = before === undefined ? undefined : { ...(before.revision !== undefined ? { revision: before.revision } : {}), digest: before.digest };
    const inTheBuild = before !== undefined && options.pin !== true ? before.inTheBuild : to;
    const locked = {
        name: pack.name,
        kind: manifest.kind,
        into,
        manifest: pack.manifestName,
        generator: manifest.generator,
        profile: manifest.profile,
        ...(manifest.generatedAt !== undefined ? { generatedAt: manifest.generatedAt } : {}),
        ...(manifest.revision !== undefined ? { revision: manifest.revision } : {}),
        digest: pack.digest,
        inTheBuild,
        ...(manifest.provenance !== undefined ? { provenance: manifest.provenance } : {}),
        files: pack.files.map(({ bytes, ...file }) => ({ path: file.path, role: file.role, bytes: bytes.length, sha256: file.sha256, ...(file.asset !== undefined ? { asset: file.asset } : {}), ...(file.row !== undefined ? { row: file.row } : {}), ...(file.layout !== undefined ? { layout: file.layout } : {}), ...(file.provenance !== undefined ? { provenance: file.provenance } : {}) })).sort((a, b) => byText(a.path, b.path)),
    };
    const counts = { added: 0, changed: 0, unchanged: 0, removed: 0, kept: 0 };
    for (const change of changes)
        counts[change.change] += 1;
    return {
        pack: pack.name,
        kind: manifest.kind,
        into,
        ...(from !== undefined ? { from } : {}),
        to,
        inTheBuild,
        pinned: inTheBuild.digest === pack.digest,
        changes,
        counts,
        write,
        remove,
        lock: { schema: 1, packs: [...(lock?.packs ?? []).filter((one) => one.name !== pack.name), locked].sort((a, b) => byText(a.name, b.name)) },
    };
}
/**
 * Compares a project with its lock file. `present` says what is in the project now: the
 * SHA-256 of the file at a path from the project's root, or `undefined` when nothing is there.
 */
export function lockStatus(lock, present) {
    const packs = lock.packs.map((pack) => {
        const changed = [];
        const missing = [];
        for (const file of pack.files) {
            const path = `${pack.into}/${file.path}`;
            const there = present(path);
            if (there === undefined)
                missing.push(path);
            else if (there !== file.sha256)
                changed.push(path);
        }
        return {
            name: pack.name,
            kind: pack.kind,
            into: pack.into,
            installed: { ...(pack.revision !== undefined ? { revision: pack.revision } : {}), digest: pack.digest },
            inTheBuild: pack.inTheBuild,
            pinned: pack.inTheBuild.digest === pack.digest,
            matches: changed.length === 0 && missing.length === 0,
            counts: { same: pack.files.length - changed.length - missing.length, changed: changed.length, missing: missing.length },
            changed,
            missing,
        };
    });
    return { ok: packs.every((pack) => pack.matches && pack.pinned), packs };
}
/**
 * Moves "in the build" to the revision that is installed, for one pack by name or for every
 * pack. Returns the new lock file; the one given is left as it is.
 */
export function pinLock(lock, name) {
    if (name !== undefined && !lock.packs.some((pack) => pack.name === name)) {
        refuse("BAD_LOCK", `The lock file has no pack named "${name}". It has: ${lock.packs.map((pack) => pack.name).join(", ") || "none"}.`);
    }
    return {
        schema: 1,
        packs: lock.packs.map((pack) => (name === undefined || pack.name === name ? { ...pack, inTheBuild: { ...(pack.revision !== undefined ? { revision: pack.revision } : {}), digest: pack.digest } } : pack)),
    };
}
