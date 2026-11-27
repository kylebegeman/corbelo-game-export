import { type InstallOptions, type InstallPlan, type LockStatus, type VerifiedPack } from "./lock.js";
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
/**
 * Reads the files of a pack from a ZIP archive or from a folder. From a folder, only the
 * manifest and the files it lists are read.
 */
export declare function readPackFiles(path: string): ZipEntry[];
/** Reads a pack from a ZIP archive or a folder and checks it against its own manifest. */
export declare function readPackFrom(path: string): VerifiedPack;
/**
 * Installs a pack, a ZIP archive or a folder, into a game project: its files go into
 * `<project>/<into>/<pack name>/`, and the lock file at the project's root is written or
 * updated. Installing a newer pack replaces the files in place under the same names.
 *
 * Nothing is written before everything was checked: the pack against its manifest
 * (`PACK_MISMATCH`), every path against the project's folder (`OUTSIDE_PROJECT`), and what is
 * already there (`FILE_IN_THE_WAY`). Every file is written whole, and the lock file last.
 */
export declare function installPack(packPath: string, project: string, options?: InstallOptions & {
    dryRun?: boolean;
}): InstallResult;
/** Compares a project with its lock file. Writes nothing. */
export declare function projectStatus(project: string): ProjectStatus;
/**
 * Moves "in the build" to the installed revision, for one pack by name or for every pack, and
 * writes the lock file. Refused as `PACK_MISMATCH` when a file of a pack to pin is not the one
 * the lock file says: what would go in the build would not be that revision.
 */
export declare function pinProject(project: string, name?: string): ProjectStatus;
