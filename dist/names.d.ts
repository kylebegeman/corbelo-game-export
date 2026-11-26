/** Letters, digits, `_` and `-` only. Accents are dropped from letters; anything else becomes `_`. */
export declare function safeName(name: string, fallback: string): string;
/** True when a built-in engine profile would read the name as a collision shape or a detail level. */
export declare function hasReservedPrefix(name: string): boolean;
/**
 * Importers ignore trailing digits and underscores when they look for an ending, and accept
 * either `-` or `_` in front of it, so `wall_col_2` counts the same as `wall-col`.
 */
export declare function hasReservedEnding(name: string): boolean;
/**
 * Node names for bodies, in order. Each is safe for the built-in engines, clear of their
 * collision and detail-level naming rules, and unique without regard to letter case.
 * The same list of names always gives the same result.
 */
export declare function nodeNames(names: readonly string[]): string[];
