import { type CheckOptions, type CheckReport } from "./checks.js";
import { type CollisionKernel } from "./collision.js";
import { type GamePack } from "./pack.js";
import type { AssetOptions, AttachPointInput, ColorInput, ExportOptions, JsonValue, PackFacts, SourceSpace } from "./types.js";
/** One body of a job: an STL file plus what the file cannot say about itself. */
export interface JobBody {
    name: string;
    /** Path to a binary or ASCII STL file, relative to the job file. */
    stl: string;
    color?: ColorInput;
    materialName?: string;
    /**
     * Path to a JSON file, relative to the job file, holding one whole number per triangle of the
     * STL in the file's own order: the CAD face each triangle came from. STL cannot say this itself.
     */
    faceIds?: string;
    /**
     * Path to a JSON file, relative to the job file, holding one entry per triangle of the STL in
     * the file's own order: the colour of that triangle, or `null` for the body's own colour.
     */
    faceColors?: string;
    /** Names for the materials of face colours: `{ "#3a7bd5": "Blue" }`. */
    faceMaterialNames?: Record<string, string>;
    /** The meshes the STL is a finer cut of, to take the shading from. */
    refines?: JobRefinement;
}
/** `refines` of a body in a job. Every path is relative to the job file. */
export interface JobRefinement {
    /** Each an STL file, and optionally a JSON file with one face id per triangle of it. */
    surfaces: {
        stl: string;
        faceIds?: string;
    }[];
    /** Path to a JSON file: for each triangle of the body's STL, a triangle of its surface it lies in. */
    triangleOf: string;
    /** Path to a JSON file: for each triangle of the body's STL, the surface it lies in. Needed with more than one surface. */
    surfaceOf?: string;
}
/** The JSON job file the command line reads. Options are the same as `exportGameGlb` takes. */
export interface JobFile extends ExportOptions {
    bodies: JobBody[];
    source: SourceSpace;
    /** Where to write, relative to the job file. Command-line flags win over these. */
    output?: {
        glb?: string;
        facts?: string;
    };
}
export interface JobResult {
    /** Absolute path of the GLB written. */
    glb: string;
    /** Absolute path of the facts JSON written. */
    facts: string;
    /** Size of the GLB. */
    bytes: number;
    report: PackFacts;
}
/**
 * Runs a job file: reads its STL bodies, exports them and writes the GLB and the facts JSON.
 * `overrides` replace the job's output paths and are taken relative to the working directory.
 */
export declare function runJob(jobPath: string, overrides?: {
    glb?: string;
    facts?: string;
}): JobResult;
/** A lower detail level of a body in a pack job. Every path is relative to the job's folder. */
export interface PackJobLod {
    stl: string;
    /** Path to a JSON file with one face id per triangle of the STL. */
    faceIds?: string;
    /** Path to a JSON file with one colour, or null, per triangle of the STL. */
    faceColors?: string;
}
/** One body of a pack job: a body of a job, and what a game asset has around it. */
export interface PackJobBody extends JobBody {
    /** Lower detail levels, the nearest to full detail first. */
    lods?: PackJobLod[];
    /** The pieces the body was made from, each an STL file. Only their points are used. */
    collisionPieces?: {
        stl: string;
    }[];
    attachPoints?: AttachPointInput[];
}
/**
 * The JSON job the `pack` command reads. Options are the ones `exportGamePack` takes, with
 * files in place of numbers and the name of a kernel in place of the kernel.
 */
export interface PackJob extends Omit<AssetOptions, "kernel"> {
    name: string;
    source: SourceSpace;
    bodies?: PackJobBody[];
    rows?: {
        name: string;
        bodies: PackJobBody[];
        provenance?: JsonValue;
    }[];
    naming?: string;
    checks?: false | CheckOptions;
    generatedAt?: string;
    revision?: string;
    /** `"manifold-3d"` loads that package, which must be installed, for general convex decomposition. */
    kernel?: "manifold-3d";
    /** Where to write, relative to the job's folder: every file into `dir`, one archive at `zip`, or both. */
    output?: {
        dir?: string;
        zip?: string;
    };
}
export interface PackJobOptions {
    /** The folder paths in the job are relative to. Default: the working directory. */
    base?: string;
    /** Replace the job's output paths. Relative to the working directory. */
    dir?: string;
    zip?: string;
    /** A kernel to use in place of the one the job names. */
    kernel?: CollisionKernel;
}
export interface PackJobResult {
    /** The pack's name. */
    name: string;
    /** The worst result of the game checks, when they ran. */
    status?: "pass" | "warn" | "fail";
    /** Absolute path of the folder the files were written into, when one was asked for. */
    dir?: string;
    /** Absolute path of the archive, when one was asked for. */
    zip?: string;
    /** Every file of the pack. `path` is where it was written, when a folder was asked for. */
    files: {
        name: string;
        mediaType: string;
        bytes: number;
        sha256?: string;
        path?: string;
    }[];
    pack: GamePack;
}
/**
 * Runs a pack job: reads the STL files it names, makes the pack and writes it where the job
 * says, as a folder of files, as one ZIP archive, or both. With nowhere to write, nothing is
 * written and the pack is only returned.
 */
export declare function runPackJob(job: unknown, options?: PackJobOptions): Promise<PackJobResult>;
/** Reads a GLB this package wrote from a file and runs the game checks on it. */
export declare function checkFile(path: string, options?: CheckOptions): CheckReport;
export interface CliIo {
    out: (text: string) => void;
    err: (text: string) => void;
    /** Reads all of standard input. Default: the process's own. */
    stdin?: () => Uint8Array;
}
/** The command line. Returns the exit code and never throws. */
export declare function runCli(argv: readonly string[], io?: CliIo): number;
/**
 * The whole command line: `pack`, `check`, and everything `runCli` does. Returns the exit code
 * and never throws.
 */
export declare function runCommand(argv: readonly string[], io?: CliIo): Promise<number>;
