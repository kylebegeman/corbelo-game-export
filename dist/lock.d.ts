import type { PackManifest } from "./pack.js";
import type { JsonValue } from "./types.js";
import type { ZipEntry } from "./zip.js";
/** The lock file's name. It sits at the root of the game project. */
export declare const LOCK_FILE_NAME = "corbelo-game-export.lock.json";
/** The folder of the project a pack's own folder goes into, unless another is named. */
export declare const DEFAULT_INSTALL_FOLDER = "assets";
/** One file of an installed pack, on one line of the lock file. */
export interface LockedFile {
    /** Where the file is from the pack's folder, with `/` between folders. */
    path: string;
    /** `"model"`: an asset. `"blockout"`: the scene of a layout. `"manifest"`: the pack's manifest. */
    role: "model" | "blockout" | "manifest";
    bytes: number;
    sha256: string;
    /** For a model: its asset name. */
    asset?: string;
    /** For a model of a family or a kit: its row, or its piece. */
    row?: string;
    /** For a blockout: its layout. */
    layout?: string;
    /** The provenance the pack carries for this file alone. A file without it has the pack's. */
    provenance?: JsonValue;
}
/** A revision of a pack: the caller's own name for it, when the pack has one, and the SHA-256 of its manifest. */
export interface LockedRevision {
    revision?: string;
    digest: string;
}
/** One installed pack. */
export interface LockedPack {
    name: string;
    kind: "asset" | "family" | "kit";
    /** The pack's folder, from the root of the project, with `/` between folders. */
    into: string;
    /** The manifest's file name in that folder. */
    manifest: string;
    /** What wrote the pack. */
    generator: string;
    /** The pack's engine profile. */
    profile: string;
    generatedAt?: string;
    /** The revision whose files are in the project: the caller's own name for it, when the pack has one. */
    revision?: string;
    /** SHA-256 of the manifest of the pack whose files are in the project. Two packs with one digest are the same pack. */
    digest: string;
    /** The revision that goes in the build. An install of another revision leaves it alone unless told to move it. */
    inTheBuild: LockedRevision;
    /** The pack's own provenance, as the caller gave it. */
    provenance?: JsonValue;
    /** Every file of the pack, in the order of their paths. */
    files: LockedFile[];
}
export interface LockFile {
    /** Version of this layout. */
    schema: 1;
    /** Every installed pack, in the order of their names. */
    packs: LockedPack[];
}
/** One file of a pack that was checked against its manifest. */
export interface VerifiedPackFile extends Omit<LockedFile, "bytes"> {
    bytes: Uint8Array;
}
/** A pack whose every file is the one its manifest says. */
export interface VerifiedPack {
    name: string;
    manifest: PackManifest;
    /** The manifest's file name. */
    manifestName: string;
    /** SHA-256 of the manifest. */
    digest: string;
    /** The models, the scenes, then the manifest. */
    files: VerifiedPackFile[];
    /** Files that were given and that the manifest does not list. They are not part of the pack. */
    ignored: string[];
}
/**
 * Checks a pack against its own manifest. `files` are the files of the pack, from a folder or
 * from an archive read with `readZip`; they may all sit in one folder of their own.
 *
 * Refused as `BAD_PACK`: no manifest or more than one, and a manifest that is not one. Refused
 * as `PACK_MISMATCH`: a file the manifest lists that is missing, has another size, or has
 * another SHA-256. Files the manifest does not list are named in `ignored` and left out.
 */
export declare function verifyPack(files: readonly ZipEntry[]): VerifiedPack;
/**
 * The lock file as text. A pack's own facts are one to a line, and each of its files is one
 * line, so a new revision of a pack changes one line for each file that changed and a few
 * lines above them. The same lock always gives the same text.
 */
export declare function lockJson(lock: LockFile): string;
/**
 * Reads a lock file. Refused as `BAD_LOCK`: what is not JSON, a layout other than this one, a
 * key that is not known, and a path that would leave the project.
 */
export declare function parseLock(text: string): LockFile;
export interface InstallOptions {
    /**
     * The folder of the project the pack's own folder goes into, from the project's root, with
     * `/` between folders. Default: where the lock file says the pack is, else `"assets"`.
     */
    into?: string;
    /** `true` moves "in the build" to the revision being installed. A first install always sets it. */
    pin?: boolean;
    /** `true` replaces files that are in the way: ones nothing installed, and ones changed in the project since. */
    force?: boolean;
}
/** What an install does to one file. `path` is from the root of the project. */
export interface InstallChange {
    path: string;
    /**
     * `"added"`: new in the project. `"changed"`: replaced by other bytes. `"unchanged"`: already
     * these bytes. `"removed"`: of the revision before and not of this one, so taken away.
     * `"kept"`: of the revision before and not of this one, but changed in the project since, so
     * left where it is and no longer tracked.
     */
    change: "added" | "changed" | "unchanged" | "removed" | "kept";
    /** SHA-256 of what was in the project, when something was. */
    from?: string;
    /** SHA-256 of what is there after, when something is. */
    to?: string;
    /** Only with `force`: the file replaced or removed was not the one the lock file knew. */
    forced?: true;
}
export interface InstallPlan {
    /** The pack's name. */
    pack: string;
    kind: "asset" | "family" | "kit";
    /** The pack's folder, from the root of the project. */
    into: string;
    /** The revision in the project before, when the pack was installed, and the one after. */
    from?: LockedRevision;
    to: LockedRevision;
    inTheBuild: LockedRevision;
    /** Whether what is installed after is the revision in the build. */
    pinned: boolean;
    /** Every file of the pack and of the revision before, in the order of their paths. */
    changes: InstallChange[];
    counts: {
        added: number;
        changed: number;
        unchanged: number;
        removed: number;
        kept: number;
    };
    /** The files to write, each with its path from the root of the project. */
    write: {
        path: string;
        bytes: Uint8Array;
    }[];
    /** The files to take away, each a path from the root of the project. */
    remove: string[];
    /** The lock file after the install. */
    lock: LockFile;
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
export declare function planInstall(pack: VerifiedPack, lock: LockFile | undefined, present: (path: string) => string | undefined, options?: InstallOptions): InstallPlan;
export interface LockStatusPack {
    name: string;
    kind: "asset" | "family" | "kit";
    into: string;
    /** The revision the lock file says is in the project. */
    installed: LockedRevision;
    inTheBuild: LockedRevision;
    /** Whether the installed revision is the one in the build. */
    pinned: boolean;
    /** Whether every file is in the project with the bytes the lock file says. */
    matches: boolean;
    counts: {
        same: number;
        changed: number;
        missing: number;
    };
    /** Files with other bytes than the lock file says, as paths from the root of the project. */
    changed: string[];
    /** Files the lock file lists that are not in the project. */
    missing: string[];
}
export interface LockStatus {
    /** Whether every pack matches the lock file and is the revision in the build. */
    ok: boolean;
    packs: LockStatusPack[];
}
/**
 * Compares a project with its lock file. `present` says what is in the project now: the
 * SHA-256 of the file at a path from the project's root, or `undefined` when nothing is there.
 */
export declare function lockStatus(lock: LockFile, present: (path: string) => string | undefined): LockStatus;
/**
 * Moves "in the build" to the revision that is installed, for one pack by name or for every
 * pack. Returns the new lock file; the one given is left as it is.
 */
export declare function pinLock(lock: LockFile, name?: string): LockFile;
