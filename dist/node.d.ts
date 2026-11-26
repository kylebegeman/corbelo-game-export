import type { ColorInput, ExportOptions, PackFacts, SourceSpace } from "./types.js";
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
export interface CliIo {
    out: (text: string) => void;
    err: (text: string) => void;
}
/** The command line. Returns the exit code and never throws. */
export declare function runCli(argv: readonly string[], io?: CliIo): number;
