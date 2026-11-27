import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";
import { refuse } from "./errors.js";
import { LOCK_FILE_NAME, lockJson, lockStatus, parseLock, pinLock, planInstall, verifyPack, type InstallOptions, type InstallPlan, type LockFile, type LockStatus, type VerifiedPack } from "./lock.js";
import { readZip } from "./unzip.js";
import type { ZipEntry } from "./zip.js";

/** What an install did, or with `dryRun` what it would do. Paths in `changes` are from the root of the project. */
export interface InstallResult extends Omit<InstallPlan, "write" | "remove" | "lock"> {
  /** The project's folder, as an absolute path with links resolved. */
  project: string;
  /** Absolute path of the lock file. */
  lockFile: string;
  /** Files of the pack given that its manifest does not list, and that were left out. */
  ignored: string[];
  /** Only when nothing was written. */
  dryRun?: true;
}

export interface ProjectStatus extends LockStatus {
  project: string;
  lockFile: string;
}

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

/** `lstat`, or `undefined` when nothing is there. */
function statOf(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") return undefined;
    throw error;
  }
}

/** The project's folder with links resolved, so that everything else can be held against it. */
function projectRoot(project: string): string {
  if (typeof project !== "string" || project === "") refuse("BAD_OPTION", "The project must be the path of a game project's folder.");
  const path = resolve(project);
  let stat: Stats;
  try {
    stat = statSync(path);
  } catch (error) {
    return refuse("BAD_OPTION", `The project folder ${path} cannot be read: ${codeOf(error) ?? (error as Error).message}.`);
  }
  if (!stat.isDirectory()) refuse("BAD_OPTION", `The project ${path} is not a folder.`);
  return realpathSync(path);
}

/**
 * Where a path of the project is on disk. Refuses a path that is not inside the project, as
 * written or through a link: the folder it is in, as far as it exists, must really be in the
 * project.
 */
function placeOf(root: string, path: string): string {
  const place = resolve(root, ...path.split("/"));
  const outside = (found: string): never => refuse("OUTSIDE_PROJECT", `${path} is not inside the project: ${found}. Nothing is read or written outside ${root}.`);
  const away = relative(root, place);
  if (away === "" || away === ".." || away.startsWith(`..${sep}`) || isAbsolute(away)) outside("the path leaves the project's folder");
  let folder = dirname(place);
  for (;;) {
    let real: string;
    try {
      real = realpathSync(folder);
    } catch (error) {
      if (codeOf(error) !== "ENOENT" && codeOf(error) !== "ENOTDIR") throw error;
      // Nothing here yet, unless it is a link to nothing.
      if (statOf(folder) !== undefined) outside(`${relative(root, folder)} is a link to nothing`);
      folder = dirname(folder);
      continue;
    }
    if (real !== root && !real.startsWith(root + sep)) outside(`${relative(root, folder) || "its folder"} is a link to ${real}`);
    if (!statSync(real).isDirectory()) refuse("FILE_IN_THE_WAY", `${relative(root, folder).split(sep).join("/")} is a file where the pack needs a folder.`);
    return place;
  }
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Writes a file whole or not at all: next to its place first, then moved onto it. */
function writeWhole(place: string, bytes: Uint8Array | string): void {
  mkdirSync(dirname(place), { recursive: true });
  const temporary = `${place}.${process.pid}.part`;
  try {
    writeFileSync(temporary, bytes, { flag: "wx" });
    renameSync(temporary, place);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/**
 * Reads the files of a pack from a ZIP archive or from a folder. From a folder, only the
 * manifest and the files it lists are read.
 */
export function readPackFiles(path: string): ZipEntry[] {
  const from = resolve(path);
  let stat: Stats;
  try {
    stat = statSync(from);
  } catch (error) {
    return refuse("BAD_PACK", `Cannot read the pack ${from}: ${codeOf(error) ?? (error as Error).message}.`);
  }
  if (!stat.isDirectory()) {
    return readZip(readFileSync(from), { inflate: (data, bytes) => inflateRawSync(data, { maxOutputLength: Math.max(bytes, 1) }) });
  }
  const manifests = readdirSync(from, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".pack.json")).map((entry) => entry.name).sort();
  const files: ZipEntry[] = manifests.map((name) => ({ name, bytes: readFileSync(join(from, name)) }));
  if (files.length !== 1) return files;
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(files[0]!.bytes));
  } catch {
    return files;
  }
  const listed = (key: string): unknown[] => (typeof manifest === "object" && manifest !== null && Array.isArray((manifest as Record<string, unknown>)[key]) ? ((manifest as Record<string, unknown>)[key] as unknown[]) : []);
  for (const entry of [...listed("files"), ...listed("scenes")]) {
    const name = typeof entry === "object" && entry !== null ? (entry as { name?: unknown }).name : undefined;
    // A name that is not a plain path inside the folder is left for verifyPack to refuse.
    if (typeof name !== "string" || name === "" || name.includes("\\") || name.split("/").some((part) => part === "" || part === "." || part === "..")) continue;
    const place = join(from, ...name.split("/"));
    if (statOf(place)?.isFile() === true) files.push({ name, bytes: readFileSync(place) });
  }
  return files;
}

/** Reads a pack from a ZIP archive or a folder and checks it against its own manifest. */
export function readPackFrom(path: string): VerifiedPack {
  return verifyPack(readPackFiles(path));
}

function readLock(root: string): { place: string; lock: LockFile | undefined; text: string | undefined } {
  const place = join(root, LOCK_FILE_NAME);
  const stat = statOf(place);
  if (stat === undefined) return { place, lock: undefined, text: undefined };
  if (!stat.isFile()) refuse("BAD_LOCK", `${place} is not a plain file. The lock file is never read or written through a link.`);
  const text = new TextDecoder().decode(readFileSync(place));
  return { place, lock: parseLock(text), text };
}

/**
 * Installs a pack, a ZIP archive or a folder, into a game project: its files go into
 * `<project>/<into>/<pack name>/`, and the lock file at the project's root is written or
 * updated. Installing a newer pack replaces the files in place under the same names.
 *
 * Nothing is written before everything was checked: the pack against its manifest
 * (`PACK_MISMATCH`), every path against the project's folder (`OUTSIDE_PROJECT`), and what is
 * already there (`FILE_IN_THE_WAY`). Every file is written whole, and the lock file last.
 */
export function installPack(packPath: string, project: string, options: InstallOptions & { dryRun?: boolean } = {}): InstallResult {
  const pack = readPackFrom(packPath);
  const root = projectRoot(project);
  const { place: lockFile, lock, text } = readLock(root);
  const present = (path: string): string | undefined => {
    const place = placeOf(root, path);
    const stat = statOf(place);
    if (stat === undefined) return undefined;
    if (stat.isSymbolicLink()) return refuse("OUTSIDE_PROJECT", `${path} is a link. Files are only replaced where they are plain files of the project.`);
    if (!stat.isFile()) return refuse("FILE_IN_THE_WAY", `${path} is a folder where the pack has a file.`);
    return sha256(readFileSync(place));
  };
  const { write, remove, lock: next, ...plan } = planInstall(pack, lock, present, options);
  const result: InstallResult = { project: root, lockFile, ...plan, ignored: pack.ignored };
  if (options.dryRun === true) return { ...result, dryRun: true };

  // Every place is worked out, and so held against the project, before the first file is written.
  const writes = write.map((file) => ({ place: placeOf(root, file.path), bytes: file.bytes }));
  const removals = remove.map((path) => placeOf(root, path));
  for (const file of writes) writeWhole(file.place, file.bytes);
  for (const place of removals) {
    rmSync(place, { force: true });
    // Folders the pack leaves empty go too, up to the project's own.
    for (let folder = dirname(place); folder !== root && folder.startsWith(root + sep); folder = dirname(folder)) {
      try {
        rmdirSync(folder);
      } catch {
        break;
      }
    }
  }
  const after = lockJson(next);
  if (after !== text) writeWhole(lockFile, after);
  return result;
}

function lockOf(root: string): { place: string; lock: LockFile } {
  const { place, lock } = readLock(root);
  if (lock === undefined) return refuse("BAD_LOCK", `The project ${root} has no lock file (${LOCK_FILE_NAME}): nothing was installed into it.`);
  return { place, lock };
}

/** What is in the project at a path, for a comparison: a file that is not a plain file counts as other bytes. */
function presentIn(root: string): (path: string) => string | undefined {
  return (path) => {
    const place = placeOf(root, path);
    const stat = statOf(place);
    if (stat === undefined) return undefined;
    return stat.isFile() ? sha256(readFileSync(place)) : "not a plain file";
  };
}

/** Compares a project with its lock file. Writes nothing. */
export function projectStatus(project: string): ProjectStatus {
  const root = projectRoot(project);
  const { place, lock } = lockOf(root);
  return { project: root, lockFile: place, ...lockStatus(lock, presentIn(root)) };
}

/**
 * Moves "in the build" to the installed revision, for one pack by name or for every pack, and
 * writes the lock file. Refused as `PACK_MISMATCH` when a file of a pack to pin is not the one
 * the lock file says: what would go in the build would not be that revision.
 */
export function pinProject(project: string, name?: string): ProjectStatus {
  const root = projectRoot(project);
  const { place, lock } = lockOf(root);
  const next = pinLock(lock, name);
  const before = lockStatus(lock, presentIn(root));
  for (const pack of before.packs) {
    if ((name === undefined || pack.name === name) && !pack.matches) {
      refuse("PACK_MISMATCH", `The pack "${pack.name}" in the project is not the one the lock file says: ${[...pack.changed.map((path) => `${path} has other bytes`), ...pack.missing.map((path) => `${path} is missing`)].slice(0, 5).join("; ")}. Install the pack again, then pin it.`);
    }
  }
  const text = lockJson(next);
  if (text !== lockJson(lock)) writeWhole(place, text);
  return { project: root, lockFile: place, ...lockStatus(next, presentIn(root)) };
}
