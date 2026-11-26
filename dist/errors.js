/** Thrown for input the package refuses. `code` says which rule was broken. */
export class GameExportError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "GameExportError";
        this.code = code;
    }
}
export function refuse(code, message) {
    throw new GameExportError(code, message);
}
