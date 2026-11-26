/** Thrown for input the package refuses. `code` says which rule was broken. */
export class GameExportError extends Error {
    code;
    /**
     * Which body of the input the refusal is about, counted from 0, when it was found while that
     * one body was checked or built. Not set for what is read across all bodies, like names and
     * colours, or for what is not about a body.
     */
    body;
    constructor(code, message) {
        super(message);
        this.name = "GameExportError";
        this.code = code;
    }
}
export function refuse(code, message) {
    throw new GameExportError(code, message);
}
/** Runs `work` on one body of the input, and marks a refusal that comes out of it with that body. */
export function forBody(body, work) {
    try {
        return work();
    }
    catch (error) {
        if (error instanceof GameExportError && error.body === undefined)
            error.body = body;
        throw error;
    }
}
